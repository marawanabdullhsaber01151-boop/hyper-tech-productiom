/** @format */
// تأكيد الأرصدة (53ب). كل الدوال جوه معاملة المتصل. ترتيب الأقفال:
//   طلب: قفل العميل (hashtext) ← فحص الطلب المفتوح ← لقطة الكشف ← الإدراج ← التدقيق.
//   رد العميل / قرار المالية: صف الطلب FOR UPDATE ← التحديث ← (اعتراض) المهمة ← التدقيق.
// الشركة بتتحدد في كل استعلام للعميل (portal_customer_id) فمفيش وصول لطلب شركة تانية.
import { sql } from "drizzle-orm";
import { writePortalAudit } from "./portalAudit";
import { writeAuditEvent } from "./governance";
import { createTask } from "./humanTasks";
import { nextPhase0Number } from "./phase0";
import { todayCairo } from "./operationsCapacityCore";
import { customerMovements } from "./receivables";
import { signedDecimal } from "./receivablesCore";
import { reviewDueAt } from "./transferReportsCore";
import { closeTask } from "./transferReports";
import type { TaskActor } from "./humanTaskCore";
import {
  TASK_KIND, TASK_SOURCE, buildSnapshot, canTransition, checkAsOf, customerNotice, isActive, replyDueDate, taskDedupeKey,
  type ConfirmationRow, type ConfirmStatus, type SnapshotLine,
} from "./balanceConfirmationsCore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = any;

export class BalanceError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface Requester { userId: number; username: string; ip?: string | null; userAgent?: string | null }
export interface Responder { companyId: number; memberId: number | null; name: string; ip?: string | null; userAgent?: string | null }

const COLS = sql`b.id, b.confirmation_number, b.contact_id, b.portal_customer_id, b.as_of::text as as_of, b.balance::text as balance, b.period_from::text as period_from,
  b.opening::text as opening, b.lines, b.note, b.due_date::text as due_date, b.requested_by_name, b.status, b.responded_by_name, b.responded_at,
  b.customer_amount::text as customer_amount, b.customer_note, b.task_id, b.resolution_note, b.resolved_by_name, b.resolved_at, b.cancel_reason, b.created_at`;

export function mapConfirmation(r: Record<string, unknown>): ConfirmationRow {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  const lines = typeof r.lines === "string" ? (JSON.parse(r.lines) as SnapshotLine[]) : ((r.lines as SnapshotLine[]) ?? []);
  return {
    id: Number(r.id), confirmationNumber: String(r.confirmation_number), contactId: Number(r.contact_id), portalCustomerId: Number(r.portal_customer_id),
    asOf: String(r.as_of).slice(0, 10), balance: String(r.balance), periodFrom: String(r.period_from).slice(0, 10), opening: String(r.opening), lines,
    note: (r.note as string) ?? null, dueDate: String(r.due_date).slice(0, 10), requestedByName: String(r.requested_by_name), status: r.status as ConfirmStatus,
    respondedByName: (r.responded_by_name as string) ?? null, respondedAt: iso(r.responded_at), customerAmount: (r.customer_amount as string) ?? null,
    customerNote: (r.customer_note as string) ?? null, taskId: r.task_id == null ? null : Number(r.task_id), resolutionNote: (r.resolution_note as string) ?? null,
    resolvedByName: (r.resolved_by_name as string) ?? null, resolvedAt: iso(r.resolved_at), cancelReason: (r.cancel_reason as string) ?? null, createdAt: iso(r.created_at) as string,
  };
}

async function load(tx: Exec, id: number, companyId: number | null): Promise<ConfirmationRow | null> {
  const res = (await tx.execute(
    companyId == null
      ? sql`select ${COLS} from balance_confirmations b where b.id = ${id} for update of b`
      : sql`select ${COLS} from balance_confirmations b where b.id = ${id} and b.portal_customer_id = ${companyId} for update of b`,
  )) as { rows: Array<Record<string, unknown>> };
  return res.rows[0] ? mapConfirmation(res.rows[0]) : null;
}

export interface RequestResult { row: ConfirmationRow; notice: { title: string; body: string } }

