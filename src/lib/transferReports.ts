/** @format */
// إبلاغ العميل عن تحويل (53أ). كل الدوال جوه معاملة المتصل، وترتيب الأقفال ثابت (عشان مفيش deadlock):
//   إبلاغ: قفل الشركة (hashtext) ← فحوص التكرار ← الإدراج ← المهمة ← سجل نشاط الشركة.
//   قرار:  صف التقرير FOR UPDATE ← (تأكيد) createPayment: قفل 4802 ← أوامر العميل ← التدقيق ← الدفتر ← المهمة.
// مفيش أي مسار بياخد 4802 وبعدين صف تقرير، فالترتيب ده آمن.
import { sql } from "drizzle-orm";
import { writePortalAudit } from "./portalAudit";
import { writeAuditEvent } from "./governance";
import { createPayment, PaymentError, type PayActor } from "./payments";
import { completeTask, createTask } from "./humanTasks";
import { nextPhase0Number } from "./phase0";
import { todayCairo } from "./operationsCapacityCore";
import { centsDecimal } from "./ledgerAutoCore";
import { toCents } from "./money";
import {
  MAX_PENDING_PER_COMPANY, TASK_KIND, TASK_SOURCE, canDecide, checkReport, customerNotice, decideConfirm, defaultPaymentMethod,
  referenceKey, reviewDueAt, taskDedupeKey, type ReportBody, type TransferReportRow,
} from "./transferReportsCore";
import type { TaskActor } from "./humanTaskCore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = any;

export class TransferReportError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface Reporter { companyId: number; memberId: number | null; name: string; ip?: string | null; userAgent?: string | null }

const COLS = sql`r.id, r.report_number, r.contact_id, r.portal_customer_id, r.reported_by_name, r.amount::text as amount, r.transfer_date::text as transfer_date,
  r.method, r.reference, r.note, r.status, r.task_id, r.payment_id, p.payment_number, r.confirmed_amount::text as confirmed_amount, r.review_note, r.reject_reason,
  r.reviewed_by_name, r.reviewed_at, r.created_at`;

export function mapReport(r: Record<string, unknown>): TransferReportRow {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    id: Number(r.id), reportNumber: String(r.report_number), contactId: Number(r.contact_id), portalCustomerId: Number(r.portal_customer_id),
    reportedByName: String(r.reported_by_name), amount: String(r.amount), transferDate: String(r.transfer_date).slice(0, 10),
    method: r.method as TransferReportRow["method"], reference: String(r.reference), note: (r.note as string) ?? null,
    status: r.status as TransferReportRow["status"], taskId: r.task_id == null ? null : Number(r.task_id), paymentId: r.payment_id == null ? null : Number(r.payment_id),
    paymentNumber: (r.payment_number as string) ?? null, confirmedAmount: (r.confirmed_amount as string) ?? null, reviewNote: (r.review_note as string) ?? null,
    rejectReason: (r.reject_reason as string) ?? null, reviewedByName: (r.reviewed_by_name as string) ?? null, reviewedAt: iso(r.reviewed_at),
    createdAt: iso(r.created_at) as string,
  };
}

async function loadReport(tx: Exec, id: number, lock: boolean): Promise<TransferReportRow | null> {
  const res = (await tx.execute(
    lock
      ? sql`select ${COLS} from customer_transfer_reports r left join customer_payments p on p.id = r.payment_id where r.id = ${id} for update of r`
      : sql`select ${COLS} from customer_transfer_reports r left join customer_payments p on p.id = r.payment_id where r.id = ${id}`,
  )) as { rows: Array<Record<string, unknown>> };
  return res.rows[0] ? mapReport(res.rows[0]) : null;
}

