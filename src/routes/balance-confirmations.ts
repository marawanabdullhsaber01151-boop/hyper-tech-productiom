/** @format */
// تأكيد الأرصدة (53ب). مسارين:
//   البوابة:  GET /portal/balances، POST /portal/balances/:id/agree|dispute  (صلاحية payments.confirm_balance، إقرار مالي)
//   الموظفين: GET/POST /balance-confirmations، POST /:id/resolve|cancel  (الإدارة العليا = finance)
// كل كتابة في معاملة واحدة. إشعار العميل بعد الالتزام وفشله ميلغيش القرار.
import { Router, type NextFunction, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePortalAuth, requirePortalPermission } from "../middleware/portal-auth";
import { PERMISSIONS } from "../lib/permissions";
import { parseIdParam } from "../lib/validate";
import { logger } from "../lib/logger";
import { todayCairo } from "../lib/operationsCapacityCore";
import { notifyPortalCustomer } from "../lib/portalNotifications";
import { BalanceError, agree, cancel, dispute, listCompanyConfirmations, listStaffConfirmations, needsAttentionCount, requestConfirmation, resolve } from "../lib/balanceConfirmations";
import { CONFIRM_STATUSES, cancelBodySchema, disputeBodySchema, requestBodySchema, resolveBodySchema, toPortalView } from "../lib/balanceConfirmationsCore";

const router = Router();
const view = [requireAuth, requireRole(...PERMISSIONS.finance.view)];
const write = [requireAuth, requireRole(...PERMISSIONS.finance.write)];
const portal = [requirePortalAuth, requirePortalPermission("payments.confirm_balance")];

const actorOf = (req: { user?: { userId: number; username: string; role: string }; ip?: string; get: (h: string) => string | undefined }) => ({
  by: { userId: req.user!.userId, username: req.user!.username, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null },
  taskActor: { userId: req.user!.userId, roles: [req.user!.role], isManager: true },
});

/** رسايل ترجرات القاعدة (خط دفاع تاني). */
function dbGuard(err: unknown): never {
  const msg = String((err as { message?: string })?.message ?? "");
  const c = err as { code?: string; constraint?: string };
  if (c.code === "23505" && c.constraint === "balance_conf_one_active") throw new BalanceError(409, "ALREADY_ACTIVE", "في طلب لسه شغّال للعميل ده");
  if (msg.includes("BALANCE_BAD_TRANSITION")) throw new BalanceError(409, "NOT_OPEN", "الطلب ده اتقرر فيه قبل كده");
  throw err;
}

async function memberName(memberId: number): Promise<string> {
  const res = (await db.execute(sql`select u.full_name from portal_members m join portal_users u on u.id = m.user_id where m.id = ${memberId}`)) as unknown as { rows: Array<{ full_name: string }> };
  return res.rows[0]?.full_name ?? "عضو في الشركة";
}

async function notifyCustomer(portalCustomerId: number, id: number, notice: { title: string; body: string }) {
  try {
    await notifyPortalCustomer(portalCustomerId, { type: "balance", title: notice.title, body: notice.body, referenceType: "balance_confirmation", referenceId: id });
  } catch (err) {
    logger.error("balance confirmation: customer notice failed", { confirmationId: id, error: err instanceof Error ? err.message : String(err) });
  }
}

router.get("/portal/balances", ...portal, async (req, res, next) => {
  try {
    const today = todayCairo(new Date());
    const rows = await listCompanyConfirmations(db, req.portalAuth!.companyId);
    res.json({ items: rows.map((r) => toPortalView(r, today)) });
  } catch (err) {
    next(err);
  }
});

async function portalReply(req: Request, res: Response, next: NextFunction, kind: "agree" | "dispute") {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const a = req.portalAuth!;
    const who = { companyId: a.companyId, memberId: a.memberId, name: await memberName(a.memberId), ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
    const row =
      kind === "agree"
        ? await db.transaction((tx) => agree(tx, id, who)).catch(dbGuard)
        : await db.transaction((tx) => dispute(tx, id, who, disputeBodySchema.parse(req.body ?? {}))).catch(dbGuard);
    res.json(toPortalView(row, todayCairo(new Date())));
  } catch (err) {
    next(err);
  }
}
router.post("/portal/balances/:id/agree", ...portal, (req, res, next) => void portalReply(req, res, next, "agree"));
router.post("/portal/balances/:id/dispute", ...portal, (req, res, next) => void portalReply(req, res, next, "dispute"));

const listQuery = z.object({ status: z.enum(CONFIRM_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });

router.get("/balance-confirmations", ...view, async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    res.json({ items: await listStaffConfirmations(db, q), attention: await needsAttentionCount(db, todayCairo(new Date())) });
  } catch (err) {
    next(err);
  }
});

router.post("/balance-confirmations", ...write, async (req, res, next) => {
  try {
    const body = requestBodySchema.parse(req.body ?? {});
    const { by } = actorOf(req);
    const out = await db.transaction((tx) => requestConfirmation(tx, body, by)).catch(dbGuard);
    await notifyCustomer(out.row.portalCustomerId, out.row.id, out.notice);
    res.status(201).json(out.row);
  } catch (err) {
    next(err);
  }
});

router.post("/balance-confirmations/:id/resolve", ...write, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const body = resolveBodySchema.parse(req.body ?? {});
    const { by, taskActor } = actorOf(req);
    const out = await db.transaction((tx) => resolve(tx, id, body.note, by, taskActor)).catch(dbGuard);
    await notifyCustomer(out.row.portalCustomerId, id, out.notice);
    res.json(out.row);
  } catch (err) {
    next(err);
  }
});

router.post("/balance-confirmations/:id/cancel", ...write, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const body = cancelBodySchema.parse(req.body ?? {});
    const { by, taskActor } = actorOf(req);
    const out = await db.transaction((tx) => cancel(tx, id, body.reason, by, taskActor)).catch(dbGuard);
    await notifyCustomer(out.row.portalCustomerId, id, out.notice);
    res.json(out.row);
  } catch (err) {
    next(err);
  }
});

export default router;
