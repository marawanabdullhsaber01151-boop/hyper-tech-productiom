/** @format */
// تحصيلات العملاء (50). كل الدوال جوه معاملة المتصل. ترتيب الأقفال ثابت (عشان مفيش deadlock):
//   قفل التحصيلات 4802 ← صفوف أوامر العميل (بترتيب الرقم) ← سلسلة التدقيق ← الدفتر (lockLedger).
// الترحيل المحاسبي بيحصل بس لو الترحيل التلقائي شغّال وتاريخ التحصيل مش قبل تاريخ البداية (نفس قاعدة 49: للأمام بس).
import { eq, sql } from "drizzle-orm";
import { contactsTable, salesOrdersTable, glJournalEntriesTable, glJournalLinesTable } from "../db";
import { customerPaymentsTable, paymentAllocationsTable } from "../db/schema";
import { writeAuditEvent } from "./governance";
import { getAutoPostingStart } from "./ledgerAuto";
import { LedgerError, postJournalEntry } from "./ledger";
import { reverseLines } from "./ledgerCore";
import { centsDecimal } from "./ledgerAutoCore";
import { todayCairo } from "./operationsCapacityCore";
import { nextPhase0Number } from "./phase0";
import { toCents } from "./money";
import {
  ALLOCATION_ISSUE_TEXT, PAYMENT_ACCOUNT_CODES, SOURCE_CUSTOMER_PAYMENT, SOURCE_PAYMENT_ALLOCATION,
  advanceApplyLines, cashAccountCode, checkAllocations, fifoAllocate, outstandingCents, paymentEntryLines,
  type AllocationLine, type OpenInvoice, type PaymentMethod,
} from "./paymentsCore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = any;
export interface PayActor { userId: number | null; username: string | null; ip?: string | null; userAgent?: string | null }
const PAYMENT_LOCK = 4802;
// أوامر قابلة للتخصيص: confirmed وshipped بس. «مدفوع» (يدويًا من قبل كده) مش مديونية، فبيتخطى.

export class PaymentError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const signed = (v: string): bigint => (v.startsWith("-") ? -toCents(v.slice(1)) : toCents(v));

async function lockCustomerOrders(tx: Exec, contactId: number): Promise<void> {
  await tx.execute(sql`select id from sales_orders where contact_id = ${contactId} and status in ('confirmed','shipped') order by id for update`);
}

/** الفواتير المفتوحة للعميل (قبل فلترة المتبقي)، مع المدفوع من تحصيلات سارية. */
export async function openInvoicesFor(exec: Exec, contactId: number): Promise<OpenInvoice[]> {
  const res = (await exec.execute(sql`
    select o.id as id, o.order_number as number, o.date::text as date, o.total::text as total,
           coalesce(sum(a.amount) filter (where p.status = 'posted'), 0)::text as paid
    from sales_orders o
    left join payment_allocations a on a.sales_order_id = o.id
    left join customer_payments p on p.id = a.payment_id
    where o.contact_id = ${contactId} and o.status in ('confirmed','shipped')
    group by o.id
    order by o.date, o.id`)) as { rows: Array<{ id: number; number: string; date: string; total: string; paid: string }> };
  return res.rows.map((r) => ({ orderId: Number(r.id), orderNumber: r.number, date: String(r.date).slice(0, 10), totalCents: signed(r.total), paidCents: signed(r.paid) }));
}

async function allocatedSoFar(tx: Exec, paymentId: number): Promise<bigint> {
  const res = (await tx.execute(sql`select coalesce(sum(amount), 0)::text as s from payment_allocations where payment_id = ${paymentId}`)) as { rows: Array<{ s: string }> };
  return signed(res.rows[0]?.s ?? "0");
}

async function accountIds(tx: Exec, codes: string[]): Promise<Map<string, number>> {
  const res = (await tx.execute(sql`select id, code from gl_accounts where code in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})`)) as { rows: Array<{ id: number; code: string }> };
  const map = new Map(res.rows.map((r) => [r.code, Number(r.id)]));
  for (const c of codes) if (!map.has(c)) throw new LedgerError("AUTO_ACCOUNT_MISSING", `حساب ${c} مش موجود في دليل الحسابات، والتحصيل محتاجه`);
  return map;
}

/** هل التحصيل ده يتقيّد في الدفتر؟ (الترحيل شغّال، والتاريخ مش قبل البداية.) */
async function shouldPost(tx: Exec, paymentDate: string): Promise<boolean> {
  const start = await getAutoPostingStart(tx);
  return Boolean(start) && paymentDate >= (start as string);
}

