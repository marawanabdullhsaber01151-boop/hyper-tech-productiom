/** منطق صندوق الاعتمادات النقي (الخطوة 39أ). السيرفر هو الحَكَم (PATCH /governance/approval-requests/:id/decide). */
export const APPROVER_ROLES = ["chairman", "executive_manager", "sales_manager", "purchasing_manager", "hr_manager", "production_manager", "operations_manager"] as const;
export const canOpenInbox = (role: string | undefined) => !!role && (APPROVER_ROLES as readonly string[]).includes(role);

export type Sla = "ok" | "due_soon" | "overdue";
export interface Verdict { canApprove: boolean; canReject: boolean; block: "role" | "self" | null; selfException: boolean }
export interface InboxRow {
  id: number; actionKey: string; resourceType: string; resourceId: number; title: string; amount: number; status: string;
  requesterName: string; requesterRoleLabel: string; createdAt: string; waitedMinutes: number; sla: Sla; stepRoleLabels: string[];
  mine: boolean; verdict: Verdict; impact: { approve: string[]; reject: string[] }; decisionNote: string | null; decidedAt: string | null;
}

export const slaTone = (s: Sla): "success" | "warn" | "danger" => (s === "overdue" ? "danger" : s === "due_soon" ? "warn" : "success");
const SLA_RANK: Record<Sla, number> = { overdue: 0, due_soon: 1, ok: 2 };
/** المتأخر الأول، ثم الأطول انتظارًا. */
export const sortInbox = (rows: readonly InboxRow[]): InboxRow[] => [...rows].sort((a, b) => SLA_RANK[a.sla] - SLA_RANK[b.sla] || b.waitedMinutes - a.waitedMinutes || a.id - b.id);

export const waitParts = (minutes: number): { h: number; m: number } => ({ h: Math.floor(Math.max(0, minutes) / 60), m: Math.max(0, minutes) % 60 });

export function summarize(rows: readonly InboxRow[]) {
  return { total: rows.length, overdue: rows.filter((r) => r.sla === "overdue").length, dueSoon: rows.filter((r) => r.sla === "due_soon").length, mine: rows.filter((r) => r.mine).length };
}

export type Decision = "approve" | "reject";
/** الرفض لازم سبب (3 حروف على الأقل)؛ الاعتماد من غير شرط. */
export const decisionError = (kind: Decision, note: string): "note" | null => (kind === "reject" && note.trim().length < 3 ? "note" : null);
export const decidePayload = (kind: Decision, note: string) => {
  const n = note.trim();
  return { decision: kind, ...(n ? { note: n } : {}) };
};
/** ليه زرار الاعتماد مقفول (للتلميح)؟ */
export const approveBlock = (r: InboxRow): "self" | "role" | null => (r.verdict.canApprove ? null : r.verdict.block);
