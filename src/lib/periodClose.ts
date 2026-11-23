/** @format */
// إقفال الفترة المحاسبية وإعادة فتحها (55). كل الدوال جوه معاملة المتصل. ترتيب الأقفال:
//   قفل الدفتر (lockLedger) ← صف الفترة FOR UPDATE ← فحص القواعد ← التحديث (الترجر بيراجع تاني) ← السجل ← التدقيق ← المهمة.
// الترحيل بيقرا الفترة FOR SHARE (هجرة 0107) فالإقفال بيستنى أي ترحيل شغّال، وأي ترحيل بعده بيشوفها مقفولة.
import { sql } from "drizzle-orm";
import { writeAuditEvent } from "./governance";
import { createTask } from "./humanTasks";
import { lockLedger } from "./ledger";
import { closeTask } from "./transferReports";
import { todayCairo } from "./operationsCapacityCore";
import type { TaskActor } from "./humanTaskCore";
import {
  TASK_KIND, TASK_SOURCE, canClose, canReopen, closeDueDate, periodDueNow, taskDedupeKey, taskDueAt, type PeriodLite,
} from "./periodCloseCore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = any;

export class PeriodError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface Actor { userId: number; username: string; ip?: string | null; userAgent?: string | null }

const COLS = sql`id, year, month, starts_on::text as starts_on, ends_on::text as ends_on, status, closed_at, closed_by_name, close_note, reopened_at, reopened_by_name, reopen_reason, reopen_count`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lite = (r: any): PeriodLite => ({ id: Number(r.id), year: Number(r.year), month: Number(r.month), startsOn: String(r.starts_on), endsOn: String(r.ends_on), status: String(r.status) });

async function allPeriods(tx: Exec): Promise<PeriodLite[]> {
  const res = (await tx.execute(sql`select ${COLS} from gl_periods`)) as { rows: unknown[] };
  return res.rows.map(lite);
}

async function loadLocked(tx: Exec, id: number) {
  const res = (await tx.execute(sql`select ${COLS} from gl_periods where id = ${id} for update`)) as { rows: Array<Record<string, unknown>> };
  return res.rows[0] ?? null;
}

/** تحذيرات قبل الإقفال (مش بتمنع): حاجات لسه معلّقة ممكن تأثر على أرقام الفترة. */
export async function closeChecklist(exec: Exec): Promise<{ pendingTransfers: number; openDisputes: number }> {
  const t = (await exec.execute(sql`select count(*)::int as n from customer_transfer_reports where status = 'pending'`)) as { rows: Array<{ n: number }> };
  const d = (await exec.execute(sql`select count(*)::int as n from balance_confirmations where status = 'disputed'`)) as { rows: Array<{ n: number }> };
  return { pendingTransfers: Number(t.rows[0]?.n ?? 0), openDisputes: Number(d.rows[0]?.n ?? 0) };
}

export async function closePeriod(tx: Exec, id: number, note: string | null, by: Actor, taskActor: TaskActor, now: Date = new Date()): Promise<void> {
  await lockLedger(tx);
  const row = await loadLocked(tx, id);
  if (!row) throw new PeriodError(404, "NOT_FOUND", "الفترة مش موجودة");
  const chk = canClose(lite(row), await allPeriods(tx), todayCairo(now));
  if (!chk.ok) throw new PeriodError(409, chk.code, chk.error);
  await tx.execute(sql`update gl_periods set status = 'closed', closed_at = now(), closed_by = ${by.userId}, closed_by_name = ${by.username}, close_note = ${note?.trim() || null} where id = ${id}`);
  await tx.execute(sql`insert into gl_period_events (period_id, action, reason, actor_user_id, actor_name) values (${id}, 'closed', ${note?.trim() || null}, ${by.userId}, ${by.username})`);
  await writeAuditEvent({ executor: tx, actorUserId: by.userId, actorName: by.username, actionKey: "ledger.period_closed", resourceType: "gl_period", resourceId: id, beforeData: { status: "open" }, afterData: { status: "closed", year: row.year, month: row.month }, reason: note?.trim() || null, ipAddress: by.ip ?? null, userAgent: by.userAgent ?? null });
  const t = (await tx.execute(sql`select id from human_tasks where dedupe_key = ${taskDedupeKey(Number(row.year), Number(row.month), Number(row.reopen_count))}`)) as { rows: Array<{ id: number }> };
  if (t.rows[0]) await closeTask(tx, Number(t.rows[0].id), "اتقفلت الفترة", taskActor);
}

