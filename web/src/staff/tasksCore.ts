/** المهام: منطق نقي (من غير شاشة). السيرفر هو المرجع: src/lib/humanTaskCore.ts. */
export const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
type Tone = "neutral" | "info" | "brand" | "success" | "warn" | "danger";

/** نفس TASK_MANAGER_ROLES في السيرفر. */
export const TASK_MANAGER_ROLES = ["chairman", "executive_manager", "sales_manager", "operations_manager", "purchasing_manager", "production_manager", "warehouse_manager", "hr_manager"] as const;
export const isTaskManager = (role: string | undefined) => !!role && (TASK_MANAGER_ROLES as readonly string[]).includes(role);

/** كل الأدوار اللي تتسند لها مهمة (دور كامل) — نفس قايمة الأدوار في السيرفر. */
export const ASSIGNABLE_ROLES = [
  "chairman", "executive_manager", "sales_manager", "online_seller", "offline_seller", "operations_manager", "purchasing_manager", "buyer", "supervisor",
  "production_controller", "hr", "hr_manager", "production_manager", "warehouse_manager", "storekeeper", "production_quality_controller", "raw_material_quality_controller", "quality_engineer",
] as const;

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
  dueAt: string | null;
  escalationLevel: number;
  createdBy: number | null;
  completedAt: string | null;
  resultNote: string | null;
  createdAt: string;
}
export interface TaskEvent {
  id: number;
  event: string;
  actorUserId: number | null;
  detail: string;
  createdAt: string;
}
export interface TaskDetail {
  task: TaskRow;
  events: TaskEvent[];
}

export type DueState = "none" | "ok" | "due_soon" | "overdue";
export const DUE_SOON_HOURS = 4;

export function dueState(task: Pick<TaskRow, "dueAt" | "status">, now: number = Date.now()): DueState {
  if (task.status === "done" || task.status === "cancelled" || !task.dueAt) return "none";
  const diff = new Date(task.dueAt).getTime() - now;
  if (!Number.isFinite(diff)) return "none";
  if (diff <= 0) return "overdue";
  if (diff <= DUE_SOON_HOURS * 3_600_000) return "due_soon";
  return "ok";
}
export const DUE_TONE: Record<DueState, Tone> = { none: "neutral", ok: "neutral", due_soon: "warn", overdue: "danger" };
export const STATUS_TONE: Record<TaskStatus, Tone> = { open: "info", in_progress: "brand", done: "success", cancelled: "neutral" };
export const PRIORITY_TONE: Record<TaskPriority, Tone> = { low: "neutral", normal: "neutral", high: "warn", urgent: "danger" };
export const isActive = (s: TaskStatus) => s === "open" || s === "in_progress";

/** مرتّبة: المتأخر أولًا، بعدين الأقرب موعدًا، والمنتهي في الآخر. */
export function sortTasks(rows: TaskRow[], now: number = Date.now()): TaskRow[] {
  const rank = (r: TaskRow) => (isActive(r.status) ? (dueState(r, now) === "overdue" ? 0 : 1) : 2);
  const due = (r: TaskRow) => (r.dueAt ? new Date(r.dueAt).getTime() : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => rank(a) - rank(b) || due(a) - due(b) || b.id - a.id);
}

export function taskCounts(rows: TaskRow[], now: number = Date.now()) {
  const active = rows.filter((r) => isActive(r.status));
  return {
    active: active.length,
    overdue: active.filter((r) => dueState(r, now) === "overdue").length,
    dueSoon: active.filter((r) => dueState(r, now) === "due_soon").length,
  };
}

/** هل المستخدم يقدر يستلم/ينفّذ المهمة (نفس قاعدة السيرفر canActOnTask). */
export function canAct(task: Pick<TaskRow, "assigneeUserId" | "assigneeRole">, me: { id: number; role: string }): boolean {
  if (isTaskManager(me.role)) return true;
  if (task.assigneeUserId) return task.assigneeUserId === me.id;
  return !!task.assigneeRole && task.assigneeRole === me.role;
}

export interface TaskDraft {
  title: string;
  description: string;
  priority: TaskPriority;
  target: "me" | "role";
  role: string;
  due: string; // قيمة datetime-local
}
export const emptyDraft = (): TaskDraft => ({ title: "", description: "", priority: "normal", target: "me", role: "", due: "" });

export interface DraftErrors {
  title: boolean;
  role: boolean;
  due: boolean;
}
export function validateDraft(d: TaskDraft): { ok: boolean; errors: DraftErrors } {
  const errors: DraftErrors = {
    title: d.title.trim().length < 2,
    role: d.target === "role" && !d.role,
    due: d.due !== "" && Number.isNaN(new Date(d.due).getTime()),
  };
  return { ok: !errors.title && !errors.role && !errors.due, errors };
}
export function toPayload(d: TaskDraft, myId: number) {
  return {
    title: d.title.trim(),
    description: d.description.trim(),
    priority: d.priority,
    ...(d.target === "me" ? { assigneeUserId: myId } : { assigneeRole: d.role }),
    ...(d.due ? { dueAt: new Date(d.due).toISOString() } : {}),
  };
}