async function audit(tx: Exec, actor: PayActor, actionKey: string, resourceType: string, resourceId: number, afterData: unknown, reason: string | null = null, beforeData?: unknown) {
  await writeAuditEvent({ executor: tx, actorUserId: actor.userId, actorName: actor.username, actionKey, resourceType, resourceId, beforeData, afterData, reason, ipAddress: actor.ip ?? null, userAgent: actor.userAgent ?? null });
}

/** المدفوع من تحصيلات سارية لكل أمر. */
async function paidByOrder(tx: Exec, orderIds: number[]): Promise<Map<number, bigint>> {
  const map = new Map<number, bigint>();
  if (orderIds.length === 0) return map;
  const res = (await tx.execute(sql`
    select a.sales_order_id as id, coalesce(sum(a.amount), 0)::text as paid
    from payment_allocations a join customer_payments p on p.id = a.payment_id
    where p.status = 'posted' and a.sales_order_id in (${sql.join(orderIds.map((i) => sql`${i}`), sql`, `)})
    group by a.sales_order_id`)) as { rows: Array<{ id: number; paid: string }> };
  for (const r of res.rows) map.set(Number(r.id), signed(r.paid));
  return map;
}

/** مشحون ومسدّد بالكامل ← مدفوع. (للأمام بس؛ الرجوع بيتم عند إلغاء تحصيل.) */
async function settleStatuses(tx: Exec, orderIds: number[], actor: PayActor, paymentNumber: string): Promise<number[]> {
  const flipped: number[] = [];
  const paid = await paidByOrder(tx, orderIds);
  for (const id of [...orderIds].sort((a, b) => a - b)) {
    const [o] = await tx.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, id)).limit(1);
    if (!o || o.status !== "shipped") continue;
    if ((paid.get(id) ?? 0n) >= signed(String(o.total))) {
      await tx.update(salesOrdersTable).set({ status: "paid", updatedAt: new Date() }).where(eq(salesOrdersTable.id, id));
      await audit(tx, actor, "payments.order_auto_paid", "sales_order", id, { status: "paid", payment: paymentNumber }, "سُدّد بالكامل من التحصيلات", { status: "shipped" });
      flipped.push(id);
    }
  }
  return flipped;
}

export interface CreatePaymentInput {
  contactId: number;
  paymentDate: string;
  method: PaymentMethod;
  amountCents: bigint;
  reference?: string | null;
  notes?: string | null;
  /** لو متبعتش: توزيع تلقائي (الأقدم الأول). مصفوفة فاضية = كله دفعة مقدمة. */
  allocations?: AllocationLine[];
}