/** العميل بيبلّغ. بيرجّع التقرير + مهمة المالية (في نفس المعاملة، فمفيش تقرير من غير مهمة). */
export async function reportTransfer(tx: Exec, who: Reporter, body: ReportBody, now: Date = new Date()): Promise<TransferReportRow> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`transfer_report:${who.companyId}`}))`);
  const company = (await tx.execute(sql`select contact_id, company_name from portal_customers where id = ${who.companyId}`)) as { rows: Array<{ contact_id: number; company_name: string }> };
  const c = company.rows[0];
  if (!c) throw new TransferReportError(404, "COMPANY_NOT_FOUND", "الشركة مش موجودة");

  const check = checkReport(body, todayCairo(now));
  if (!check.ok) throw new TransferReportError(422, check.code, check.error);

  const pending = (await tx.execute(sql`select count(*)::int as n from customer_transfer_reports where portal_customer_id = ${who.companyId} and status = 'pending'`)) as { rows: Array<{ n: number }> };
  if ((pending.rows[0]?.n ?? 0) >= MAX_PENDING_PER_COMPANY) {
    throw new TransferReportError(409, "TOO_MANY_PENDING", "عندك تحويلات كتير لسه المالية بتراجعها. استنى لحد ما يخلصوا وبعدين بلّغ بالباقي.");
  }
  const ref = referenceKey(body.reference);
  const dup = (await tx.execute(sql`
    select report_number, (lower(btrim(reference)) = ${ref}) as same_ref from customer_transfer_reports
    where contact_id = ${c.contact_id} and status in ('pending','confirmed')
      and (lower(btrim(reference)) = ${ref} or (status = 'pending' and amount = ${centsDecimal(check.cents)}::numeric and transfer_date = ${body.transferDate}::date and method = ${body.method}))
    limit 1`)) as { rows: Array<{ report_number: string; same_ref: boolean }> };
  if (dup.rows[0]) {
    throw new TransferReportError(409, dup.rows[0].same_ref ? "DUPLICATE_REFERENCE" : "DUPLICATE_PENDING",
      dup.rows[0].same_ref ? `رقم العملية ده اتبلّغ عنه قبل كده (${dup.rows[0].report_number}).` : `في تحويل بنفس المبلغ والتاريخ لسه بيتراجع (${dup.rows[0].report_number}).`);
  }

  const number = await nextPhase0Number(tx, "transfer_report");
  const ins = (await tx.execute(sql`
    insert into customer_transfer_reports (report_number, contact_id, portal_customer_id, reported_by_member_id, reported_by_name, amount, transfer_date, method, reference, note)
    values (${number}, ${c.contact_id}, ${who.companyId}, ${who.memberId}, ${who.name}, ${centsDecimal(check.cents)}::numeric, ${body.transferDate}::date, ${body.method}, ${body.reference.trim()}, ${body.note?.trim() || null})
    returning id`)) as { rows: Array<{ id: number }> };
  const id = Number(ins.rows[0].id);

  const { task } = await createTask({
    kind: TASK_KIND,
    title: `تأكيد تحويل ${number} من ${c.company_name}`,
    description: `${c.company_name} بلّغت عن تحويل ${centsDecimal(check.cents)} جنيه بتاريخ ${body.transferDate} (${body.method}) ومرجعه «${body.reference.trim()}». راجع الحساب وأكّد أو ارفض من «المحاسبة ← تحويلات العملاء».`,
    priority: "high",
    assigneeRole: "executive_manager",
    escalateToRole: "chairman",
    dueAt: reviewDueAt(now),
    sourceType: TASK_SOURCE,
    sourceId: id,
    dedupeKey: taskDedupeKey(id),
  }, null, undefined, tx);
  await tx.execute(sql`update customer_transfer_reports set task_id = ${task.id} where id = ${id}`);

  await writePortalAudit(tx, {
    companyId: who.companyId, actorMemberId: who.memberId, actorLabel: who.name, action: "transfer.reported", targetType: "transfer_report", targetId: id,
    after: { reportNumber: number, amount: centsDecimal(check.cents), transferDate: body.transferDate, method: body.method }, ip: who.ip ?? null, userAgent: who.userAgent ?? null,
  });
  const row = await loadReport(tx, id, false);
  return row as TransferReportRow;
}

export async function listCompanyReports(exec: Exec, companyId: number, limit = 50): Promise<TransferReportRow[]> {
  const res = (await exec.execute(sql`select ${COLS} from customer_transfer_reports r left join customer_payments p on p.id = r.payment_id
    where r.portal_customer_id = ${companyId} order by r.id desc limit ${limit}`)) as { rows: Array<Record<string, unknown>> };
  return res.rows.map(mapReport);
}

export interface StaffReportRow extends TransferReportRow { companyName: string; contactName: string }
export async function listStaffReports(exec: Exec, opts: { status?: string; limit?: number }): Promise<StaffReportRow[]> {
  const res = (await exec.execute(sql`select ${COLS}, pc.company_name, ct.name as contact_name
    from customer_transfer_reports r left join customer_payments p on p.id = r.payment_id
    join portal_customers pc on pc.id = r.portal_customer_id join contacts ct on ct.id = r.contact_id
    where (${opts.status ?? null}::text is null or r.status = ${opts.status ?? null})
    order by (r.status = 'pending') desc, r.id desc limit ${opts.limit ?? 100}`)) as { rows: Array<Record<string, unknown>> };
  return res.rows.map((r) => ({ ...mapReport(r), companyName: String(r.company_name), contactName: String(r.contact_name) }));
}

export async function pendingCount(exec: Exec): Promise<number> {
  const res = (await exec.execute(sql`select count(*)::int as n from customer_transfer_reports where status = 'pending'`)) as { rows: Array<{ n: number }> };
  return res.rows[0]?.n ?? 0;
}

/** المهمة بتتقفل في نفس معاملة القرار (completeTask بياخد executor عبر shim). */
async function closeTask(tx: Exec, taskId: number | null, note: string, actor: TaskActor): Promise<void> {
  if (!taskId) return;
  const shim = { execute: (q: unknown) => tx.execute(q), transaction: <T>(cb: (t: Exec) => Promise<T>) => cb(tx) };
  try {
    await completeTask(taskId, note, actor, shim);
  } catch (e) {
    // المهمة اتقفلت قبل كده (مثلًا يدويًا): مش سبب نوقف القرار. أي خطأ تاني يطلع.
    if (String((e as { code?: string }).code) !== "BAD_STATE") throw e;
  }
}

export interface DecisionResult { report: TransferReportRow; notice: { title: string; body: string } }

export async function confirmReport(
  tx: Exec, id: number,
  input: { amount?: string; method?: "cash" | "bank"; paymentDate?: string; note?: string | null },
  actor: PayActor, taskActor: TaskActor,
): Promise<DecisionResult> {
  const r = await loadReport(tx, id, true);
  if (!r) throw new TransferReportError(404, "NOT_FOUND", "التقرير مش موجود");
  if (!canDecide(r.status)) throw new TransferReportError(409, "ALREADY_DECIDED", "التقرير ده اتقرر فيه قبل كده");
  const decision = decideConfirm(toCents(r.amount), input);
  if (!decision.ok) throw new TransferReportError(422, decision.code, decision.error);

  let pay;
  try {
    pay = await createPayment(tx, {
      contactId: r.contactId,
      paymentDate: input.paymentDate ?? r.transferDate,
      method: input.method ?? defaultPaymentMethod(r.method),
      amountCents: decision.cents,
      reference: `${r.reportNumber} / ${r.reference}`.slice(0, 120),
      notes: `من إبلاغ العميل ${r.reportNumber}${input.note?.trim() ? ` — ${input.note.trim()}` : ""}`.slice(0, 500),
    }, actor);
  } catch (e) {
    if (e instanceof PaymentError) throw new TransferReportError(e.status, e.code, e.message);
    throw e;
  }
  await tx.execute(sql`update customer_transfer_reports set status = 'confirmed', payment_id = ${pay.id}, confirmed_amount = ${centsDecimal(decision.cents)}::numeric,
    review_note = ${input.note?.trim() || null}, reviewed_by = ${actor.userId}, reviewed_by_name = ${actor.username}, reviewed_at = now() where id = ${id}`);
  await writeAuditEvent({
    executor: tx, actorUserId: actor.userId, actorName: actor.username, actionKey: "transfer_reports.confirmed", resourceType: "customer_transfer_report", resourceId: id,
    beforeData: { status: "pending", amount: r.amount }, afterData: { status: "confirmed", paymentId: pay.id, paymentNumber: pay.paymentNumber, amount: centsDecimal(decision.cents) },
    reason: decision.differs ? (input.note ?? null) : null, ipAddress: actor.ip ?? null, userAgent: actor.userAgent ?? null,
  });
  await closeTask(tx, r.taskId, `اتأكد وتسجّل تحصيل ${pay.paymentNumber}`, taskActor);
  const report = (await loadReport(tx, id, false)) as TransferReportRow;
  return { report, notice: customerNotice(report) };
}

export async function rejectReport(tx: Exec, id: number, reason: string, actor: PayActor, taskActor: TaskActor): Promise<DecisionResult> {
  const r = await loadReport(tx, id, true);
  if (!r) throw new TransferReportError(404, "NOT_FOUND", "التقرير مش موجود");
  if (!canDecide(r.status)) throw new TransferReportError(409, "ALREADY_DECIDED", "التقرير ده اتقرر فيه قبل كده");
  await tx.execute(sql`update customer_transfer_reports set status = 'rejected', reject_reason = ${reason.trim()}, reviewed_by = ${actor.userId}, reviewed_by_name = ${actor.username}, reviewed_at = now() where id = ${id}`);
  await writeAuditEvent({
    executor: tx, actorUserId: actor.userId, actorName: actor.username, actionKey: "transfer_reports.rejected", resourceType: "customer_transfer_report", resourceId: id,
    beforeData: { status: "pending" }, afterData: { status: "rejected" }, reason: reason.trim(), ipAddress: actor.ip ?? null, userAgent: actor.userAgent ?? null,
  });
  await closeTask(tx, r.taskId, `اترفض: ${reason.trim()}`.slice(0, 1000), taskActor);
  const report = (await loadReport(tx, id, false)) as TransferReportRow;
  return { report, notice: customerNotice(report) };
}
