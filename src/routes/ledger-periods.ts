/** @format */
// إقفال الفترة المحاسبية وإعادة فتحها (55). الإدارة العليا بس (finance). كل كتابة في معاملة واحدة، والإشعار بعد الالتزام.
//   GET  /ledger/periods/check        تحذيرات قبل الإقفال
//   GET  /ledger/period-events        سجل الإقفال والفتح
//   POST /ledger/periods/:id/close    { note? }
//   POST /ledger/periods/:id/reopen   { reason }  (سبب إلزامي)
import { Router } from "express";
import { db } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { parseIdParam } from "../lib/validate";
import { logger } from "../lib/logger";
import { notifyRoles } from "../lib/notifications";
import { PeriodError, closeChecklist, closePeriod, listEvents, reopenPeriod } from "../lib/periodClose";
import { closeBodySchema, reopenBodySchema } from "../lib/periodCloseCore";

const router = Router();
const view = [requireAuth, requireRole(...PERMISSIONS.finance.view)];
const write = [requireAuth, requireRole(...PERMISSIONS.finance.write)];

const actorOf = (req: { user?: { userId: number; username: string; role: string }; ip?: string; get: (h: string) => string | undefined }) => ({
  by: { userId: req.user!.userId, username: req.user!.username, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null },
  taskActor: { userId: req.user!.userId, roles: [req.user!.role], isManager: true },
});

/** رسايل ترجرات القاعدة (خط دفاع تاني). */
function dbGuard(err: unknown): never {
  const msg = String((err as { message?: string })?.message ?? "");
  if (msg.includes("GL_PERIOD_NOT_ENDED")) throw new PeriodError(409, "NOT_ENDED", "الشهر لسه ما خلصش، مينفعش يتقفل");
  if (msg.includes("GL_PERIOD_EARLIER_OPEN")) throw new PeriodError(409, "EARLIER_OPEN", "في فترة أقدم لسه مفتوحة، اقفلها الأول");
  if (msg.includes("GL_PERIOD_LATER_CLOSED")) throw new PeriodError(409, "LATER_CLOSED", "في فترة أحدث مقفولة، افتحها الأول");
  if (msg.includes("GL_PERIOD_REOPEN_REASON")) throw new PeriodError(422, "REASON_REQUIRED", "اكتب سبب إعادة الفتح");
  if (msg.includes("GL_PERIOD_")) throw new PeriodError(409, "BAD_STATE", "مينفعش تغيّر الفترة بالشكل ده");
  throw err;
}

router.get("/ledger/periods/check", ...view, async (_req, res, next) => {
  try {
    res.json(await closeChecklist(db));
  } catch (err) {
    next(err);
  }
});

router.get("/ledger/period-events", ...view, async (_req, res, next) => {
  try {
    res.json({ items: await listEvents(db) });
  } catch (err) {
    next(err);
  }
});

router.post("/ledger/periods/:id/close", ...write, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const body = closeBodySchema.parse(req.body ?? {});
    const { by, taskActor } = actorOf(req);
    await db.transaction((tx) => closePeriod(tx, id, body.note ?? null, by, taskActor)).catch(dbGuard);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/ledger/periods/:id/reopen", ...write, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const body = reopenBodySchema.parse(req.body ?? {});
    const { by } = actorOf(req);
    await db.transaction((tx) => reopenPeriod(tx, id, body.reason, by)).catch(dbGuard);
    try {
      await notifyRoles(["chairman", "executive_manager"], { type: "period_reopened", title: "اتفتحت فترة محاسبية", body: `${by.username} فتح فترة مقفولة. السبب: ${body.reason}`, referenceType: "gl_period" });
    } catch (err) {
      logger.error("period reopen: notice failed", { periodId: id, error: err instanceof Error ? err.message : String(err) });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
