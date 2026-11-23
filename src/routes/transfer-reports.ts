/** @format */
// إبلاغ العميل عن تحويل (53أ). مسارين:
//   البوابة:  GET/POST /portal/payments/reports  (صلاحية payments.report)
//   الموظفين: GET /transfer-reports، POST /transfer-reports/:id/confirm|reject  (الإدارة العليا = finance)
// كل قرار في معاملة واحدة (تقرير + تحصيل + دفتر + مهمة + تدقيق). إشعار العميل بعد الالتزام، وفشله ميلغيش القرار.
import { Router } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePortalAuth, requirePortalPermission } from "../middleware/portal-auth";
import { PERMISSIONS } from "../lib/permissions";
import { parseIdParam } from "../lib/validate";
import { logger } from "../lib/logger";
import { notifyPortalCustomer } from "../lib/portalNotifications";
import type { PayActor } from "../lib/payments";
import {
  TransferReportError, confirmReport, listCompanyReports, listStaffReports, pendingCount, rejectReport, reportTransfer,
} from "../lib/transferReports";
import { REPORT_STATUSES, confirmBodySchema, rejectBodySchema, reportBodySchema, toPortalView } from "../lib/transferReportsCore";

const router = Router();
const view = [requireAuth, requireRole(...PERMISSIONS.finance.view)];
const write = [requireAuth, requireRole(...PERMISSIONS.finance.write)];
const portal = [requirePortalAuth, requirePortalPermission("payments.report")];

const actorOf = (req: { user?: { userId: number; username: string; role: string }; ip?: string; get: (h: string) => string | undefined }) => {
  const payActor: PayActor = { userId: req.user!.userId, username: req.user!.username, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
  // finance = الرئيس والتنفيذي، وكلهم مديرين للمهام، فالمهمة بتتقفل باسمهم.
  return { payActor, taskActor: { userId: req.user!.userId, roles: [req.user!.role], isManager: true } };
};

/** رسايل ترجرات القاعدة (خط دفاع تاني). */
function dbGuard(err: unknown): never {
  const msg = String((err as { message?: string })?.message ?? "");
  const c = (err as { code?: string; constraint?: string });
  if (c.code === "23505" && c.constraint === "transfer_reports_reference_unique") throw new TransferReportError(409, "DUPLICATE_REFERENCE", "رقم العملية ده اتبلّغ عنه قبل كده");
  if (msg.includes("TRANSFER_REPORT_FINAL")) throw new TransferReportError(409, "ALREADY_DECIDED", "التقرير ده اتقرر فيه قبل كده");
  if (msg.includes("GL_PERIOD_CLOSED")) throw new TransferReportError(422, "PERIOD_CLOSED", "الفترة دي مقفولة ومينفعش يتسجّل عليها قيد");
  throw err;
}

async function memberName(memberId: number): Promise<string> {
  const res = (await db.execute(sql`select u.full_name from portal_members m join portal_users u on u.id = m.user_id where m.id = ${memberId}`)) as unknown as { rows: Array<{ full_name: string }> };
  return res.rows[0]?.full_name ?? "عضو في الشركة";
}

router.get("/portal/payments/reports", ...portal, async (req, res, next) => {
  try {
    const rows = await listCompanyReports(db, req.portalAuth!.companyId);
    res.json({ items: rows.map(toPortalView) });
  } catch (err) {
    next(err);
  }
});

router.post("/portal/payments/reports", ...portal, async (req, res, next) => {
  try {
    const body = reportBodySchema.parse(req.body);
    const a = req.portalAuth!;
    const name = await memberName(a.memberId);
    const row = await db
      .transaction((tx) => reportTransfer(tx, { companyId: a.companyId, memberId: a.memberId, name, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null }, body))
      .catch(dbGuard);
    res.status(201).json(toPortalView(row));
  } catch (err) {
    next(err);
  }
});

const listQuery = z.object({ status: z.enum(REPORT_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });

router.get("/transfer-reports", ...view, async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    const items = await listStaffReports(db, q);
    res.json({ items, pending: await pendingCount(db) });
  } catch (err) {
    next(err);
  }
});

async function notifyCustomer(portalCustomerId: number, id: number, notice: { title: string; body: string }) {
  try {
    await notifyPortalCustomer(portalCustomerId, { type: "payment", title: notice.title, body: notice.body, referenceType: "transfer_report", referenceId: id });
  } catch (err) {
    logger.error("transfer report: customer notice failed", { reportId: id, error: err instanceof Error ? err.message : String(err) });
  }
}

router.post("/transfer-reports/:id/confirm", ...write, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const body = confirmBodySchema.parse(req.body ?? {});
    const { payActor, taskActor } = actorOf(req);
    const out = await db.transaction((tx) => confirmReport(tx, id, body, payActor, taskActor)).catch(dbGuard);
    await notifyCustomer(out.report.portalCustomerId, id, out.notice);
    res.json(out.report);
  } catch (err) {
    next(err);
  }
});

router.post("/transfer-reports/:id/reject", ...write, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const body = rejectBodySchema.parse(req.body ?? {});
    const { payActor, taskActor } = actorOf(req);
    const out = await db.transaction((tx) => rejectReport(tx, id, body.reason, payActor, taskActor)).catch(dbGuard);
    await notifyCustomer(out.report.portalCustomerId, id, out.notice);
    res.json(out.report);
  } catch (err) {
    next(err);
  }
});

export default router;
