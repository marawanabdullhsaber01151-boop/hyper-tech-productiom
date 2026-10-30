/** @format */
// المهام البشرية بموعد وتصعيد (الخطوة 30). كل عملية في معاملة واحدة: تغيير المهمة + سجل الأحداث + إشعار المعنيين.
// التصعيد (runEscalations) بيشتغل من عامل الصندوق كل 15 دقيقة، وكل مهمة في معاملة لوحدها بقفل على صفها.

import { sql } from "drizzle-orm";
import type { Executor } from "./db-executor";
import { notifyRole, notifyUser } from "./notifications";
import {
  canActOnTask,
  canTransition,
  createTaskSchema,
  nextEscalationAt,
  nextEscalationStep,
  type CreateTaskInput,
  type TaskActor,
  type TaskPriority,
  type TaskStatus,
} from "./humanTaskCore";

export interface TaskDb {
  execute: (q: any) => Promise<any>;
  transaction: <T>(cb: (tx: any) => Promise<T>) => Promise<T>;
}
async function realDb(): Promise<TaskDb> {
  return (await import("../db")).db as unknown as TaskDb;
}

export interface TaskRow {
  id: number;
  kind: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeUserId: number | null;
  assigneeRole: string | null;
  escalateToRole: string;
  dueAt: Date | null;
  escalationLevel: number;
  nextEscalationAt: Date | null;
  sourceType: string | null;
  sourceId: number | null;
  createdBy: number | null;
  completedAt: Date | null;
  resultNote: string | null;
  createdAt: Date;
}

const COLS = sql`id, kind, title, description, status, priority, assignee_user_id, assignee_role, escalate_to_role, due_at, escalation_level, next_escalation_at, source_type, source_id, created_by, completed_at, result_note, created_at`;

export function mapTask(r: any): TaskRow {
  const d = (v: unknown) => (v ? new Date(v as string) : null);
  return {
    id: Number(r.id),
    kind: r.kind,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    assigneeUserId: r.assignee_user_id ?? null,
    assigneeRole: r.assignee_role ?? null,
    escalateToRole: r.escalate_to_role,
    dueAt: d(r.due_at),
    escalationLevel: Number(r.escalation_level),
    nextEscalationAt: d(r.next_escalation_at),
    sourceType: r.source_type ?? null,
    sourceId: r.source_id ?? null,
    createdBy: r.created_by ?? null,
    completedAt: d(r.completed_at),
    resultNote: r.result_note ?? null,
    createdAt: new Date(r.created_at),
  };
}

export class TaskError extends Error {
  constructor(public code: "NOT_FOUND" | "FORBIDDEN" | "BAD_STATE" | "INVALID", message: string) {
    super(message);
  }
}

async function addEvent(tx: Executor, taskId: number, event: string, actor: number | null, detail: string) {
  await tx.execute(sql`INSERT INTO human_task_events (task_id, event, actor_user_id, detail) VALUES (${taskId}, ${event}, ${actor}, ${detail})`);
}

async function notifyOwner(tx: Executor, t: { assigneeUserId: number | null; assigneeRole: string | null }, title: string, body: string, taskId: number, type = "task") {
  const payload = { type, title, body, referenceType: "human_task", referenceId: taskId };
  if (t.assigneeUserId) await notifyUser(t.assigneeUserId, payload, { executor: tx });
  else if (t.assigneeRole) await notifyRole(t.assigneeRole, payload, { executor: tx });
}

/** إنشاء مهمة. نفس dedupeKey مرتين = نفس المهمة (duplicate=true) فمفيش مهمة بتتكرر لو العملية اتعادت. */
export async function createTask(input: unknown, createdBy: number | null, database?: TaskDb, executor?: Executor): Promise<{ task: TaskRow; duplicate: boolean }> {
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) throw new TaskError("INVALID", parsed.error.issues[0]?.message ?? "بيانات المهمة غير صحيحة");
  const v: CreateTaskInput = parsed.data;
  const run = async (tx: any) => {
    const due = v.dueAt ?? null;
    const next = nextEscalationAt(due, 0);
    const ins = await tx.execute(sql`
      INSERT INTO human_tasks (kind, title, description, priority, assignee_user_id, assignee_role, escalate_to_role, due_at, next_escalation_at, source_type, source_id, dedupe_key, created_by)
      VALUES (${v.kind}, ${v.title}, ${v.description}, ${v.priority}, ${v.assigneeUserId ?? null}, ${v.assigneeUserId ? null : (v.assigneeRole ?? null)}, ${v.escalateToRole},
        ${due ? due.toISOString() : null}::timestamptz, ${next ? next.toISOString() : null}::timestamptz, ${v.sourceType ?? null}, ${v.sourceId ?? null}, ${v.dedupeKey ?? null}, ${createdBy})
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING ${COLS}`);
    const row = (ins.rows as any[])[0];
    if (!row) {
      const ex = await tx.execute(sql`SELECT ${COLS} FROM human_tasks WHERE dedupe_key = ${v.dedupeKey ?? null}`);
      return { task: mapTask((ex.rows as any[])[0]), duplicate: true };
    }
    const task = mapTask(row);
    await addEvent(tx, task.id, "created", createdBy, `اتنشأت مهمة «${task.title}»${due ? ` بموعد ${due.toISOString()}` : ""}.`);
    await notifyOwner(tx, task, "مهمة جديدة ليك", task.title, task.id);
    return { task, duplicate: false };
  };
  if (executor) return run(executor);
  return (await (database ?? (await realDb()))).transaction(run);
}