export async function createPayment(tx: Exec, input: CreatePaymentInput, actor: PayActor) {
  await tx.execute(sql`select pg_advisory_xact_lock(${PAYMENT_LOCK})`);
  const today = todayCairo(new Date());
  if (input.paymentDate > today) throw new PaymentError(422, "FUTURE_DATE", "تاريخ التحصيل مينفعش يكون في المستقبل");
  const [contact] = await tx.select({ id: contactsTable.id, type: contactsTable.type, name: contactsTable.name }).from(contactsTable).where(eq(contactsTable.id, input.contactId)).limit(1);
  if (!contact) throw new PaymentError(404, "CONTACT_NOT_FOUND", "العميل مش موجود");
  if (contact.type === "supplier") throw new PaymentError(422, "NOT_A_CUSTOMER", "الجهة دي مورّد، والتحصيل للعملاء بس");

  await lockCustomerOrders(tx, input.contactId);
  const invoices = await openInvoicesFor(tx, input.contactId);
  const openMap = new Map(invoices.filter((i) => outstandingCents(i) > 0n).map((i) => [i.orderId, i]));
  let lines: AllocationLine[];
  if (input.allocations === undefined) {
    lines = fifoAllocate([...openMap.values()], input.amountCents).lines;
  } else {
    lines = input.allocations;
    if (lines.length > 0) {
      const issues = checkAllocations(lines, openMap, input.amountCents);
      if (issues.length) throw new PaymentError(422, issues[0], issues.map((i) => ALLOCATION_ISSUE_TEXT[i]).join(" | "));
    }
  }
  const allocatedCents = lines.reduce((a, l) => a + l.cents, 0n);

  const paymentNumber = await nextPhase0Number(tx, "customer_payment");
  const [payment] = await tx.insert(customerPaymentsTable).values({
    paymentNumber, contactId: input.contactId, paymentDate: input.paymentDate, method: input.method,
    amount: centsDecimal(input.amountCents), reference: input.reference?.trim() || null, notes: input.notes?.trim() || null,
    createdBy: actor.userId, createdByName: actor.username,
  }).returning();
  for (const l of lines) await tx.insert(paymentAllocationsTable).values({ paymentId: payment.id, salesOrderId: l.orderId, amount: centsDecimal(l.cents), createdByName: actor.username });

  const flipped = await settleStatuses(tx, lines.map((l) => l.orderId), actor, paymentNumber);
  await audit(tx, actor, "payments.created", "customer_payment", payment.id, { paymentNumber, contactId: input.contactId, amount: payment.amount, method: input.method, allocations: lines.map((l) => ({ orderId: l.orderId, amount: centsDecimal(l.cents) })), autoPaid: flipped });

  let entryNumber: string | null = null;
  if (await shouldPost(tx, input.paymentDate)) {
    const ids = await accountIds(tx, [cashAccountCode(input.method), PAYMENT_ACCOUNT_CODES.receivable, PAYMENT_ACCOUNT_CODES.advances]);
    const entry = await postJournalEntry(tx, {
      entryDate: input.paymentDate,
      description: `تحصيل ${paymentNumber} من ${contact.name}`,
      lines: paymentEntryLines({ cashId: ids.get(cashAccountCode(input.method))!, receivableId: ids.get(PAYMENT_ACCOUNT_CODES.receivable)!, advancesId: ids.get(PAYMENT_ACCOUNT_CODES.advances)!, amountCents: input.amountCents, allocatedCents, memo: paymentNumber }),
      sourceType: SOURCE_CUSTOMER_PAYMENT,
      sourceId: String(payment.id),
      createdBy: actor.userId,
      createdByName: actor.username,
    });
    await tx.update(customerPaymentsTable).set({ journalEntryId: entry.id }).where(eq(customerPaymentsTable.id, payment.id));
    entryNumber = entry.entryNumber;
  }
  return { id: payment.id, paymentNumber, allocatedCents, unallocatedCents: input.amountCents - allocatedCents, entryNumber, autoPaid: flipped };
}

/** توزيع الباقي (الدفعة المقدمة) من تحصيل سابق على فواتير. */
export async function allocatePayment(tx: Exec, paymentId: number, lines: AllocationLine[], actor: PayActor) {
  await tx.execute(sql`select pg_advisory_xact_lock(${PAYMENT_LOCK})`);
  const [payment] = await tx.select().from(customerPaymentsTable).where(eq(customerPaymentsTable.id, paymentId)).for("update").limit(1);
  if (!payment) throw new PaymentError(404, "PAYMENT_NOT_FOUND", "التحصيل مش موجود");
  if (payment.status !== "posted") throw new PaymentError(409, "PAYMENT_VOIDED", "التحصيل ده ملغي");
  await lockCustomerOrders(tx, payment.contactId);
  const available = signed(String(payment.amount)) - (await allocatedSoFar(tx, paymentId));
  if (available <= 0n) throw new PaymentError(409, "NOTHING_TO_ALLOCATE", "التحصيل ده متوزّع بالكامل");
  const openMap = new Map((await openInvoicesFor(tx, payment.contactId)).filter((i) => outstandingCents(i) > 0n).map((i) => [i.orderId, i]));
  const issues = checkAllocations(lines, openMap, available);
  if (issues.length) throw new PaymentError(422, issues[0], issues.map((i) => ALLOCATION_ISSUE_TEXT[i]).join(" | "));
  const cents = lines.reduce((a, l) => a + l.cents, 0n);
  for (const l of lines) await tx.insert(paymentAllocationsTable).values({ paymentId, salesOrderId: l.orderId, amount: centsDecimal(l.cents), createdByName: actor.username });
  const flipped = await settleStatuses(tx, lines.map((l) => l.orderId), actor, payment.paymentNumber);
  await audit(tx, actor, "payments.allocated", "customer_payment", paymentId, { allocations: lines.map((l) => ({ orderId: l.orderId, amount: centsDecimal(l.cents) })), autoPaid: flipped });
  if (payment.journalEntryId) {
    const ids = await accountIds(tx, [PAYMENT_ACCOUNT_CODES.receivable, PAYMENT_ACCOUNT_CODES.advances]);
    const n = (await tx.execute(sql`select count(*)::int as n from gl_journal_entries where source_type = ${SOURCE_PAYMENT_ALLOCATION} and source_id like ${`${paymentId}:%`}`)) as { rows: Array<{ n: number }> };
    await postJournalEntry(tx, {
      entryDate: todayCairo(new Date()),
      description: `تخصيص دفعة مقدمة ${payment.paymentNumber} على فواتير`,
      lines: advanceApplyLines({ receivableId: ids.get(PAYMENT_ACCOUNT_CODES.receivable)!, advancesId: ids.get(PAYMENT_ACCOUNT_CODES.advances)!, cents, memo: payment.paymentNumber }),
      sourceType: SOURCE_PAYMENT_ALLOCATION,
      sourceId: `${paymentId}:${Number(n.rows[0]?.n ?? 0) + 1}`,
      createdBy: actor.userId,
      createdByName: actor.username,
    });
  }
  return { allocatedCents: cents, remainingCents: available - cents, autoPaid: flipped };
}

