/** @format */
/**
 * Plan 09 — portal orders desk (staff side, read side).
 * Prefix: /portal-admin/orders. Decisions stay on the legacy
 * POST /portal-orders/:batchRef/{confirm,reject} and /portal-orders/:id/{claim,cancel}.
 */
import { Router } from "express";
import { z } from "zod";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  portalCustomersTable,
  portalMembersTable,
  portalOrderReviewsTable,
  portalUsersTable,
  productionWorkflowOrdersTable as W,
  salesOrdersTable,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { domainError } from "../lib/portalTeam";
import { resolveSetting } from "../lib/portalSettings";
import { getAssignedSalesByCustomerId } from "../lib/salesAssignment";
import { batchProgress, batchStatus, lineStage, CLAIMABLE } from "../lib/portalOrderDesk";
import { isCancellableStatus } from "../lib/cancellation";

const router = Router();
const view = [requireAuth, requireRole(...PERMISSIONS.sales.view)];
const BASE = "/portal-admin/orders";
const STATUSES = ["pending", "confirmed", "rejected", "cancelled"];

async function slaLimits() {
  const [warn, late] = await Promise.all([
    resolveSetting<number>("applications.sla.warn_hours", {}),
    resolveSetting<number>("applications.sla.late_hours", {}),
  ]);
  return { warnHours: warn, lateHours: Math.max(late, warn) };
}

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(20).optional(),
  company: z.coerce.number().int().positive().optional(),
  age: z.enum(["warn", "late"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** CTE واحد بيجمّع الأصناف في إرساليات ويحسب حالة كل إرسالية. */
const BATCHES = sql`
  SELECT b.*, r.status AS review_status, r.created_at AS reviewed_at, r.reviewed_by_name,
         r.sales_order_id, so.order_number AS invoice_number,
         CASE WHEN r.status IS NOT NULL THEN r.status
              WHEN b.cancelled_lines = b.lines THEN 'cancelled'
              ELSE 'pending' END AS status
    FROM (
      SELECT w.sales_order_ref AS batch_ref,
             min(w.created_at) AS submitted_at,
             max(w.customer_name) AS customer_name,
             max(w.customer_phone) AS customer_phone,
             max(w.portal_customer_id) AS company_id,
             count(*)::int AS lines,
             (count(*) FILTER (WHERE w.workflow_status = 'cancelled'))::int AS cancelled_lines,
             coalesce(sum(w.qty), 0)::text AS total_qty,
             coalesce(sum(w.reference_line_total), 0)::text AS reference_total,
             coalesce(bool_or(w.cancel_stage IS NOT NULL), false) AS late_cancel,
             array_agg(w.workflow_status) AS statuses
        FROM production_workflow_orders w
       WHERE w.portal_customer_id IS NOT NULL AND w.sales_order_ref IS NOT NULL
       GROUP BY w.sales_order_ref
    ) b
    LEFT JOIN portal_order_reviews r ON r.batch_ref = b.batch_ref
    LEFT JOIN sales_orders so ON so.id = r.sales_order_id`;

type BatchRow = {
  batch_ref: string; submitted_at: Date; customer_name: string | null; customer_phone: string | null;
  company_id: number; lines: number; cancelled_lines: number; total_qty: string; reference_total: string;
  late_cancel: boolean; statuses: string[]; review_status: string | null; reviewed_at: Date | null;
  reviewed_by_name: string | null; sales_order_id: number | null; invoice_number: string | null; status: string;
};

function presentBatch(r: BatchRow, limits: { warnHours: number; lateHours: number }) {
  const ageHours = Math.max(0, Math.floor((Date.now() - new Date(r.submitted_at).getTime()) / 3_600_000));
  const sla = r.status !== "pending" ? "done" : ageHours >= limits.lateHours ? "late" : ageHours >= limits.warnHours ? "warn" : "ok";
  return {
    batchRef: r.batch_ref,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    companyId: r.company_id,
    status: r.status as string,
    progress: r.status === "confirmed" ? batchProgress(r.statuses) : null,
    lines: r.lines,
    cancelledLines: r.cancelled_lines,
    totalQty: r.total_qty,
    referenceTotal: r.reference_total,
    lateCancel: r.late_cancel,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at,
    reviewedByName: r.reviewed_by_name,
    invoiceNumber: r.invoice_number,
    ageHours,
    sla,
  };
}

router.get(`${BASE}/meta`, ...view, async (_req, res, next) => {
  try {
    res.json({ sla: await slaLimits() });
  } catch (e) {
    next(e);
  }
});

router.get(BASE, ...view, async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    const limits = await slaLimits();
    const st = q.status || "pending";
    const conds = [sql`TRUE`];
    if (st !== "all") conds.push(sql`x.status = ${STATUSES.includes(st) ? st : "pending"}`);
    if (q.q) {
      const like = `%${q.q.replace(/[%_]/g, "")}%`;
      conds.push(sql`(x.customer_name ILIKE ${like} OR x.customer_phone ILIKE ${like} OR x.batch_ref ILIKE ${like})`);
    }
    if (q.company) conds.push(sql`x.company_id = ${q.company}`);
    if (q.age) {
      const hours = q.age === "late" ? limits.lateHours : limits.warnHours;
      conds.push(sql`x.status = 'pending' AND x.submitted_at <= now() - (${hours} * interval '1 hour')`);
    }
    const where = sql.join(conds, sql` AND `);
    const rows = await db.execute(sql`SELECT x.* FROM (${BATCHES}) x WHERE ${where} ORDER BY x.submitted_at DESC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`);
    const total = await db.execute(sql`SELECT count(*)::int AS n FROM (${BATCHES}) x WHERE ${where}`);
    const counts = await db.execute(sql`SELECT x.status, count(*)::int AS n FROM (${BATCHES}) x GROUP BY x.status`);
    const countMap: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const c of counts.rows as Array<{ status: string; n: number }>) countMap[c.status] = c.n;
    res.json({
      items: (rows.rows as BatchRow[]).map((r) => presentBatch(r, limits)),
      total: (total.rows[0] as { n: number } | undefined)?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
      counts: countMap,
    });
  } catch (e) {
    next(e);
  }
});

