import { Router } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, productionBatchesTable, productionCostEntriesTable, productionExceptionsTable, documentRevisionsTable } from "../db";
import { requireAuth, requirePermission, requireRole } from "../middleware/auth";
import { createBatchSchema, createCostEntrySchema } from "../db/schema/operations";
import { writeAuditEvent } from "../lib/governance";
import { createApprovalRequest } from "../lib/approvals";
import { z } from "zod";
import { nextPhase0Number } from "../lib/phase0";

const router = Router();
router.use("/operations", requireAuth);

router.post("/operations/batches", requirePermission("productionWorkflow.execute"), async (req, res, next) => {
  try {
    const data = createBatchSchema.parse(req.body);
    const batch = await db.transaction(async (tx) => {
      const batchNumber = data.batchNumber ?? await nextPhase0Number(tx, "production_batch");
      const [created] = await tx.insert(productionBatchesTable).values({
        ...data, batchNumber, createdBy: req.user!.userId, plannedQty: data.plannedQty,
      }).returning();
      return created;
    });
    await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "productionWorkflow.batch.create", resourceType: "production_batch", resourceId: batch.id, afterData: batch, ipAddress: req.ip, userAgent: req.get("user-agent") });
    res.status(201).json(batch);
  } catch (err) { next(err); }
});

router.get("/operations/orders/:orderId/batches", requireRole("chairman", "operations_manager", "executive_manager", "warehouse_manager", "production_manager", "production_controller", "supervisor", "production_quality_controller", "quality_engineer"), async (req, res, next) => {
  try {
    const orderId = Number(req.params.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) { res.status(400).json({ error: { message: "معرّف أمر الإنتاج غير صالح" } }); return; }
    res.json(await db.select().from(productionBatchesTable).where(eq(productionBatchesTable.workflowOrderId, orderId)).orderBy(desc(productionBatchesTable.createdAt)));
  } catch (err) { next(err); }
});

router.post("/operations/cost-entries", requirePermission("productionWorkflow.cost.record"), async (req, res, next) => {
  try {
    const data = createCostEntrySchema.parse(req.body);
    const entry = await db.transaction(async (tx) => {
      const [created] = await tx.insert(productionCostEntriesTable).values({
        ...data, createdBy: req.user!.userId, status: "approved",
      }).returning();
      const approval = await createApprovalRequest({
        actionKey: "productionWorkflow.cost.record",
        resourceType: "production_cost_entry",
        resourceId: created.id,
        amount: Number(data.amount),
        requestedBy: req.user!.userId,
        metadata: { workflowOrderId: data.workflowOrderId },
      }, tx);
      if (!approval) return created;
      const [pending] = await tx.update(productionCostEntriesTable)
        .set({ status: "pending_approval" })
        .where(eq(productionCostEntriesTable.id, created.id)).returning();
      return pending;
    });
    await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "productionWorkflow.cost.record", resourceType: "production_cost_entry", resourceId: entry.id, afterData: entry, ipAddress: req.ip, userAgent: req.get("user-agent") });
    res.status(201).json({ ...entry, pendingApproval: entry.status === "pending_approval" });
  } catch (err) { next(err); }
});

router.get("/operations/orders/:orderId/cost", requireRole("chairman", "operations_manager", "executive_manager", "warehouse_manager", "production_manager", "production_controller", "supervisor", "production_quality_controller", "quality_engineer"), async (req, res, next) => {
  try {
    const orderId = Number(req.params.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) { res.status(400).json({ error: { message: "معرّف أمر الإنتاج غير صالح" } }); return; }
    const entries = await db.select().from(productionCostEntriesTable).where(eq(productionCostEntriesTable.workflowOrderId, orderId)).orderBy(productionCostEntriesTable.createdAt);
    const byType = Object.fromEntries(entries.map((e) => [e.costType, 0]));
    for (const entry of entries) byType[entry.costType] = (byType[entry.costType] ?? 0) + Number(entry.amount);
    const total = entries.reduce((sum, e) => sum + Number(e.amount), 0);
    res.json({ orderId, total, byType, entries });
  } catch (err) { next(err); }
});

router.get("/operations/exceptions", requireRole("chairman", "operations_manager", "executive_manager", "warehouse_manager", "production_manager", "production_controller", "supervisor", "production_quality_controller", "quality_engineer"), async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "open";
    res.json(await db.select().from(productionExceptionsTable).where(eq(productionExceptionsTable.status, status)).orderBy(desc(productionExceptionsTable.createdAt)));
  } catch (err) { next(err); }
});

router.patch("/operations/exceptions/:id/resolve", requireRole("chairman", "operations_manager", "executive_manager", "production_manager", "production_controller", "production_quality_controller", "quality_engineer"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rootCause, resolution } = z.object({ rootCause: z.string().min(3), resolution: z.string().min(3) }).parse(req.body);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: { message: "معرّف الاستثناء غير صالح" } }); return; }
    const [updated] = await db.update(productionExceptionsTable).set({ status: "resolved", rootCause, resolution, resolvedAt: new Date(), resolvedBy: req.user!.userId }).where(and(eq(productionExceptionsTable.id, id), eq(productionExceptionsTable.status, "open"))).returning();
    if (!updated) { res.status(404).json({ error: { message: "الاستثناء غير موجود أو مغلق بالفعل" } }); return; }
    await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "operations.exception.resolve", resourceType: "production_exception", resourceId: id, afterData: updated, reason: resolution, ipAddress: req.ip, userAgent: req.get("user-agent") });
    res.json(updated);
  } catch (err) { next(err); }
});

router.get("/operations/revisions/:resourceType/:resourceId", requireRole("chairman", "operations_manager", "executive_manager", "production_manager", "production_controller", "supervisor", "production_quality_controller", "quality_engineer"), async (req, res, next) => {
  try {
    const resourceId = Number(req.params.resourceId);
    if (!Number.isInteger(resourceId) || resourceId <= 0) { res.status(400).json({ error: { message: "معرّف المستند غير صالح" } }); return; }
    res.json(await db.select().from(documentRevisionsTable).where(and(eq(documentRevisionsTable.resourceType, String(req.params.resourceType)), eq(documentRevisionsTable.resourceId, resourceId))).orderBy(desc(documentRevisionsTable.version)));
  } catch (err) { next(err); }
});

export default router;