async function lockTask(tx: any, id: number): Promise<TaskRow> {
  const r = await tx.execute(sql`SELECT ${COLS} FROM human_tasks WHERE id = ${id} FOR UPDATE`);
  const row = (r.rows as any[])[0];
  if (!row) throw new TaskError("NOT_FOUND", "المهمة مش موجودة");
  return mapTask(row);
}
function assertCan(t: TaskRow, actor: TaskActor) {
  if (!canActOnTask(t, actor)) throw new TaskError("FORBIDDEN", "المهمة دي مش مسندة ليك");
}
function assertMove(t: TaskRow, to: TaskStatus) {
  if (!canTransition(t.status, to)) throw new TaskError("BAD_STATE", t.status === "done" ? "المهمة دي اتنفذت قبل كده" : t.status === "cancelled" ? "المهمة دي اتلغت قبل كده" : "الحالة الحالية للمهمة ما بتسمحش بالإجراء ده");
}

export async function claimTask(id: number, actor: TaskActor, database?: TaskDb): Promise<TaskRow> {
  return (await (database ?? (await realDb()))).transaction(async (tx) => {
    const t = await lockTask(tx, id);
    assertCan(t, actor);
    if (t.status === "in_progress" && t.assigneeUserId === actor.userId) return t;
    assertMove(t, "in_progress");
    await tx.execute(sql`UPDATE human_tasks SET status = 'in_progress', assignee_user_id = ${actor.userId}, claimed_by = ${actor.userId}, updated_at = now() WHERE id = ${id}`);
    await addEvent(tx, id, "claimed", actor.userId, "المهمة اتسلّمت وبدأ التنفيذ.");
    return lockTask(tx, id);
  });
}

export async function completeTask(id: number, note: string, actor: TaskActor, database?: TaskDb): Promise<TaskRow> {
  return (await (database ?? (await realDb()))).transaction(async (tx) => {
    const t = await lockTask(tx, id);
    assertCan(t, actor);
    assertMove(t, "done");
    await tx.execute(sql`UPDATE human_tasks SET status = 'done', completed_by = ${actor.userId}, completed_at = now(), result_note = ${note}, next_escalation_at = NULL, updated_at = now() WHERE id = ${id}`);
    await addEvent(tx, id, "completed", actor.userId, `اتنفذت: ${note}`);
    if (t.createdBy && t.createdBy !== actor.userId) await notifyUser(t.createdBy, { type: "task", title: "مهمة اتنفذت", body: `${t.title}: ${note}`, referenceType: "human_task", referenceId: id }, { executor: tx });
    return lockTask(tx, id);
  });
}

export async function cancelTask(id: number, reason: string, actor: TaskActor, database?: TaskDb): Promise<TaskRow> {
  return (await (database ?? (await realDb()))).transaction(async (tx) => {
    const t = await lockTask(tx, id);
    if (!actor.isManager && t.createdBy !== actor.userId) throw new TaskError("FORBIDDEN", "الإلغاء لصاحب المهمة أو المدير فقط");
    assertMove(t, "cancelled");
    await tx.execute(sql`UPDATE human_tasks SET status = 'cancelled', next_escalation_at = NULL, result_note = ${reason}, updated_at = now() WHERE id = ${id}`);
    await addEvent(tx, id, "cancelled", actor.userId, `اتلغت: ${reason}`);
    await notifyOwner(tx, t, "مهمة اتلغت", `${t.title}: ${reason}`, id);
    return lockTask(tx, id);
  });
}

export async function reassignTask(id: number, to: { assigneeUserId?: number | null; assigneeRole?: string | null }, reason: string, actor: TaskActor, database?: TaskDb): Promise<TaskRow> {
  if (!actor.isManager) throw new TaskError("FORBIDDEN", "إعادة التوزيع للمديرين فقط");
  if (!to.assigneeUserId && !to.assigneeRole) throw new TaskError("INVALID", "لازم تحدد المسؤول الجديد");
  return (await (database ?? (await realDb()))).transaction(async (tx) => {
    const t = await lockTask(tx, id);
    assertMove(t, "open");
    await tx.execute(sql`UPDATE human_tasks SET status = 'open', assignee_user_id = ${to.assigneeUserId ?? null}, assignee_role = ${to.assigneeUserId ? null : (to.assigneeRole ?? null)}, claimed_by = NULL, updated_at = now() WHERE id = ${id}`);
    await addEvent(tx, id, "reassigned", actor.userId, `اتنقلت لمسؤول جديد: ${reason}`);
    await notifyOwner(tx, { assigneeUserId: to.assigneeUserId ?? null, assigneeRole: to.assigneeUserId ? null : (to.assigneeRole ?? null) }, "مهمة اتسندت ليك", t.title, id);
    return lockTask(tx, id);
  });
}

