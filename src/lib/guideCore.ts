/** @format */
// دليل النظام (المرحلة 1): بناء بيانات الدليل «الحية» من مصادر الحقيقة (الصلاحيات، شجرة الصفحات، سياسات الاعتماد). نقي من قاعدة البيانات. ADR 0040.
import { USER_ROLES } from "./roles";
import { ROLE_LABELS } from "./roleLabels";
import { BUSINESS_HOURS, SLA_SOON_AT, SLA_WORKING_MINUTES, SELF_APPROVAL_EXEMPT } from "../domain/approvals-inbox";

export interface GuideRole { id: string; label: string; approver: boolean; exempt: boolean }
export interface GuidePermission { resource: string; action: string; roles: string[] }
export interface GuideNavPage { id: string; label: string; href: string; roles: string[] }
export interface GuideNavDept { id: string; label: string; icon: string; roles: string[]; subFunctions: Array<{ id: string; label: string; pages: GuideNavPage[] }> }
export interface PolicyRow { actionKey: string; minAmount: string; approverRoles: string[]; sequence: number; requiredApprovals: number; active: boolean }
export interface GuidePolicyGroup { actionKey: string; tiers: Array<{ minAmount: string; steps: Array<{ sequence: number; roles: string[]; requiredApprovals: number }> }> }

/** الأدوار بأسمائها العربي + هل معتمد + هل معفي من منع اعتماد النفس. */
export function buildRoles(approverRoles: readonly string[]): GuideRole[] {
  return USER_ROLES.map((id) => ({ id, label: ROLE_LABELS[id], approver: approverRoles.includes(id), exempt: SELF_APPROVAL_EXEMPT.includes(id) }));
}

/** مصفوفة PERMISSIONS مسطّحة: صف لكل (مورد، فعل) بالأدوار المسموحة (من غير تكرار ومرتبة بترتيب الأدوار الرسمي). */
export function flattenPermissions(perms: Record<string, Record<string, readonly string[]>>): GuidePermission[] {
  const order = new Map<string, number>(USER_ROLES.map((r, i) => [r, i]));
  const out: GuidePermission[] = [];
  for (const [resource, actions] of Object.entries(perms)) {
    for (const [action, roles] of Object.entries(actions)) {
      const uniq = [...new Set(roles)].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
      out.push({ resource, action, roles: uniq });
    }
  }
  return out;
}

/** سياسات الاعتماد متجمّعة: لكل إجراء شرائح حسب المبلغ، ولكل شريحة خطواتها بالترتيب. السياسات المعطّلة بتتشال. */
export function groupPolicies(rows: readonly PolicyRow[]): GuidePolicyGroup[] {
  const byAction = new Map<string, Map<string, GuidePolicyGroup["tiers"][number]>>();
  for (const r of rows) {
    if (!r.active) continue;
    const tiers = byAction.get(r.actionKey) ?? new Map();
    const key = normAmount(r.minAmount);
    const tier = tiers.get(key) ?? { minAmount: key, steps: [] };
    tier.steps.push({ sequence: r.sequence, roles: [...r.approverRoles], requiredApprovals: r.requiredApprovals });
    tiers.set(key, tier);
    byAction.set(r.actionKey, tiers);
  }
  return [...byAction.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([actionKey, tiers]) => ({
      actionKey,
      tiers: [...tiers.values()]
        .map((t) => ({ ...t, steps: t.steps.sort((a, b) => a.sequence - b.sequence) }))
        .sort((a, b) => Number(a.minAmount) - Number(b.minAmount)),
    }));
}

/** «100000.00» ← «100000»؛ أي قيمة مش رقم بترجع «0» (الأمان: أقل شريحة). */
export function normAmount(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? String(n) : "0";
}

export function slaSummary() {
  return { minutes: SLA_WORKING_MINUTES, soonAt: SLA_SOON_AT, hours: { start: BUSINESS_HOURS.startHour, end: BUSINESS_HOURS.endHour, offDay: BUSINESS_HOURS.offDay } };
}

/** شجرة الصفحات للعرض: بدون أي حاجة غير معرّف/اسم/رابط/أدوار. */
export function buildNav(depts: ReadonlyArray<{ id: string; label: string; icon: string; roles: readonly string[]; subFunctions: ReadonlyArray<{ id: string; label: string; pages: ReadonlyArray<{ id: string; label: string; href: string; roles: readonly string[] }> }> }>): GuideNavDept[] {
  return depts.map((d) => ({
    id: d.id, label: d.label, icon: d.icon, roles: [...d.roles],
    subFunctions: d.subFunctions.map((s) => ({ id: s.id, label: s.label, pages: s.pages.map((p) => ({ id: p.id, label: p.label, href: p.href, roles: [...p.roles] })) })),
  }));
}