/** إلغاء تحصيل: القيود بتتعكس، والتخصيصات بتفضل في السجل بس مبتتحسبش. أمر اتحوّل «مدفوع» بالتحصيل ده بيرجع «مشحون». */
export async function voidPayment(tx: Exec, paymentId: number, reason: string, actor: PayActor) {
  await tx.execute(sql`select pg_advisory_xact_lock(${PAYMENT_LOCK})`);
  const why = reason.trim();
  if (why.length < 3) throw new PaymentError(422, "REASON_REQUIRED", "اكتب سبب الإلغاء");
  const [payment] = await tx.select().from(customerPaymentsTable).where(eq(customerPaymentsTable.id, paymentId)).for("update").limit(1);
  if (!payment) throw new PaymentError(404, "PAYMENT_NOT_FOUND", "التحصيل مش موجود");
  if (payment.status !== "posted") throw new PaymentError(409, "PAYMENT_VOIDED", "التحصيل ده ملغي قبل كده");
  await lockCustomerOrders(tx, payment.contactId);
  await tx.update(customerPaymentsTable).set({ status: "voided", voidReason: why, voidedAt: new Date(), voidedByName: actor.username }).where(eq(customerPaymentsTable.id, paymentId));

  const allocs = (await tx.select({ orderId: paymentAllocationsTable.salesOrderId }).from(paymentAllocationsTable).where(eq(paymentAllocationsTable.paymentId, paymentId))) as Array<{ orderId: number }>;
  const orderIds = [...new Set(allocs.map((a) => a.orderId))].sort((a, b) => a - b);
  const paid = await paidByOrder(tx, orderIds);
  const reverted: number[] = [];
  for (const id of orderIds) {
    const [o] = await tx.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, id)).limit(1);
    if (o && o.status === "paid" && (paid.get(id) ?? 0n) < signed(String(o.total))) {
      await tx.update(salesOrdersTable).set({ status: "shipped", updatedAt: new Date() }).where(eq(salesOrdersTable.id, id));
      await audit(tx, actor, "payments.order_unpaid", "sales_order", id, { status: "shipped", payment: payment.paymentNumber }, `إلغاء التحصيل ${payment.paymentNumber}`, { status: "paid" });
      reverted.push(id);
    }
  }
  await audit(tx, actor, "payments.voided", "customer_payment", paymentId, { paymentNumber: payment.paymentNumber, revertedToShipped: reverted }, why);

  const entries = (await tx.execute(sql`
    select id from gl_journal_entries
    where status = 'posted' and ((source_type = ${SOURCE_CUSTOMER_PAYMENT} and source_id = ${String(paymentId)}) or (source_type = ${SOURCE_PAYMENT_ALLOCATION} and source_id like ${`${paymentId}:%`}))
    order by id`)) as { rows: Array<{ id: number }> };
  for (const e of entries.rows) {
    const [orig] = await tx.select().from(glJournalEntriesTable).where(eq(glJournalEntriesTable.id, e.id)).limit(1);
    const lines = (await tx.select().from(glJournalLinesTable).where(eq(glJournalLinesTable.entryId, e.id)).orderBy(glJournalLinesTable.lineNo)) as Array<{ accountId: number; debit: string; credit: string; memo: string | null }>;
    await postJournalEntry(tx, {
      entryDate: todayCairo(new Date()),
      description: `عكس القيد ${orig.entryNumber}: إلغاء التحصيل ${payment.paymentNumber}`,
      lines: reverseLines(lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo }))),
      sourceType: "reversal",
      sourceId: String(orig.id),
      reversalOf: orig.id,
      createdBy: actor.userId,
      createdByName: actor.username,
    });
    await tx.update(glJournalEntriesTable).set({ status: "reversed" }).where(eq(glJournalEntriesTable.id, orig.id));
  }
  return { reverted, reversedEntries: entries.rows.length };
}
