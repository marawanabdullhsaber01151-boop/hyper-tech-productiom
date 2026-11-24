/** @format */
// التكلفة المعيارية وكشف تكلفة الدفعة (54). الإدارة العليا بس (finance). كل كتابة في معاملة واحدة.
//   GET  /costing/standards                 المعايير لكل الوصفات النشطة
//   GET  /costing/standards/:recipeId/history
//   PUT  /costing/standards/:recipeId       { labor, machine, energy, overhead, yieldPercent, reason }
//   GET  /costing/batches?status=           قايمة الدفعات
//   GET  /costing/batches/:id               كشف التكلفة (محسوب أو نهائي)
//   POST /costing/batches/:id/sheet         احفظ/أعد حساب المسودة
//   POST /costing/batches/:id/finalize      اعتمد الكشف (دفعة مكتملة بس) ← نهائي
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { parseIdParam } from "../lib/validate";
import { CostingError, finalizeBatchSheet, listBatches, listStandards, saveBatchSheet, setStandard, standardHistory, viewBatchSheet } from "../lib/batchCosting";
import { standardBodySchema } from "../lib/batchCostingCore";

const router = Router();
const view = [requireAuth, requireRole(...PERMISSIONS.finance.view)];
const write = [requireAuth, requireRole(...PERMISSIONS.finance.write)];

const actorOf = (req: { user?: { userId: number; username: string }; ip?: string; get: (h: string) => string | undefined }) => ({
  userId: req.user!.userId, username: req.user!.username, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null,
});

/** رسايل ترجرات القاعدة (خط دفاع تاني). */
function dbGuard(err: unknown): never {
  const msg = String((err as { message?: string })?.message ?? "");
  if (msg.includes("BATCH_SHEET_FINAL")) throw new CostingError(409, "SHEET_FINAL", "كشف التكلفة ده نهائي ومينفعش يتعدّل");
  if (msg.includes("BATCH_NOT_COMPLETED")) throw new CostingError(409, "BATCH_NOT_COMPLETED", "اقفل الدفعة الأول (مكتملة) وبعدين اعتمد كشف التكلفة");
  if (msg.includes("STANDARD_HISTORY_IMMUTABLE")) throw new CostingError(409, "IMMUTABLE", "سجل المعايير مبيتعدّلش");
  throw err;
}

router.get("/costing/standards", ...view, async (_req, res, next) => {
  try {
    res.json({ items: await listStandards(db) });
  } catch (err) {
    next(err);
  }
});

router.get("/costing/standards/:recipeId/history", ...view, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.recipeId, res);
    if (id === null) return;
    res.json({ items: await standardHistory(db, id) });
  } catch (err) {
    next(err);
  }
});

router.put("/costing/standards/:recipeId", ...write, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.recipeId, res);
    if (id === null) return;
    const body = standardBodySchema.parse(req.body ?? {});
    const out = await db.transaction((tx) => setStandard(tx, id, body, actorOf(req))).catch(dbGuard);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

const listQuery = z.object({ status: z.enum(["all", "completed", "open"]).default("all") });

router.get("/costing/batches", ...view, async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    res.json({ items: await listBatches(db, { status: q.status }) });
  } catch (err) {
    next(err);
  }
});

router.get("/costing/batches/:id", ...view, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    res.json(await viewBatchSheet(db, id));
  } catch (err) {
    next(err);
  }
});

router.post("/costing/batches/:id/sheet", ...write, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    res.json(await db.transaction((tx) => saveBatchSheet(tx, id, actorOf(req))).catch(dbGuard));
  } catch (err) {
    next(err);
  }
});

router.post("/costing/batches/:id/finalize", ...write, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    res.json(await db.transaction((tx) => finalizeBatchSheet(tx, id, actorOf(req))).catch(dbGuard));
  } catch (err) {
    next(err);
  }
});

export default router;
