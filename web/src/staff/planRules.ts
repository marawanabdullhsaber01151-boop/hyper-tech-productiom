/** مستويات اعتماد خطة التشغيل في الواجهة (نفس approvalLevelFor / PLAN_LEVEL_ROLES / checkPlanDecision في السيرفر). */
export type PlanLevel = 0 | 1 | 2 | 3;

export const PLAN_LEVEL_ROLES: Record<PlanLevel, readonly string[]> = {
  0: ["operations_manager", "executive_manager", "chairman"],
  1: ["executive_manager", "chairman"],
  2: ["chairman"],
  3: ["chairman"],
};

export const PLAN_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export function planTone(status: string): "neutral" | "warn" | "success" | "danger" {
  if (status === "approved") return "success";
  if (status === "submitted") return "warn";
  if (status === "rejected") return "danger";
  return "neutral";
}

export interface PlanActor {
  role: string;
  userId: number;
}
export interface PlanLite {
  status: string;
  approvalLevel: number;
  submittedBy?: number | null;
}

export const canSubmitPlan = (p: PlanLite, actor: PlanActor) =>
  p.status === "draft" && PLAN_LEVEL_ROLES[0].includes(actor.role);

/** هل الزرّين (اعتماد/رفض) يظهروا؟ الرفض لصاحب الخطة مسموح (سحب)، والاعتماد لا. */
export function planDecisionAccess(p: PlanLite, actor: PlanActor): { approve: boolean; reject: boolean; needsNote: boolean } {
  if (p.status !== "submitted") return { approve: false, reject: false, needsNote: false };
  const level = Math.min(3, Math.max(0, p.approvalLevel)) as PlanLevel;
  const roleOk = PLAN_LEVEL_ROLES[level].includes(actor.role);
  const own = p.submittedBy != null && p.submittedBy === actor.userId;
  return { approve: roleOk && !(level >= 1 && own), reject: roleOk, needsNote: level === 3 };
}