export async function reopenPeriod(tx: Exec, id: number, reason: string, by: Actor): Promise<void> {
  await lockLedger(tx);
  const row = await loadLocked(tx, id);
  if (!row) throw new PeriodError(404, "NOT_FOUND", "الفترة مش موجودة");
  const chk = canReopen(lite(row), await allPeriods(tx));
  if (!chk.ok) throw new PeriodError(409, chk.code, chk.error);
  await tx.execute(sql`update gl_periods set status = 'open', reopened_at = now(), reopened_by_name = ${by.username}, reopen_reason = ${reason.trim()}, reopen_count = reopen_count + 1 where id = ${id}`);
  await tx.execute(sql`insert into gl_period_events (period_id, action, reason, actor_user_id, actor_name) values (${id}, 'reopened', ${reason.trim()}, ${by.userId}, ${by.username})`);
  await writeAuditEvent({ executor: tx, actorUserId: by.userId, actorName: by.username, actionKey: "ledger.period_reopened", resourceType: "gl_period", resourceId: id, beforeData: { status: "closed" }, afterData: { status: "open", year: row.year, month: row.month }, reason: reason.trim(), ipAddress: by.ip ?? null, userAgent: by.userAgent ?? null });
}

export async function listEvents(exec: Exec, limit = 50) {
  const res = (await exec.execute(sql`select e.id, e.period_id, p.year, p.month, e.action, e.reason, e.actor_name, e.created_at from gl_period_events e join gl_periods p on p.id = e.period_id order by e.id desc limit ${limit}`)) as { rows: Array<Record<string, unknown>> };
  return res.rows.map((r) => ({ id: Number(r.id), periodId: Number(r.period_id), year: Number(r.year), month: Number(r.month), action: String(r.action), reason: (r.reason as string | null) ?? null, actorName: String(r.actor_name), createdAt: new Date(r.created_at as string).toISOString() }));
}

/**
 * تذكير الإقفال (من الـcron اليومي): لو النهارده وصل يوم الإقفال والشهر اللي فات لسه مفتوح، بنعمل مهمة للمدير التنفيذي
 * (تصعيد لرئيس المجلس) بموعد آخر اليوم. مفتاح التكرار فيه رقم مرات إعادة الفتح فالفتح تاني بيعمل تذكير جديد.
 */
export async function ensureCloseReminder(exec: Exec, closeDay: number, now: Date = new Date()): Promise<{ created: boolean }> {
  const due = periodDueNow(todayCairo(now), closeDay);
  if (!due) return { created: false };
  const res = (await exec.execute(sql`select ${COLS} from gl_periods where year = ${due.year} and month = ${due.month}`)) as { rows: Array<Record<string, unknown>> };
  const row = res.rows[0];
  if (!row || row.status !== "open") return { created: false };
  const label = `${due.year}-${String(due.month).padStart(2, "0")}`;
  const { duplicate } = await createTask({
    kind: TASK_KIND,
    title: `اقفل الفترة المحاسبية ${label}`,
    description: `موعد إقفال شهر ${label} هو ${closeDueDate(due.year, due.month, closeDay)}. راجع التحذيرات في تبويب «الفترات» واقفلها.`,
    priority: "high",
    assigneeRole: "executive_manager",
    escalateToRole: "chairman",
    dueAt: taskDueAt(due.year, due.month, closeDay),
    sourceType: TASK_SOURCE,
    sourceId: Number(row.id),
    dedupeKey: taskDedupeKey(due.year, due.month, Number(row.reopen_count)),
  }, null, undefined, exec);
  return { created: !duplicate };
}
