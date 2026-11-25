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

/* ---------------- «صلاحياتي الفعلية» (دليل موسّع): الدور + الاستثناءات + التفويض ---------------- */
export interface MineGrant { key: string; label: string; group: string; /** ISO أو null = دائمة */ until: string | null; source: "override" | "delegation" }
export interface GuideMine { role: string; extraRoles: string[]; grants: MineGrant[]; blocked: Array<{ key: string; label: string; group: string; until: string | null }> }
export interface MineOverrideRow { actionKey: string; allowed: boolean; expiresAt: Date | null }
export interface MineDelegationRow { actionKey: string; startsAt: Date; endsAt: Date }
export interface MineAction { label: string; group: string; defaultRoles: readonly string[] }

/**
 * اللي بيتضاف على دور الموظف دلوقتي: صلاحيات مؤقتة/دائمة (استثناءات) أو تفويضات سارية، والمسحوب منه.
 * نفس ترتيب أولوية requirePermission: الاستثناء الصريح الأول (يمنع أو يسمح)، وبعده الدور الافتراضي، وبعده التفويض.
 * المنتهي أو الملغي مش بيظهر (الاستعلام بيشيل الملغي، وهنا بنشيل المنتهي بالوقت).
 */
export function buildMine(input: {
  role: string;
  overrides: readonly MineOverrideRow[];
  delegations: readonly MineDelegationRow[];
  now: Date;
  find: (key: string) => MineAction | undefined;
}): GuideMine {
  const { role, now } = input;
  const roleSet = new Set<string>(USER_ROLES);
  const info = (key: string) => {
    const a = input.find(key);
    return { label: a?.label ?? key, group: a?.group ?? "", defaults: a?.defaultRoles ?? [] };
  };
  const live = (d: Date | null) => d === null || d.getTime() > now.getTime();
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const chair = role === "chairman";
  const grants = new Map<string, MineGrant>();
  const blocked = new Map<string, GuideMine["blocked"][number]>();
  const overrideKeys = new Set<string>();
  const extraRoles = new Set<string>();

  for (const o of input.overrides) {
    if (!live(o.expiresAt)) continue;
    overrideKeys.add(o.actionKey);
    const i = info(o.actionKey);
    if (!o.allowed) {
      if (chair) continue;
      const prev = blocked.get(o.actionKey);
      if (!prev || (prev.until !== null && (o.expiresAt === null || o.expiresAt.toISOString() > prev.until))) blocked.set(o.actionKey, { key: o.actionKey, label: i.label, group: i.group, until: iso(o.expiresAt) });
      continue;
    }
    if (chair || i.defaults.includes(role)) continue;
    const prev = grants.get(o.actionKey);
    if (!prev || (prev.until !== null && (o.expiresAt === null || o.expiresAt.toISOString() > prev.until))) grants.set(o.actionKey, { key: o.actionKey, label: i.label, group: i.group, until: iso(o.expiresAt), source: "override" });
  }
  for (const d of input.delegations) {
    if (d.startsAt.getTime() > now.getTime() || d.endsAt.getTime() < now.getTime()) continue;
    if (roleSet.has(d.actionKey)) { if (d.actionKey !== role) extraRoles.add(d.actionKey); continue; }
    if (chair || overrideKeys.has(d.actionKey)) continue;
    const i = info(d.actionKey);
    if (i.defaults.includes(role)) continue;
    const prev = grants.get(d.actionKey);
    if (!prev || (prev.until !== null && d.endsAt.toISOString() > prev.until)) grants.set(d.actionKey, { key: d.actionKey, label: i.label, group: i.group, until: d.endsAt.toISOString(), source: "delegation" });
  }
  const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);
  return { role, extraRoles: [...extraRoles].sort(), grants: [...grants.values()].sort(byKey), blocked: [...blocked.values()].sort(byKey) };
}
