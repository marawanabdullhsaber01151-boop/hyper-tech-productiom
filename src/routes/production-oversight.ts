/** @format */
// متابعة الإنتاج (الخطوة 37أ): ملاحظات المشرف على الأمر + الأوامر الواقفة.
import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { createOrderNoteSchema, productionBatchesTable, productionOrderNotesTable, productionWorkflowOrdersTable } from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { writeAuditEvent } from "../lib/governance";
import { NOTE_READ_ROLES, NOTE_WRITE_ROLES, listStalledOrders } from "../lib/productionOversight";

const router = Router();

// GET /api/v1/production-oversight/orders/:id/notes — الأحدث الأول
router.get("/production-oversight/orders/:id/notes", requireAuth, requireRole(...NOTE_READ_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const rows = await db.select().from(productionOrderNotesTable).where(eq(productionOrderNotesTable.workflowOrderId, id)).orderBy(desc(productionOrderNotesTable.createdAt)).limit(200);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/production-oversight/orders/:id/notes — ملاحظة جديدة (سجل إضافة فقط) + تدقيق في معاملة واحدة
router.post("/production-oversight/orders/:id/notes", requireAuth, requireRole(...NOTE_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const data = createOrderNoteSchema.parse(req.body);
    const note = await db.transaction(async (tx) => {
      const [order] = await tx.select({ id: productionWorkflowOrdersTable.id, status: productionWorkflowOrdersTable.workflowStatus }).from(productionWorkflowOrdersTable).where(eq(productionWorkflowOrdersTable.id, id)).for("update");
      if (!order) throw Object.assign(new Error("أمر الإنتاج غير موجود"), { status: 404 });
      if (data.batchId) {
        const [batch] = await tx.select({ id: productionBatchesTable.id, orderId: productionBatchesTable.workflowOrderId }).from(productionBatchesTable).where(eq(productionBatchesTable.id, data.batchId));
        if (!batch || batch.orderId !== id) throw Object.assign(new Error("الدفعة مش تابعة للأمر ده"), { status: 400 });
      }
      const [row] = await tx.insert(productionOrderNotesTable).values({ workflowOrderId: id, batchId: data.batchId ?? null, kind: data.kind, body: data.body, createdBy: req.user!.userId, createdByName: req.user!.username }).returning();
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "production.note.create", resourceType: "production_workflow_order", resourceId: id, beforeData: null, afterData: { noteId: row!.id, kind: data.kind, status: order.status }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      return row;
    });
    res.status(201).json({ data: note });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      res.status((err as Error & { status: number }).status).json({ error: { message: err.message } });
      return;
    }
    next(err);
  }
});

// GET /api/v1/production-oversight/stalled — الأوامر الواقفة دلوقتي (محسوبة لحظيًا، مش محتاجة cron)
router.get("/production-oversight/stalled", requireAuth, requireRole(...NOTE_READ_ROLES), async (_req, res, next) => {
  try {
    res.json({ data: await listStalledOrders() });
  } catch (err) {
    next(err);
  }
});

export default router;
