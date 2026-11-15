/** @format */
// التحصيلات (50): تسجيل تحصيل من عميل وتوزيعه على الفواتير (تلقائي الأقدم الأول أو يدوي)، توزيع الباقي لاحقًا، والإلغاء.
// للإدارة العليا (finance) لحد ما يتحدد دور محاسب. كل الكتابة بمعاملة واحدة مع التدقيق (ADR 0037).
import { Router } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { parseIdParam } from "../lib/validate";
import { isIsoDate } from "../lib/ledgerCore";
import { centsDecimal } from "../lib/ledgerAutoCore";
import { allocatePayment, createPayment, openInvoicesFor, voidPayment, type PayActor } from "../lib/payments";
import { PAYMENT_METHODS, outstandingCents, parsePaymentAmount, type AllocationLine } from "../lib/paymentsCore";

const router = Router();
const view = [requireAuth, requireRole(...PERMISSIONS.finance.view)];
const write = [requireAuth, requireRole(...PERMISSIONS.finance.write)];
const fail = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const isoDate = z.string().refine(isIsoDate, "تاريخ غير صحيح");
const actorOf = (req: { user?: { userId: number; username: string }; ip?: string; get: (h: string) => string | undefined }): PayActor => ({ userId: req.user!.userId, username: req.user!.username, ip: req.ip, userAgent: req.get("user-agent") });

/** رسايل ترجرات القاعدة (خط دفاع تاني). */
function dbGuard(err: unknown): never {
  const msg = String((err as { message?: string })?.message ?? "");
  if (msg.includes("PAY_ALLOCATION_EXCEEDS")) throw fail(422, "مجموع التخصيص أكبر من مبلغ التحصيل", "EXCEEDS_PAYMENT");
  if (msg.includes("PAY_ALLOCATION_IMMUTABLE")) throw fail(409, "التخصيصات مبتتعدّلش ولا بتتمسح", "IMMUTABLE");
  if (msg.includes("GL_PERIOD_CLOSED")) throw fail(422, "الفترة دي مقفولة ومينفعش يتسجّل عليها قيد", "PERIOD_CLOSED");
  throw err;
}

const allocationsSchema = z.array(z.object({ orderId: z.number().int().positive(), amount: z.string() })).max(200);
function toLines(items: Array<{ orderId: number; amount: string }>): AllocationLine[] {
  return items.map((a) => {
    const p = parsePaymentAmount(a.amount);
    if (!p.ok) throw fail(422, p.error, "BAD_AMOUNT");
    return { orderId: a.orderId, cents: p.cents };
  });
}

