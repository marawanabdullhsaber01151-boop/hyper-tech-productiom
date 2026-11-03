/** @format */
// سجل التوقف بالماكينة + تقرير OEE (الخطوة 37ب).
import { Router } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { endStoppageSchema, foundationMachinesTable, productionBatchesTable, productionDowntimesTable, startStoppageSchema } from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { writeAuditEvent } from "../lib/governance";
import { isIsoDate, isStoppageReason, stoppageMinutes } from "../domain/oee";
import { buildOeeReport } from "../lib/oeeReport";

const router = Router();

/** مين يسجّل بداية ونهاية التوقف، ومين يشوف التقرير. */
export const STOPPAGE_WRITE_ROLES = ["chairman", "production_manager", "production_controller", "supervisor"] as const;
export const OEE_READ_ROLES = [...STOPPAGE_WRITE_ROLES, "production_quality_controller", "executive_manager", "operations_manager"] as const;

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
function sendErr(err: unknown, res: import("express").Response, next: import("express").NextFunction) {
  if (err instanceof Error && "status" in err) {
    res.status((err as Error & { status: number }).status).json({ error: { message: err.message } });
    return;
  }
  // فهرس «توقف مفتوح واحد لكل ماكينة»: سباق بين طلبين
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
    res.status(409).json({ error: { message: "الماكينة دي عليها توقف مفتوح بالفعل" } });
    return;
  }
  next(err);
}

// GET /api/v1/production-oee/machines — الماكينات النشطة مع التوقف المفتوح (لو فيه)
router.get("/production-oee/machines", requireAuth, requireRole(...OEE_READ_ROLES), async (_req, res, next) => {
  try {
    const machines = await db.select({ id: foundationMachinesTable.id, code: foundationMachinesTable.code, name: foundationMachinesTable.name, status: foundationMachinesTable.status }).from(foundationMachinesTable).where(and(eq(foundationMachinesTable.active, true))).orderBy(foundationMachinesTable.code);
    const open = await db.select().from(productionDowntimesTable).where(isNull(productionDowntimesTable.endedAt));
    const byMachine = new Map(open.filter((o) => o.machineId !== null && o.startedAt).map((o) => [o.machineId!, o]));
    res.json({ data: machines.filter((m) => m.status !== "retired").map((m) => ({ ...m, openStoppage: byMachine.get(m.id) ? { id: byMachine.get(m.id)!.id, reasonCode: byMachine.get(m.id)!.reasonCode, startedAt: byMachine.get(m.id)!.startedAt, notes: byMachine.get(m.id)!.notes } : null })) });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/production-oee/stoppages — آخر التوقفات (الأحدث الأول)
router.get("/production-oee/stoppages", requireAuth, requireRole(...OEE_READ_ROLES), async (req, res, next) => {
  try {
    const machineId = Number(req.query.machineId);
    const rows = await db.select().from(productionDowntimesTable).where(Number.isInteger(machineId) && machineId > 0 ? eq(productionDowntimesTable.machineId, machineId) : undefined).orderBy(desc(productionDowntimesTable.createdAt)).limit(100);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/production-oee/stoppages — بدء توقف (مفتوح لحد ما يتقفل). توقف مفتوح واحد لكل ماكينة.
router.post("/production-oee/stoppages", requireAuth, requireRole(...STOPPAGE_WRITE_ROLES), async (req, res, next) => {
  try {
    const data = startStoppageSchema.parse(req.body);
    if (!isStoppageReason(data.reasonCode)) throw fail(400, "سبب التوقف غير معروف");
    const created = await db.transaction(async (tx) => {
      const [machine] = await tx.select({ id: foundationMachinesTable.id, active: foundationMachinesTable.active, status: foundationMachinesTable.status }).from(foundationMachinesTable).where(eq(foundationMachinesTable.id, data.machineId)).for("update");
      if (!machine) throw fail(404, "الماكينة غير موجودة");
      if (!machine.active || machine.status === "retired") throw fail(409, "الماكينة موقوفة أو متقاعدة");
      const [open] = await tx.select({ id: productionDowntimesTable.id }).from(productionDowntimesTable).where(and(eq(productionDowntimesTable.machineId, data.machineId), isNull(productionDowntimesTable.endedAt)));
      if (open) throw fail(409, "الماكينة دي عليها توقف مفتوح بالفعل");
      let workflowOrderId: number | null = null;
      if (data.batchId) {
        const [batch] = await tx.select({ id: productionBatchesTable.id, orderId: productionBatchesTable.workflowOrderId }).from(productionBatchesTable).where(eq(productionBatchesTable.id, data.batchId));
        if (!batch) throw fail(404, "دفعة الإنتاج غير موجودة");
        workflowOrderId = batch.orderId;
      }
      const [row] = await tx.insert(productionDowntimesTable).values({ machineId: data.machineId, batchId: data.batchId ?? null, workflowOrderId, reasonCode: data.reasonCode, minutes: 0, notes: data.notes ?? null, startedAt: new Date(), recordedBy: req.user!.userId }).returning();
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "production.stoppage.start", resourceType: "foundation_machine", resourceId: data.machineId, beforeData: null, afterData: { stoppageId: row!.id, reasonCode: data.reasonCode, batchId: data.batchId ?? null }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      return row;
    });
    res.status(201).json({ data: created });
  } catch (err) {
    sendErr(err, res, next);
  }
});

// POST /api/v1/production-oee/stoppages/:id/end — إنهاء التوقف: الدقايق بتتحسب من الوقتين في السيرفر
router.post("/production-oee/stoppages/:id/end", requireAuth, requireRole(...STOPPAGE_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const data = endStoppageSchema.parse(req.body ?? {});
    const ended = await db.transaction(async (tx) => {
      const [stop] = await tx.select().from(productionDowntimesTable).where(eq(productionDowntimesTable.id, id)).for("update");
      if (!stop || !stop.startedAt) throw fail(404, "التوقف غير موجود");
      if (stop.endedAt) throw fail(409, "التوقف ده اتقفل قبل كده");
      const now = new Date();
      const minutes = stoppageMinutes(stop.startedAt, now);
      const notes = [stop.notes, data.notes].filter(Boolean).join(" — ") || null;
      const [row] = await tx.update(productionDowntimesTable).set({ endedAt: now, minutes, notes }).where(eq(productionDowntimesTable.id, id)).returning();
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "production.stoppage.end", resourceType: "foundation_machine", resourceId: stop.machineId ?? 0, beforeData: { stoppageId: id, endedAt: null }, afterData: { stoppageId: id, minutes }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      return row;
    });
    res.json({ data: ended });
  } catch (err) {
    sendErr(err, res, next);
  }
});

// GET /api/v1/production-oee/report?from=YYYY-MM-DD&to=YYYY-MM-DD — OEE بالماكينة (من غير تخمين: الناقص null)
router.get("/production-oee/report", requireAuth, requireRole(...OEE_READ_ROLES), async (req, res, next) => {
  try {
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if (!isIsoDate(from) || !isIsoDate(to)) throw fail(400, "حدد الفترة من تاريخ لتاريخ (YYYY-MM-DD)");
    const report = await buildOeeReport(from, to);
    if (!report) throw fail(400, "الفترة غير صحيحة (من قبل إلى، وبحد أقصى سنة)");
    res.json({ data: report });
  } catch (err) {
    sendErr(err, res, next);
  }
});

export default router;
