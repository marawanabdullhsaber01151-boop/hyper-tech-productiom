/** منطق تبويبات الحوكمة النقي (الخطوة 39ب): النواب والسياسات والصلاحيات والأمان. السيرفر هو الحَكَم في كل قرار. */
export const GOVERNANCE_ADMIN_ROLES = ["chairman", "executive_manager"] as const;
export const canManageDelegations = (role: string | undefined) => !!role && (GOVERNANCE_ADMIN_ROLES as readonly string[]).includes(role);
/** السياسات والصلاحيات والمحاكاة وفحص السلسلة: رئيس المجلس فقط (نفس صلاحيات السيرفر). */
export const canEditGovernance = (role: string | undefined) => role === "chairman";

export interface Option { value: string; label: string }
export interface DelegationRow {
  delegation: { id: number; actionKey: string; grantorUserId: number; delegateUserId: number; scopeType: string; startsAt: string; endsAt: string; status: string; revokedAt: string | null; reason: string };
  grantorName: string; delegateName: string | null;
}
export type DelegationState = "active" | "upcoming" | "expired" | "revoked";
export function delegationState(d: DelegationRow["delegation"], now: number = Date.now()): DelegationState {
  if (d.revokedAt || d.status === "revoked") return "revoked";
  if (new Date(d.endsAt).getTime() <= now) return "expired";
  if (new Date(d.startsAt).getTime() > now) return "upcoming";
  return "active";
}
/** النايب يقدر يتلغى طالما لسه مش ملغي ولا منتهي. */
export const canRevoke = (s: DelegationState) => s === "active" || s === "upcoming";
export const countActive = (rows: readonly DelegationRow[], now: number = Date.now()) => rows.filter((r) => delegationState(r.delegation, now) === "active").length;

export interface DelegationForm { grantorUserId: string; delegateUserId: string; actionKey: string; scopeType: string; startsAt: string; endsAt: string; reason: string }
export const EMPTY_DELEGATION: DelegationForm = { grantorUserId: "", delegateUserId: "", actionKey: "", scopeType: "company", startsAt: "", endsAt: "", reason: "" };
export type DelegationError = "grantor" | "delegate" | "same" | "action" | "dates" | "range" | "reason" | "past";

export function delegationError(f: DelegationForm, now: number = Date.now()): DelegationError | null {
  if (!f.grantorUserId) return "grantor";
  if (!f.delegateUserId) return "delegate";
  if (f.grantorUserId === f.delegateUserId) return "same";
  if (!f.actionKey) return "action";
  const s = new Date(f.startsAt).getTime(), e = new Date(f.endsAt).getTime();
  if (!f.startsAt || !f.endsAt || Number.isNaN(s) || Number.isNaN(e)) return "dates";
  if (e <= s) return "range";
  if (e <= now) return "past";
  if (f.reason.trim().length < 3) return "reason";
  return null;
}
export const delegationPayload = (f: DelegationForm) => ({
  grantorUserId: Number(f.grantorUserId), delegateUserId: Number(f.delegateUserId), actionKey: f.actionKey, scopeType: f.scopeType,
  startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString(), reason: f.reason.trim(),
});

export interface PolicyRow { id: number; actionKey: string; minAmount: string; approverRoles: string[]; sequence: number; active: boolean }
export interface PolicyForm { actionKey: string; minAmount: string; approverRoles: string[]; sequence: string }
export const EMPTY_POLICY: PolicyForm = { actionKey: "", minAmount: "0", approverRoles: [], sequence: "1" };
export type PolicyError = "action" | "amount" | "roles" | "sequence";
export function policyError(f: PolicyForm): PolicyError | null {
  if (!f.actionKey) return "action";
  if (!/^\d+(\.\d{1,2})?$/.test(f.minAmount.trim())) return "amount";
  if (f.approverRoles.length === 0) return "roles";
  if (!/^[1-9]\d{0,2}$/.test(f.sequence.trim())) return "sequence";
  return null;
}
export const policyPayload = (f: PolicyForm) => ({ actionKey: f.actionKey, minAmount: f.minAmount.trim(), approverRoles: f.approverRoles, sequence: Number(f.sequence) });
/** تفعيل/إيقاف: بنبعت الحقل ده بس. */
export const togglePayload = (p: PolicyRow) => ({ active: !p.active });
/** سياسات الإجراء الواحد مرتبة بالخطوة ثم الحد الأدنى. */
export const sortPolicies = (rows: readonly PolicyRow[]): PolicyRow[] =>
  [...rows].sort((a, b) => a.actionKey.localeCompare(b.actionKey) || Number(a.minAmount) - Number(b.minAmount) || a.sequence - b.sequence || a.id - b.id);

export interface OverrideRow { id: number; actionKey: string; allowed: boolean; reason: string | null; expiresAt: string | null; revokedAt: string | null }
export type OverrideState = "active" | "expired" | "revoked";
export function overrideState(o: OverrideRow, now: number = Date.now()): OverrideState {
  if (o.revokedAt) return "revoked";
  if (o.expiresAt && new Date(o.expiresAt).getTime() <= now) return "expired";
  return "active";
}
export interface OverrideForm { userId: string; actionKey: string; allowed: "true" | "false"; expiresAt: string; reason: string }
export const EMPTY_OVERRIDE: OverrideForm = { userId: "", actionKey: "", allowed: "true", expiresAt: "", reason: "" };
export type OverrideError = "user" | "action" | "expiry" | "reason";
export function overrideError(f: OverrideForm, now: number = Date.now()): OverrideError | null {
  if (!f.userId) return "user";
  if (!f.actionKey) return "action";
  if (f.expiresAt && (Number.isNaN(new Date(f.expiresAt).getTime()) || new Date(f.expiresAt).getTime() <= now)) return "expiry";
  if (f.reason.trim().length < 3) return "reason";
  return null;
}
export const overridePayload = (f: OverrideForm) => ({
  userId: Number(f.userId), actionKey: f.actionKey, allowed: f.allowed === "true", reason: f.reason.trim(),
  ...(f.expiresAt ? { expiresAt: new Date(f.expiresAt).toISOString() } : {}),
});

export interface SimRow { key: string; label: string; allowed: boolean }
export const simulateSummary = (rows: readonly SimRow[]) => ({ allowed: rows.filter((r) => r.allowed).length, total: rows.length });
export interface VerifyResult { valid: boolean; count?: number; firstInvalidId?: number | null }
