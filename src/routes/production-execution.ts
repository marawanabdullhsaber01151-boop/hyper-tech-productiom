/** @format */

import { Router } from "express";
import { desc, eq } from "drizzle-orm";
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
} from "../db/schema";
import {
  requireAuth,
  requirePermission,
  requireRole,
} from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { validateBatchQuantities } from "../domain/production-execution";
import { nextPhase0Number } from "../lib/phase0";

const router = Router();
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
        const ncrNumber = await nextPhase0Number(tx, "production_ncr");
        const [record] = await tx
          .insert(productionNcrsTable)
          .values({
            ...data,
            ncrNumber,
            createdBy: req.user!.userId,
          })
          .returning();
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
      res.json({
        data: await db
          .select()
          .from(productionNcrsTable)
          .orderBy(desc(productionNcrsTable.createdAt)),
      });
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
      res.json({
        data: await db
          .select()
          .from(productionTraceabilityTable)
          .where(
            eq(
              productionTraceabilityTable.lotNumber,
              String(req.params.lotNumber),
            ),
          )
          .orderBy(desc(productionTraceabilityTable.createdAt)),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