/** المالية بتطلب تأكيد رصيد عميل: بتحفظ لقطة الكشف لحد `asOf` وبتبلّغ العميل. */
export async function requestConfirmation(tx: Exec, input: { contactId: number; asOf?: string; note?: string | null }, by: Requester, now: Date = new Date()): Promise<RequestResult> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`balance_confirm:${input.contactId}`}))`);
  const today = todayCairo(now);
  const asOf = input.asOf ?? today;
  const check = checkAsOf(asOf, today);
  if (!check.ok) throw new BalanceError(422, check.code, check.error);

  const c = (await tx.execute(sql`select ct.id, ct.name, pc.id as portal_id from contacts ct left join portal_customers pc on pc.contact_id = ct.id where ct.id = ${input.contactId}`)) as { rows: Array<{ id: number; name: string; portal_id: number | null }> };
  if (!c.rows[0]) throw new BalanceError(404, "CONTACT_NOT_FOUND", "العميل مش موجود");
  if (c.rows[0].portal_id == null) throw new BalanceError(422, "NO_PORTAL", "العميل ده ملوش حساب في البوابة، فمش هيقدر يرد على الطلب.");

  const active = (await tx.execute(sql`select confirmation_number from balance_confirmations where contact_id = ${input.contactId} and status in ('open','disputed') limit 1`)) as { rows: Array<{ confirmation_number: string }> };
  if (active.rows[0]) throw new BalanceError(409, "ALREADY_ACTIVE", `في طلب لسه شغال للعميل ده (${active.rows[0].confirmation_number}). اقفله أو الغيه الأول.`);

  const snap = buildSnapshot(await customerMovements(tx, input.contactId), asOf);
  const number = await nextPhase0Number(tx, "balance_confirmation");
  const ins = (await tx.execute(sql`
    insert into balance_confirmations (confirmation_number, contact_id, portal_customer_id, as_of, balance, period_from, opening, lines, note, due_date, requested_by, requested_by_name)
    values (${number}, ${input.contactId}, ${c.rows[0].portal_id}, ${asOf}::date, ${signedDecimal(snap.balanceCents)}::numeric, ${snap.periodFrom}::date, ${signedDecimal(snap.openingCents)}::numeric,
            ${JSON.stringify(snap.lines)}::jsonb, ${input.note?.trim() || null}, ${replyDueDate(today)}::date, ${by.userId}, ${by.username})
    returning id`)) as { rows: Array<{ id: number }> };
  const id = Number(ins.rows[0].id);
  await writeAuditEvent({
    executor: tx, actorUserId: by.userId, actorName: by.username, actionKey: "balance_confirmations.requested", resourceType: "balance_confirmation", resourceId: id,
    beforeData: null, afterData: { number, contactId: input.contactId, asOf, balance: signedDecimal(snap.balanceCents) }, ipAddress: by.ip ?? null, userAgent: by.userAgent ?? null,
  });
  const row = (await load(tx, id, null)) as ConfirmationRow;
  return { row, notice: customerNotice("requested", row) };
}

export async function listCompanyConfirmations(exec: Exec, companyId: number, limit = 50): Promise<ConfirmationRow[]> {
  const res = (await exec.execute(sql`select ${COLS} from balance_confirmations b where b.portal_customer_id = ${companyId} order by b.id desc limit ${limit}`)) as { rows: Array<Record<string, unknown>> };
  return res.rows.map(mapConfirmation);
}

export interface StaffConfirmationRow extends ConfirmationRow { contactName: string; companyName: string }
/** للمالية: اللي محتاج متابعة الأول (اعتراض، ثم مفتوح بأقرب مهلة)، وبعدين الباقي. */
export async function listStaffConfirmations(exec: Exec, opts: { status?: string; limit?: number }): Promise<StaffConfirmationRow[]> {
  const res = (await exec.execute(sql`select ${COLS}, ct.name as contact_name, pc.company_name
    from balance_confirmations b join contacts ct on ct.id = b.contact_id join portal_customers pc on pc.id = b.portal_customer_id
    where (${opts.status ?? null}::text is null or b.status = ${opts.status ?? null})
    order by (b.status = 'disputed') desc, (b.status = 'open') desc, b.due_date asc, b.id desc limit ${opts.limit ?? 100}`)) as { rows: Array<Record<string, unknown>> };
  return res.rows.map((r) => ({ ...mapConfirmation(r), contactName: String(r.contact_name), companyName: String(r.company_name) }));
}

export async function needsAttentionCount(exec: Exec, today: string): Promise<{ disputed: number; overdue: number }> {
  const res = (await exec.execute(sql`select count(*) filter (where status = 'disputed')::int as disputed, count(*) filter (where status = 'open' and due_date < ${today}::date)::int as overdue from balance_confirmations`)) as { rows: Array<{ disputed: number; overdue: number }> };
  return { disputed: res.rows[0]?.disputed ?? 0, overdue: res.rows[0]?.overdue ?? 0 };
}

/** العميل بيوافق على الرصيد. */
export async function agree(tx: Exec, id: number, who: Responder): Promise<ConfirmationRow> {
  const r = await load(tx, id, who.companyId);
  if (!r) throw new BalanceError(404, "NOT_FOUND", "الطلب مش موجود");
  if (!canTransition(r.status, "agreed")) throw new BalanceError(409, "NOT_OPEN", "الطلب ده اتقرر فيه قبل كده");
  await tx.execute(sql`update balance_confirmations set status = 'agreed', responded_by_member_id = ${who.memberId}, responded_by_name = ${who.name}, responded_at = now() where id = ${id}`);
  await writePortalAudit(tx, { companyId: who.companyId, actorMemberId: who.memberId, actorLabel: who.name, action: "balance.agreed", targetType: "balance_confirmation", targetId: id, after: { number: r.confirmationNumber, balance: r.balance, asOf: r.asOf }, ip: who.ip ?? null, userAgent: who.userAgent ?? null });
  return (await load(tx, id, who.companyId)) as ConfirmationRow;
}

/** العميل بيعترض بسبب (وممكن يكتب رقمه): بيتفتح مهمة للمالية بموعد. */
export async function dispute(tx: Exec, id: number, who: Responder, body: { note: string; amount?: string | null }, now: Date = new Date()): Promise<ConfirmationRow> {
  const r = await load(tx, id, who.companyId);
  if (!r) throw new BalanceError(404, "NOT_FOUND", "الطلب مش موجود");
  if (!canTransition(r.status, "disputed")) throw new BalanceError(409, "NOT_OPEN", "الطلب ده اتقرر فيه قبل كده");
  const co = (await tx.execute(sql`select company_name from portal_customers where id = ${who.companyId}`)) as { rows: Array<{ company_name: string }> };
  const { task } = await createTask({
    kind: TASK_KIND,
    title: `اعتراض على رصيد ${co.rows[0]?.company_name ?? ""} (${r.confirmationNumber})`,
    description: `العميل اعترض على رصيده ${r.balance} جنيه في ${r.asOf}${body.amount ? `، ورقمه عنده ${body.amount}` : ""}. السبب: ${body.note.trim()}. راجع وقفل الاعتراض من «المحاسبة ← تأكيد الأرصدة».`,
    priority: "high",
    assigneeRole: "executive_manager",
    escalateToRole: "chairman",
    dueAt: reviewDueAt(now),
    sourceType: TASK_SOURCE,
    sourceId: id,
    dedupeKey: taskDedupeKey(id),
  }, null, undefined, tx);
  await tx.execute(sql`update balance_confirmations set status = 'disputed', responded_by_member_id = ${who.memberId}, responded_by_name = ${who.name}, responded_at = now(),
    customer_note = ${body.note.trim()}, customer_amount = ${body.amount ?? null}::numeric, task_id = ${task.id} where id = ${id}`);
  await writePortalAudit(tx, { companyId: who.companyId, actorMemberId: who.memberId, actorLabel: who.name, action: "balance.disputed", targetType: "balance_confirmation", targetId: id, after: { number: r.confirmationNumber, balance: r.balance, customerAmount: body.amount ?? null }, ip: who.ip ?? null, userAgent: who.userAgent ?? null });
  return (await load(tx, id, who.companyId)) as ConfirmationRow;
}

export interface DecisionResult { row: ConfirmationRow; notice: { title: string; body: string } }

/** المالية بتقفل الاعتراض بملاحظة بتوصل للعميل. */
export async function resolve(tx: Exec, id: number, note: string, by: Requester, taskActor: TaskActor): Promise<DecisionResult> {
  const r = await load(tx, id, null);
  if (!r) throw new BalanceError(404, "NOT_FOUND", "الطلب مش موجود");
  if (!canTransition(r.status, "resolved")) throw new BalanceError(409, "NOT_DISPUTED", "الطلب مش معترض عليه");
  await tx.execute(sql`update balance_confirmations set status = 'resolved', resolution_note = ${note.trim()}, resolved_by = ${by.userId}, resolved_by_name = ${by.username}, resolved_at = now() where id = ${id}`);
  await writeAuditEvent({ executor: tx, actorUserId: by.userId, actorName: by.username, actionKey: "balance_confirmations.resolved", resourceType: "balance_confirmation", resourceId: id, beforeData: { status: "disputed" }, afterData: { status: "resolved" }, reason: note.trim(), ipAddress: by.ip ?? null, userAgent: by.userAgent ?? null });
  await closeTask(tx, r.taskId, `اتقفل: ${note.trim()}`.slice(0, 1000), taskActor);
  const row = (await load(tx, id, null)) as ConfirmationRow;
  return { row, notice: customerNotice("resolved", row) };
}

/** المالية بتلغي طلب شغّال (مفتوح أو معترض عليه) بسبب. */
export async function cancel(tx: Exec, id: number, reason: string, by: Requester, taskActor: TaskActor): Promise<DecisionResult> {
  const r = await load(tx, id, null);
  if (!r) throw new BalanceError(404, "NOT_FOUND", "الطلب مش موجود");
  if (!isActive(r.status)) throw new BalanceError(409, "NOT_ACTIVE", "الطلب ده اتقفل قبل كده");
  await tx.execute(sql`update balance_confirmations set status = 'cancelled', cancel_reason = ${reason.trim()} where id = ${id}`);
  await writeAuditEvent({ executor: tx, actorUserId: by.userId, actorName: by.username, actionKey: "balance_confirmations.cancelled", resourceType: "balance_confirmation", resourceId: id, beforeData: { status: r.status }, afterData: { status: "cancelled" }, reason: reason.trim(), ipAddress: by.ip ?? null, userAgent: by.userAgent ?? null });
  await closeTask(tx, r.taskId, `اتلغى: ${reason.trim()}`.slice(0, 1000), taskActor);
  const row = (await load(tx, id, null)) as ConfirmationRow;
  return { row, notice: customerNotice("cancelled", row) };
}
