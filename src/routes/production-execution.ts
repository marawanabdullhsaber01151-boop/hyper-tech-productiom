/** @format */

import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  createDowntimeSchema,
  createNcrSchema,
  createOperationConfirmationSchema,
  createTraceabilitySchema,
  productionBatchesTable,
  productionDowntimesTable,
  productionNcrsTable,
  productionOperationConfirmationsTable,
  productionTraceabilityTable,
  productionWorkflowOrdersTable,
} from "../db/schema";
import {
  requireAuth,
  requirePermission,
  requireRole,
} from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { validateBatchQuantities } from "../domain/production-execution";
import { nextPhase0Number } from "../lib/phase0";
import { writeAuditEvent } from "../lib/governance";
import { NCR_CLOSE_ROLES, NCR_DISPOSITIONS, checkNcrClose } from "../lib/productionQualityCore";

const router = Router();
const closeNcrSchema = z.object({
  rootCause: z.string().trim().max(1000).default(""),
  correctiveAction: z.string().trim().max(1000).default(""),
  disposition: z.enum(NCR_DISPOSITIONS).optional(),
});
const productionRoles = [
  "chairman",
  "production_manager",
  "production_controller",
  "supervisor",
  "production_quality_controller",
];

router.patch(
  "/production-execution/batches/:id/confirm",
  requireAuth,
  requirePermission("productionWorkflow.execute"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const data = createOperationConfirmationSchema.parse(req.body);
      const [batch] = await db
        .select()
        .from(productionBatchesTable)
        .where(eq(productionBatchesTable.id, id))
        .limit(1);
      if (!batch) {
        res.status(404).json({ error: { message: "دفعة الإنتاج غير موجودة" } });
        return;
      }
      const confirmation = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(productionOperationConfirmationsTable)
          .values({
            ...data,
            batchId: batch.id,
            workflowOrderId: batch.workflowOrderId,
            recordedBy: req.user!.userId,
          })
          .returning();
        const produced =
          Number(batch.producedQty) +
          Number(data.goodQty) +
          Number(data.scrapQty) +
          Number(data.reworkQty);
        const [updated] = await tx
          .update(productionBatchesTable)
          .set({
            producedQty: String(produced),
            acceptedQty: String(
              Number(batch.acceptedQty) + Number(data.goodQty),
            ),
            scrapQty: String(Number(batch.scrapQty) + Number(data.scrapQty)),
            reworkQty: String(Number(batch.reworkQty) + Number(data.reworkQty)),
            startedAt: batch.startedAt ?? new Date(),
            status: "in_progress",
          })
          .where(eq(productionBatchesTable.id, id))
          .returning();
        return { confirmation: created, batch: updated };
      });
      res.json({ data: confirmation });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/production-execution/batches/:id/close",
  requireAuth,
  requirePermission("productionWorkflow.execute"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [batch] = await db
        .select()
        .from(productionBatchesTable)
        .where(eq(productionBatchesTable.id, id))
        .limit(1);
      if (!batch) {
        res.status(404).json({ error: { message: "دفعة الإنتاج غير موجودة" } });
        return;
      }
      validateBatchQuantities({
        producedQty: Number(batch.producedQty),
        acceptedQty: Number(batch.acceptedQty),
        reworkQty: Number(batch.reworkQty),
        scrapQty: Number(batch.scrapQty),
        plannedQty: Number(batch.plannedQty),
        closing: true,
      });
      const [closed] = await db
        .update(productionBatchesTable)
        .set({
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(productionBatchesTable.id, id))
        .returning();
      res.json({ data: closed });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/production-execution/batches/:id/downtimes",
  requireAuth,
  requireRole(...productionRoles),
  async (req, res, next) => {
    try {
      const batchId = parseIdParam(req.params.id, res);
      if (batchId === null) return;
      const data = createDowntimeSchema.parse(req.body);
      const [batch] = await db
        .select()
        .from(productionBatchesTable)
        .where(eq(productionBatchesTable.id, batchId))
        .limit(1);
      if (!batch) {
        res.status(404).json({ error: { message: "دفعة الإنتاج غير موجودة" } });
        return;
      }
      const [created] = await db
        .insert(productionDowntimesTable)
        .values({
          ...data,
          batchId,
          workflowOrderId: batch.workflowOrderId,
          recordedBy: req.user!.userId,
          startedAt: data.startedAt ? new Date(data.startedAt) : null,
          endedAt: data.endedAt ? new Date(data.endedAt) : null,
        })
        .returning();
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/production-execution/batches/:id/downtimes",
  requireAuth,
  requireRole(...productionRoles),
  async (req, res, next) => {
    try {
      const batchId = parseIdParam(req.params.id, res);
      if (batchId === null) return;
      res.json({
        data: await db
          .select()
          .from(productionDowntimesTable)
          .where(eq(productionDowntimesTable.batchId, batchId))
          .orderBy(desc(productionDowntimesTable.createdAt)),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/production-execution/ncrs",
  requireAuth,
  requireRole(...productionRoles),
  async (req, res, next) => {
    try {
      const data = createNcrSchema.parse(req.body);
      const created = await db.transaction(async (tx) => {
        // أمر الإنتاج لازم يكون موجود؛ من غيره كان بيطلع خطأ قاعدة بيانات (500) بدل رسالة مفهومة.
        const [order] = await tx
          .select({ id: productionWorkflowOrdersTable.id })
          .from(productionWorkflowOrdersTable)
          .where(eq(productionWorkflowOrdersTable.id, data.workflowOrderId))
          .limit(1);
        if (!order) throw Object.assign(new Error("أمر الإنتاج غير موجود"), { status: 404, code: "WORKFLOW_ORDER_NOT_FOUND" });
        const ncrNumber = await nextPhase0Number(tx, "production_ncr");
        const [record] = await tx
          .insert(productionNcrsTable)
          .values({
            ...data,
            ncrNumber,
            createdBy: req.user!.userId,
          })
          .returning();
        await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "production.ncr.open", resourceType: "production_ncr", resourceId: record!.id, afterData: { ncrNumber, workflowOrderId: data.workflowOrderId, defectCode: data.defectCode, affectedQty: data.affectedQty, disposition: data.disposition ?? null }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
        return record;
      });
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/production-execution/ncrs",
  requireAuth,
  requireRole(...productionRoles),
  async (_req, res, next) => {
    try {
      // رقم الأمر واسم المنتج جنب كل حالة، عشان المستخدم ما يدوّرش على رقم داخلي.
      const rows = await db
        .select({
          ncr: productionNcrsTable,
          orderNumber: productionWorkflowOrdersTable.orderNumber,
          productName: productionWorkflowOrdersTable.productName,
        })
        .from(productionNcrsTable)
        .leftJoin(productionWorkflowOrdersTable, eq(productionNcrsTable.workflowOrderId, productionWorkflowOrdersTable.id))
        .orderBy(desc(productionNcrsTable.createdAt));
      res.json({ data: rows.map(({ ncr, orderNumber, productName }) => ({ ...ncr, orderNumber, productName })) });
    } catch (err) {
      next(err);
    }
  },
);

// قفل حالة عدم مطابقة: لازم سبب جذري وإجراء تصحيحي، ومعاهم قيد تدقيق في نفس المعاملة.
router.patch(
  "/production-execution/ncrs/:id/close",
  requireAuth,
  requireRole(...NCR_CLOSE_ROLES),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const body = closeNcrSchema.parse(req.body);
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(productionNcrsTable).where(eq(productionNcrsTable.id, id)).for("update").limit(1);
        if (!row) throw Object.assign(new Error("حالة عدم المطابقة غير موجودة"), { status: 404, code: "NCR_NOT_FOUND" });
        const check = checkNcrClose({ status: row.status, rootCause: body.rootCause, correctiveAction: body.correctiveAction });
        if (!check.ok) throw Object.assign(new Error(check.message), { status: check.code === "ALREADY_CLOSED" ? 409 : 400, code: check.code });
        const [result] = await tx
          .update(productionNcrsTable)
          .set({ status: "closed", rootCause: check.rootCause, correctiveAction: check.correctiveAction, disposition: body.disposition ?? row.disposition, closedBy: req.user!.userId, closedAt: new Date() })
          .where(eq(productionNcrsTable.id, id))
          .returning();
        await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "production.ncr.close", resourceType: "production_ncr", resourceId: id, beforeData: { status: row.status, disposition: row.disposition }, afterData: { status: "closed", disposition: result!.disposition, rootCause: check.rootCause, correctiveAction: check.correctiveAction }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
        return result!;
      });
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/production-execution/traceability",
  requireAuth,
  requireRole(...productionRoles),
  async (req, res, next) => {
    try {
      const data = createTraceabilitySchema.parse(req.body);
      const [created] = await db
        .insert(productionTraceabilityTable)
        .values({
          ...data,
          recordedBy: req.user!.userId,
        })
        .returning();
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/production-execution/traceability/:lotNumber",
  requireAuth,
  requireRole(...productionRoles),
  async (req, res, next) => {
    try {
      // رقم أمر الإنتاج جنب كل سجل بدل رقم داخلي.
      const rows = await db
        .select({ trace: productionTraceabilityTable, orderNumber: productionWorkflowOrdersTable.orderNumber })
        .from(productionTraceabilityTable)
        .leftJoin(productionWorkflowOrdersTable, eq(productionTraceabilityTable.workflowOrderId, productionWorkflowOrdersTable.id))
        .where(eq(productionTraceabilityTable.lotNumber, String(req.params.lotNumber)))
        .orderBy(desc(productionTraceabilityTable.createdAt));
      res.json({ data: rows.map(({ trace, orderNumber }) => ({ ...trace, orderNumber })) });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