router.get(`${BASE}/:batchRef`, ...view, async (req, res, next) => {
  try {
    const batchRef = String(req.params.batchRef);
    const limits = await slaLimits();
    const found = await db.execute(sql`SELECT x.* FROM (${BATCHES}) x WHERE x.batch_ref = ${batchRef} LIMIT 1`);
    const row = found.rows[0] as BatchRow | undefined;
    if (!row) throw domainError(404, "BATCH_NOT_FOUND", "الإرسالية غير موجودة");

    const lines = await db.select().from(W).where(eq(W.salesOrderRef, batchRef)).orderBy(asc(W.id));
    const memberIds = [...new Set(lines.map((l) => l.submittedByMemberId).filter((x): x is number => !!x))];
    const members = memberIds.length
      ? await db
          .select({ id: portalMembersTable.id, name: portalUsersTable.fullName })
          .from(portalMembersTable)
          .innerJoin(portalUsersTable, eq(portalUsersTable.id, portalMembersTable.userId))
          .where(inArray(portalMembersTable.id, memberIds))
      : [];
    const memberName = new Map(members.map((m) => [m.id, m.name]));

    const [review] = await db.select().from(portalOrderReviewsTable).where(eq(portalOrderReviewsTable.batchRef, batchRef)).limit(1);
    const [invoice] = review?.salesOrderId
      ? await db
          .select({ id: salesOrdersTable.id, orderNumber: salesOrdersTable.orderNumber, status: salesOrdersTable.status, total: salesOrdersTable.total })
          .from(salesOrdersTable)
          .where(eq(salesOrdersTable.id, review.salesOrderId))
          .limit(1)
      : [];
    const [company] = await db
      .select({ id: portalCustomersTable.id, companyName: portalCustomersTable.companyName, phone: portalCustomersTable.phone, isActive: portalCustomersTable.isActive })
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.id, row.company_id))
      .limit(1);
    const assigned = await getAssignedSalesByCustomerId([row.company_id]);

    const first = lines[0]!;
    const items = lines.map((l) => ({
      id: l.id,
      orderNumber: l.orderNumber,
      productName: l.productName,
      qty: l.qty,
      unit: l.unit,
      neededBy: l.neededBy,
      notes: l.notes,
      workflowStatus: l.workflowStatus,
      stage: lineStage(l.workflowStatus),
      referenceUnitPrice: l.referenceUnitPrice,
      referenceLineTotal: l.referenceLineTotal,
      suggestedDueDate: l.suggestedDueDate,
      suggestedDeliveryMethod: l.suggestedDeliveryMethod,
      submittedBy: l.submittedByMemberId ? (memberName.get(l.submittedByMemberId) ?? null) : null,
      cancelReason: l.cancelReason,
      cancelledAt: l.cancelledAt,
      cancelledByName: l.cancelledByName,
      cancelStage: l.cancelStage,
      claimedAt: l.claimedAt,
      claimedByName: l.claimedByName,
      canCancel: isCancellableStatus(l.workflowStatus),
      canClaim: CLAIMABLE.has(l.workflowStatus) && review?.status === "confirmed",
    }));

    type Ev = { kind: string; at: Date | string; actor: string | null; note: string | null; line?: string };
    const events: Ev[] = [{ kind: "submitted", at: row.submitted_at, actor: items.find((i) => i.submittedBy)?.submittedBy ?? row.customer_name, note: null }];
    if (review) events.push({ kind: review.status === "rejected" ? "rejected" : "confirmed", at: review.createdAt, actor: review.reviewedByName, note: review.rejectReason || review.replyMessage });
    for (const l of lines) {
      if (l.claimedAt) events.push({ kind: "claimed", at: l.claimedAt, actor: l.claimedByName, note: null, line: l.productName });
      if (l.cancelledAt && !(review?.status === "rejected")) events.push({ kind: l.cancelStage ? "cancelled_late" : "cancelled", at: l.cancelledAt, actor: l.cancelledByName, note: l.cancelReason, line: l.productName });
    }
    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    res.json({
      batch: presentBatch(row, limits),
      priority: first.priority,
      notes: first.notes,
      neededBy: first.neededBy,
      company: company ?? null,
      assignedSales: assigned.get(row.company_id) ?? null,
      review: review ? { status: review.status, replyMessage: review.replyMessage, rejectReason: review.rejectReason, expectedDelivery: review.expectedDelivery, reviewedByName: review.reviewedByName, createdAt: review.createdAt } : null,
      invoice: invoice ?? null,
      items,
      events,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