export interface TaskListFilter { scope: "mine" | "team"; actor: TaskActor; status?: "active" | "all"; limit?: number }

export async function listTasks(f: TaskListFilter, database?: TaskDb): Promise<TaskRow[]> {
  const db = database ?? (await realDb());
  const limit = Math.min(f.limit ?? 100, 200);
  const statusSql = f.status === "all" ? sql`TRUE` : sql`status IN ('open','in_progress')`;
  const scopeSql =
    f.scope === "team" && f.actor.isManager
      ? sql`TRUE`
      : sql`(assignee_user_id = ${f.actor.userId} OR (assignee_user_id IS NULL AND assignee_role IN (${sql.join((f.actor.roles.length ? [...f.actor.roles] : [""]).map((r) => sql`${r}`), sql`, `)})))`;
  const r = await db.execute(sql`
    SELECT ${COLS} FROM human_tasks WHERE ${statusSql} AND ${scopeSql}
    ORDER BY (status IN ('done','cancelled')), COALESCE(due_at, 'infinity'::timestamptz), id DESC LIMIT ${limit}`);
  return (r.rows as any[]).map(mapTask);
}

export interface TaskDetail { task: TaskRow; events: Array<{ id: number; event: string; actorUserId: number | null; detail: string; createdAt: Date }> }

export async function getTaskDetail(id: number, actor: TaskActor, database?: TaskDb): Promise<TaskDetail> {
  const db = database ?? (await realDb());
  const r = await db.execute(sql`SELECT ${COLS} FROM human_tasks WHERE id = ${id}`);
  const row = (r.rows as any[])[0];
  if (!row) throw new TaskError("NOT_FOUND", "المهمة مش موجودة");
  const task = mapTask(row);
  if (!actor.isManager && task.createdBy !== actor.userId && !canActOnTask(task, actor)) throw new TaskError("FORBIDDEN", "المهمة دي مش مسندة ليك");
  const ev = await db.execute(sql`SELECT id, event, actor_user_id, detail, created_at FROM human_task_events WHERE task_id = ${id} ORDER BY id`);
  return { task, events: (ev.rows as any[]).map((e) => ({ id: Number(e.id), event: e.event, actorUserId: e.actor_user_id ?? null, detail: e.detail, createdAt: new Date(e.created_at) })) };
}

export interface EscalationResult { picked: number; escalated: number; skipped: number; failed: number }

/** تصعيد المهام المتأخرة. بتتنادى من عامل الصندوق؛ تشغيلتين متزامنتين ما بيمسكوش نفس المهمة (SKIP LOCKED). */
export async function runEscalations(opts: { limit?: number; now?: Date; database?: TaskDb } = {}): Promise<EscalationResult> {
  const db = opts.database ?? (await realDb());
  const now = opts.now ?? new Date();
  const res: EscalationResult = { picked: 0, escalated: 0, skipped: 0, failed: 0 };
  const due = await db.execute(sql`
    SELECT id FROM human_tasks
    WHERE status IN ('open','in_progress') AND next_escalation_at IS NOT NULL AND next_escalation_at <= ${now.toISOString()}::timestamptz
    ORDER BY next_escalation_at LIMIT ${opts.limit ?? 50}`);
  for (const r of due.rows as Array<{ id: string | number }>) {
    res.picked += 1;
    try {
      const done = await db.transaction(async (tx) => {
        const lk = await tx.execute(sql`SELECT ${COLS} FROM human_tasks WHERE id = ${Number(r.id)} AND status IN ('open','in_progress') FOR UPDATE SKIP LOCKED`);
        const row = (lk.rows as any[])[0];
        if (!row) return false;
        const t = mapTask(row);
        const step = nextEscalationStep(t, now);
        if (!step) return false;
        await tx.execute(sql`
          UPDATE human_tasks SET escalation_level = ${step.level}, priority = ${step.priority},
            next_escalation_at = ${step.nextEscalationAt ? step.nextEscalationAt.toISOString() : null}::timestamptz, updated_at = now()
          WHERE id = ${t.id}`);
        await addEvent(tx, t.id, `escalated_l${step.level}`, null, step.reason);
        const base = { type: "task_escalation", referenceType: "human_task", referenceId: t.id };
        const title = step.level === 1 ? "مهمة متأخرة عن موعدها" : "تصعيد: مهمة متأخرة جدًا";
        const body = `${t.title} — ${step.reason}`;
        if (step.notifyAssignee) await notifyOwner(tx, t, title, body, t.id, "task_escalation");
        for (const role of step.notifyRoles) await notifyRole(role, { ...base, title, body }, { executor: tx });
        return true;
      });
      if (done) res.escalated += 1;
      else res.skipped += 1;
    } catch {
      res.failed += 1;
    }
  }
  return res;
}
