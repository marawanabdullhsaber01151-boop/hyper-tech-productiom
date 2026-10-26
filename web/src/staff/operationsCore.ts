/** منطق مركز قيادة التشغيل النقي (بيعكس src/lib/operationsCenterCore.ts في السيرفر، والسيرفر هو المرجع). */
import type { Tone } from "../design/components";

export const CASE_STATUSES = ["received", "under_validation", "needs_sales_clarification", "analysis_ready", "converted", "cancelled", "completed", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const isCaseStatus = (s: string): s is CaseStatus => (CASE_STATUSES as readonly string[]).includes(s);

export const CASE_TONE: Record<CaseStatus, Tone> = {
  received: "info",
  under_validation: "brand",
  needs_sales_clarification: "warn",
  analysis_ready: "success",
  converted: "success",
  cancelled: "danger",
  completed: "neutral",
  closed: "neutral",
};

export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_TONE: Record<Priority, Tone> = { urgent: "danger", high: "warn", normal: "neutral", low: "neutral" };
export const isPriority = (s: string): s is Priority => (PRIORITIES as readonly string[]).includes(s);

export type RiskLevel = "low" | "medium" | "high";
export const RISK_TONE: Record<RiskLevel, Tone> = { high: "danger", medium: "warn", low: "success" };
export type RiskReason = "overdue" | "due_soon" | "sla_breached" | "sla_due" | "waiting_sales" | "urgent_unassigned";
export const RISK_REASONS: readonly RiskReason[] = ["overdue", "due_soon", "sla_breached", "sla_due", "waiting_sales", "urgent_unassigned"];
export const isRiskReason = (s: string): s is RiskReason => (RISK_REASONS as readonly string[]).includes(s);

export type NextAction = "start_validation" | "complete_validation" | "resume_validation" | "convert" | "track_orders" | "none";

export interface Kpis {
  activeCases: number;
  atRisk: number;
  slaBreached: number;
  waitingSales: number;
  unassigned: number;
  readyToConvert: number;
  awaitingClaim: number;
  requisitionsPending: number;
  transfersPending: number;
  exceptionsOpen: number;
  overdueOrders: number;
}

export interface Overview {
  generatedAt: string;
  kpis: Kpis;
  byStatus: Record<string, number>;
  pipeline: Record<string, number>;
  atRisk: Array<{ id: number; caseNumber: string; status: string; priority: string; dueDate: string | null; customerDisplayName: string | null; level: RiskLevel; reasons: string[]; slaHours: number | null; slaLimit: number | null }>;
  claimQueue: Array<{ id: number; orderNumber: string; productName: string; qty: string; unit: string; priority: string; neededBy: string | null; customerName: string | null; createdAt: string }>;
  team: Array<{ id: number; name: string; role: string; activeCases: number }>;
}

/** «الخطوة الأهم دلوقتي»: أول بند عليه شغل فعلي، بترتيب الأولوية (الأخطر ثم الأقرب لتحويله لإنتاج). */
export type FocusKind = "sla" | "convert" | "claim" | "waiting" | "requisitions" | "exceptions" | "unassigned" | "calm";
export function focusOf(k: Kpis): { kind: FocusKind; count: number } {
  if (k.slaBreached > 0) return { kind: "sla", count: k.slaBreached };
  if (k.readyToConvert > 0) return { kind: "convert", count: k.readyToConvert };
  if (k.awaitingClaim > 0) return { kind: "claim", count: k.awaitingClaim };
  if (k.exceptionsOpen > 0) return { kind: "exceptions", count: k.exceptionsOpen };
  if (k.requisitionsPending > 0) return { kind: "requisitions", count: k.requisitionsPending };
  if (k.waitingSales > 0) return { kind: "waiting", count: k.waitingSales };
  if (k.unassigned > 0) return { kind: "unassigned", count: k.unassigned };
  return { kind: "calm", count: 0 };
}

/** أجزاء شريط الحالات (النسب من الإجمالي، والصفر بيتشال). */
export function pipelineSegments(byStatus: Record<string, number>): Array<{ status: CaseStatus; count: number; pct: number }> {
  const order: CaseStatus[] = ["received", "under_validation", "needs_sales_clarification", "analysis_ready"];
  const total = order.reduce((n, s) => n + (byStatus[s] ?? 0), 0);
  if (!total) return [];
  return order.filter((s) => (byStatus[s] ?? 0) > 0).map((s) => ({ status: s, count: byStatus[s] ?? 0, pct: Math.round(((byStatus[s] ?? 0) / total) * 100) }));
}

/** سبب النسخة بيتخزّن "code: ملاحظة" — بنفصلهم عشان نعرض عنوان مفهوم + الملاحظة. */
export function parseRevisionReason(reason: string | null | undefined): { code: string; note: string } {
  const text = (reason ?? "").trim();
  const i = text.indexOf(":");
  if (i === -1) return { code: text, note: "" };
  return { code: text.slice(0, i).trim(), note: text.slice(i + 1).trim() };
}

/** شكل رد التحويل لما بند ملوش وصفة. */
export interface UnresolvedLine {
  lineId: number;
  productName: string;
  reason: "none" | "ambiguous";
}
export function unresolvedFrom(details: unknown): UnresolvedLine[] {
  if (!Array.isArray(details)) return [];
  return details.filter((d): d is UnresolvedLine => !!d && typeof d === "object" && typeof (d as UnresolvedLine).productName === "string");
}
