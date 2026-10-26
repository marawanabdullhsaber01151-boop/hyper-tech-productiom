import { t, type CopyKey } from "../copy";
import { StatusPill, type Tone } from "../design/components";
import { CASE_TONE, PRIORITY_TONE, RISK_TONE, isCaseStatus, isPriority, isRiskReason, type RiskLevel } from "./operationsCore";

export const caseStatusLabel = (s: string): string => (isCaseStatus(s) ? t(`opc.st.${s}` as CopyKey) : s);

export function CaseStatusPill({ status }: { status: string }) {
  return <StatusPill tone={isCaseStatus(status) ? CASE_TONE[status] : "neutral"}>{caseStatusLabel(status)}</StatusPill>;
}

export function PriorityPill({ priority }: { priority: string }) {
  return <StatusPill tone={isPriority(priority) ? PRIORITY_TONE[priority] : "neutral"}>{isPriority(priority) ? t(`opc.pr.${priority}` as CopyKey) : priority}</StatusPill>;
}

export function RiskPill({ level }: { level: RiskLevel }) {
  return (
    <StatusPill tone={RISK_TONE[level]} pulse={level === "high"}>
      {t(`opc.risk.${level}` as CopyKey)}
    </StatusPill>
  );
}

/** أسباب الخطر كشارات صغيرة؛ ولو السبب مهلة بنعرض الساعات المنقضية من المسموح. */
export function ReasonChips({ reasons, hours, limit }: { reasons: string[]; hours?: number | null; limit?: number | null }) {
  if (!reasons.length) return null;
  return (
    <span class="opc-reasons">
      {reasons.filter(isRiskReason).map((r) => (
        <span key={r} class={`opc-chip opc-chip--${r === "overdue" || r === "sla_breached" || r === "waiting_sales" ? "danger" : "warn"}`}>
          {t(`opc.reason.${r}` as CopyKey)}
          {(r === "sla_breached" || r === "sla_due" || r === "waiting_sales") && hours != null && limit != null ? ` (${hours}/${limit})` : ""}
        </span>
      ))}
    </span>
  );
}

export const WF_STATUSES = [
  "new", "awaiting_operations_claim", "claimed", "pending_supervisor", "materials_requested", "materials_approved", "materials_partial", "materials_rejected",
  "in_production", "held", "rework", "quality_check", "partially_completed", "completed", "delivery_pending_customer", "delivery_pending_warehouse",
  "delivered_customer", "delivered_warehouse", "cancelled", "corrected", "closed",
] as const;
const isWf = (s: string): boolean => (WF_STATUSES as readonly string[]).includes(s);
export const wfLabel = (s: string): string => (isWf(s) ? t(`opc.wf.${s}` as CopyKey) : s);

export function wfTone(s: string): Tone {
  if (s === "cancelled" || s === "materials_rejected" || s === "held") return "danger";
  if (["awaiting_operations_claim", "pending_supervisor", "materials_requested", "materials_partial", "rework", "delivery_pending_customer", "delivery_pending_warehouse"].includes(s)) return "warn";
  if (["in_production", "delivered_customer", "delivered_warehouse", "closed"].includes(s)) return "success";
  if (["quality_check", "completed", "claimed", "partially_completed"].includes(s)) return "brand";
  return "info";
}
