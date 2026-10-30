/** @format */
// قواعد المهام البشرية بدون قاعدة بيانات: التحقق، حالة الموعد، وسياسة التصعيد.
// أي تغيير في سياسة التصعيد بيتم هنا فقط (وبيتختبر في humanTaskCore.test.ts).

import { z } from "zod";

export const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const ESCALATION_L2_AFTER_HOURS = 24;
export const DUE_SOON_HOURS = 4;
export const DEFAULT_ESCALATE_ROLE = "executive_manager";
export const TOP_ROLE = "chairman";

export const createTaskSchema = z
  .object({
    kind: z.string().trim().min(1).max(60).default("general"),
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(2000).default(""),
    priority: z.enum(TASK_PRIORITIES).default("normal"),
    assigneeUserId: z.number().int().positive().nullish(),
    assigneeRole: z.string().trim().min(1).max(60).nullish(),
    escalateToRole: z.string().trim().min(1).max(60).default(DEFAULT_ESCALATE_ROLE),
    dueAt: z.coerce.date().nullish(),
    sourceType: z.string().trim().max(60).nullish(),
    sourceId: z.number().int().positive().nullish(),
    dedupeKey: z.string().trim().max(200).nullish(),
  })
  .refine((v) => v.assigneeUserId || v.assigneeRole, { message: "لازم تحدد المسؤول عن المهمة: موظف أو دور", path: ["assigneeUserId"] });
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const completeTaskSchema = z.object({ note: z.string().trim().min(2, "اكتب نتيجة المهمة في كلمتين على الأقل").max(1000) });
export const cancelTaskSchema = z.object({ reason: z.string().trim().min(2, "اكتب سبب الإلغاء").max(500) });
export const reassignTaskSchema = z
  .object({ assigneeUserId: z.number().int().positive().nullish(), assigneeRole: z.string().trim().min(1).max(60).nullish(), reason: z.string().trim().min(2).max(500) })
  .refine((v) => v.assigneeUserId || v.assigneeRole, { message: "لازم تحدد المسؤول الجديد", path: ["assigneeUserId"] });

export type DueState = "none" | "ok" | "due_soon" | "overdue";

export function dueState(dueAt: Date | null, now: Date, status: TaskStatus): DueState {
  if (status === "done" || status === "cancelled" || !dueAt) return "none";
  const diff = dueAt.getTime() - now.getTime();
  if (diff <= 0) return "overdue";
  if (diff <= DUE_SOON_HOURS * 3_600_000) return "due_soon";
  return "ok";
}

const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };
export function raisePriority(current: TaskPriority, to: TaskPriority): TaskPriority {
  return PRIORITY_RANK[to] > PRIORITY_RANK[current] ? to : current;
}

/** الموعد القادم للتصعيد بعد مستوى معيّن (null = مفيش تصعيد تاني). */
export function nextEscalationAt(dueAt: Date | null, level: number): Date | null {
  if (!dueAt) return null;
  if (level <= 0) return dueAt;
  if (level === 1) return new Date(dueAt.getTime() + ESCALATION_L2_AFTER_HOURS * 3_600_000);
  return null;
}

export interface EscalationTask {
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  escalationLevel: number;
  nextEscalationAt: Date | null;
  escalateToRole: string;
}
export interface EscalationStep {
  level: number;
  notifyAssignee: boolean;
  notifyRoles: string[];
  priority: TaskPriority;
  nextEscalationAt: Date | null;
  reason: string;
}

/** الخطوة اللي لازم تتنفذ دلوقتي (أو null). بتتنفذ مستوى واحد في المرة، فلو السيرفر غاب يوم كامل بيمر على المستويين بالترتيب. */
export function nextEscalationStep(t: EscalationTask, now: Date): EscalationStep | null {
  if (t.status === "done" || t.status === "cancelled") return null;
  if (!t.nextEscalationAt || t.nextEscalationAt.getTime() > now.getTime()) return null;
  if (t.escalationLevel === 0) {
    return {
      level: 1,
      notifyAssignee: true,
      notifyRoles: [t.escalateToRole],
      priority: raisePriority(t.priority, "high"),
      nextEscalationAt: nextEscalationAt(t.dueAt, 1),
      reason: "عدّى الموعد النهائي ولسه المهمة مفتوحة: تم تنبيه المسؤول ومديره.",
    };
  }
  if (t.escalationLevel === 1) {
    return {
      level: 2,
      notifyAssignee: false,
      notifyRoles: t.escalateToRole === TOP_ROLE ? [TOP_ROLE] : [t.escalateToRole, TOP_ROLE],
      priority: "urgent",
      nextEscalationAt: null,
      reason: `المهمة متأخرة أكتر من ${ESCALATION_L2_AFTER_HOURS} ساعة عن موعدها: تم التصعيد للإدارة العليا.`,
    };
  }
  return null;
}

export interface TaskHealthStats { overdue: number; stuckUnescalated: number; oldestOverdueHours: number }

/** فحص صحة النظام: مهمة متأخرة ولسه ما اتصعّدتش بعد ساعة من وقت التصعيد = العامل واقف. */
export function taskHealth(s: TaskHealthStats): { status: "ok" | "warn" | "bad"; message: string; action?: string; count?: number } {
  if (s.stuckUnescalated > 0) {
    return {
      status: s.stuckUnescalated >= 5 ? "bad" : "warn",
      message: `في ${s.stuckUnescalated} مهمة عدّى موعد تصعيدها ولسه ما اتصعّدتش.`,
      action: "شوف تشغيلات «outbox-drain» في GitHub Actions؛ التصعيد بيتم فيها كل 15 دقيقة.",
      count: s.stuckUnescalated,
    };
  }
  if (s.overdue > 0) return { status: "ok", message: `${s.overdue} مهمة متأخرة وتم تصعيدها للمسؤولين.`, count: s.overdue };
  return { status: "ok", message: "مفيش مهام متأخرة." };
}

export interface TaskActor { userId: number; roles: readonly string[]; isManager: boolean }
export interface TaskOwnerFields { assigneeUserId: number | null; assigneeRole: string | null }

/** مين يقدر ينفّذ/يستلم المهمة: صاحبها، أو أي حد في الدور لو لسه ما اتسلّمتش لشخص، أو المدير. */
export function canActOnTask(t: TaskOwnerFields, a: TaskActor): boolean {
  if (a.isManager) return true;
  if (t.assigneeUserId) return t.assigneeUserId === a.userId;
  return !!t.assigneeRole && a.roles.includes(t.assigneeRole);
}

/** الأدوار اللي بتدير المهام (تشوف مهام الفريق وتعيد التوزيع وتنشئ مهام لغيرها). */
export const TASK_MANAGER_ROLES = ["chairman", "executive_manager", "sales_manager", "operations_manager", "purchasing_manager", "production_manager", "warehouse_manager", "hr_manager"] as const;

export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  open: ["in_progress", "done", "cancelled"],
  in_progress: ["done", "cancelled", "open"],
  done: [],
  cancelled: [],
};
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}