const listQuery = z.object({
  contactId: z.coerce.number().int().positive().optional(),
  status: z.enum(["posted", "voided"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

router.get("/payments", ...view, async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    const rows = await db.execute(sql`
      select p.id, p.payment_number as "paymentNumber", p.contact_id as "contactId", c.name as "contactName",
             p.payment_date::text as "paymentDate", p.method, p.amount::text as amount, p.status, p.reference,
             coalesce((select sum(a.amount) from payment_allocations a where a.payment_id = p.id), 0)::text as allocated
      from customer_payments p join contacts c on c.id = p.contact_id
      where (${q.contactId ?? null}::int is null or p.contact_id = ${q.contactId ?? null})
        and (${q.status ?? null}::text is null or p.status = ${q.status ?? null})
        and (${q.from ?? null}::date is null or p.payment_date >= ${q.from ?? null}::date)
        and (${q.to ?? null}::date is null or p.payment_date <= ${q.to ?? null}::date)
      order by p.payment_date desc, p.id desc
      limit ${q.limit}`);
    res.json({ items: rows.rows });
  } catch (err) {
    next(err);
  }
});

router.get("/payments/open-invoices", ...view, async (req, res, next) => {
  try {
    const contactId = z.coerce.number().int().positive().parse(req.query.contactId);
    const invoices = await openInvoicesFor(db, contactId);
    const adv = (await db.execute(sql`
      select coalesce(sum(p.amount - coalesce((select sum(a.amount) from payment_allocations a where a.payment_id = p.id), 0)), 0)::text as s
      from customer_payments p where p.contact_id = ${contactId} and p.status = 'posted'`)) as { rows: Array<{ s: string }> };
    res.json({
      items: invoices.filter((i) => outstandingCents(i) > 0n).map((i) => ({ orderId: i.orderId, orderNumber: i.orderNumber, date: i.date, total: centsDecimal(i.totalCents), paid: centsDecimal(i.paidCents), outstanding: centsDecimal(outstandingCents(i)) })),
      advanceBalance: adv.rows[0]?.s ?? "0",
    });
  } catch (err) {
    next(err);
  }
});

router.get("/payments/:id", ...view, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const head = await db.execute(sql`
      select p.id, p.payment_number as "paymentNumber", p.contact_id as "contactId", c.name as "contactName", p.payment_date::text as "paymentDate",
             p.method, p.amount::text as amount, p.status, p.reference, p.notes, p.void_reason as "voidReason", p.journal_entry_id as "journalEntryId",
             p.created_by_name as "createdByName"
      from customer_payments p join contacts c on c.id = p.contact_id where p.id = ${id}`);
    const payment = head.rows[0];
    if (!payment) throw fail(404, "التحصيل مش موجود", "PAYMENT_NOT_FOUND");
    const allocs = await db.execute(sql`
      select a.id, a.sales_order_id as "orderId", o.order_number as "orderNumber", o.status as "orderStatus", a.amount::text as amount
      from payment_allocations a join sales_orders o on o.id = a.sales_order_id where a.payment_id = ${id} order by a.id`);
    const allocated = allocs.rows.reduce((s, r) => s + Math.round(Number((r as { amount: string }).amount) * 100), 0);
    res.json({ ...payment, allocations: allocs.rows, unallocated: ((Math.round(Number((payment as { amount: string }).amount) * 100) - allocated) / 100).toFixed(2) });
  } catch (err) {
    next(err);
  }
});

const createBody = z.object({
  contactId: z.number().int().positive(),
  paymentDate: isoDate,
  method: z.enum(PAYMENT_METHODS),
  amount: z.string(),
  reference: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  allocations: allocationsSchema.optional(),
});

router.post("/payments", ...write, async (req, res, next) => {
  try {
    const body = createBody.parse(req.body);
    const amount = parsePaymentAmount(body.amount);
    if (!amount.ok) throw fail(422, amount.error, "BAD_AMOUNT");
    const lines = body.allocations ? toLines(body.allocations) : undefined;
    const result = await db
      .transaction((tx) => createPayment(tx, { contactId: body.contactId, paymentDate: body.paymentDate, method: body.method, amountCents: amount.cents, reference: body.reference, notes: body.notes, allocations: lines }, actorOf(req)))
      .catch(dbGuard);
    res.status(201).json({ id: result.id, paymentNumber: result.paymentNumber, allocated: centsDecimal(result.allocatedCents), unallocated: centsDecimal(result.unallocatedCents), entryNumber: result.entryNumber, autoPaid: result.autoPaid });
  } catch (err) {
    next(err);
  }
});

router.post("/payments/:id/allocate", ...write, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const body = z.object({ allocations: allocationsSchema.min(1) }).parse(req.body);
    const lines = toLines(body.allocations);
    const result = await db.transaction((tx) => allocatePayment(tx, id, lines, actorOf(req))).catch(dbGuard);
    res.json({ allocated: centsDecimal(result.allocatedCents), remaining: centsDecimal(result.remainingCents), autoPaid: result.autoPaid });
  } catch (err) {
    next(err);
  }
});

router.post("/payments/:id/void", ...write, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const body = z.object({ reason: z.string().trim().min(3, "اكتب سبب الإلغاء").max(300) }).parse(req.body ?? {});
    const result = await db.transaction((tx) => voidPayment(tx, id, body.reason, actorOf(req))).catch(dbGuard);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
