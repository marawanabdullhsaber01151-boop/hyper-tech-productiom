// دليل النظام: منطق نقي (من غير نصوص عربي؛ كل النصوص مفاتيح في copy/guide.ts). المصدر الحي بييجي من GET /guide/live.

export interface GuideRole { id: string; label: string; approver: boolean; exempt: boolean }
export interface GuidePermission { resource: string; action: string; roles: string[] }
export interface GuideNavPage { id: string; label: string; href: string; roles: string[] }
export interface GuideNavDept { id: string; label: string; icon: string; roles: string[]; subFunctions: Array<{ id: string; label: string; pages: GuideNavPage[] }> }
export interface GuideTier { minAmount: string; steps: Array<{ sequence: number; roles: string[]; requiredApprovals: number }> }
export interface GuidePolicyGroup { actionKey: string; tiers: GuideTier[] }
export interface GuideLive {
  roles: GuideRole[];
  permissions: GuidePermission[];
  nav: GuideNavDept[];
  policies: GuidePolicyGroup[];
  sla: { minutes: number; soonAt: number; hours: { start: number; end: number; offDay: number } };
}

/** الأفعال اللي بتغيّر بيانات (غير كده = عرض بس). */
export const WRITE_ACTIONS: readonly string[] = ["write", "manage", "analysisRun", "planCreate", "planEdit", "planSubmit", "planApprove", "planDispatch"];
export type Level = "none" | "view" | "write";

/** موارد الصلاحيات بالترتيب اللي بتتعرض بيه. أي مورد جديد في السيرفر لازم يتضاف هنا وفي النصوص (اختبار بيمسك ده). */
export const RESOURCES = ["contacts", "sales", "purchases", "inventory", "movements", "bom", "production", "operationsControl", "quality", "reports", "finance", "accounting", "hr", "portalCustomers", "portalCompanies"] as const;

export const levelOf = (perms: readonly GuidePermission[], resource: string, role: string): Level => {
  const mine = perms.filter((p) => p.resource === resource && p.roles.includes(role));
  if (mine.length === 0) return "none";
  return mine.some((p) => WRITE_ACTIONS.includes(p.action)) ? "write" : "view";
};

/** كل موارد دور معيّن (المستوى لكل مورد). */
export function roleAbilities(perms: readonly GuidePermission[], role: string): Array<{ resource: string; level: Level }> {
  return RESOURCES.map((resource) => ({ resource, level: levelOf(perms, resource, role) }));
}

/** عدد الأدوار اللي ليها كل مستوى في مورد معيّن (لصف الإجمالي في المصفوفة). */
export function resourceReach(perms: readonly GuidePermission[], roles: readonly GuideRole[], resource: string): { view: number; write: number } {
  let view = 0, write = 0;
  for (const r of roles) {
    const l = levelOf(perms, resource, r.id);
    if (l === "write") write++;
    else if (l === "view") view++;
  }
  return { view, write };
}

/** الصفحات اللي الدور بيشوفها في القايمة، متجمعة بالقسم. */
export function pagesForRole(nav: readonly GuideNavDept[], role: string): Array<{ dept: string; deptLabel: string; pages: GuideNavPage[] }> {
  return nav
    .filter((d) => d.roles.includes(role))
    .map((d) => ({ dept: d.id, deptLabel: d.label, pages: d.subFunctions.flatMap((s) => s.pages.filter((p) => p.roles.includes(role))) }))
    .filter((d) => d.pages.length > 0);
}

export interface TierView { from: string; to: string | null; steps: Array<{ sequence: number; roles: string[]; required: number }> }

/** شرائح المبلغ بـ«من» و«لحد»: كل شريحة بتنتهي عند بداية اللي بعدها. */
export function tierViews(g: GuidePolicyGroup): TierView[] {
  const sorted = [...g.tiers].sort((a, b) => Number(a.minAmount) - Number(b.minAmount));
  return sorted.map((t, i) => ({
    from: t.minAmount,
    to: sorted[i + 1]?.minAmount ?? null,
    steps: t.steps.map((s) => ({ sequence: s.sequence, roles: s.roles, required: s.requiredApprovals })),
  }));
}

/** الشريحة اللي مبلغ معيّن بيقع فيها (آخر شريحة min ≤ المبلغ). null لو مفيش سياسة. */
export function tierFor(g: GuidePolicyGroup, amount: number): TierView | null {
  const views = tierViews(g).filter((v) => Number(v.from) <= amount);
  return views.length ? (views[views.length - 1] ?? null) : null;
}

/** أيام/ساعات المهلة للعرض: 240 دقيقة = 4 ساعات. */
export const slaHours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

// ── خريطة النظام العامة: عقد وأسهم (إحداثيات SVG ثابتة) ──
export interface MapNode { id: string; x: number; y: number; dept: string | null }
export const MAP_NODES: readonly MapNode[] = [
  { id: "portal", x: 700, y: 60, dept: "customer-portal" },
  { id: "sales", x: 700, y: 190, dept: "sales" },
  { id: "approvals", x: 700, y: 320, dept: "approvals" },
  { id: "accounting", x: 440, y: 320, dept: "foundation-data" },
  { id: "warehouse", x: 440, y: 190, dept: "warehouse" },
  { id: "production", x: 180, y: 190, dept: "production" },
  { id: "purchasing", x: 180, y: 60, dept: "purchasing" },
  { id: "quality", x: 180, y: 320, dept: "quality" },
  { id: "management", x: 440, y: 60, dept: "top-management" },
  { id: "operations", x: 440, y: 440, dept: "operations" },
];
export interface MapEdge { from: string; to: string; key: string }
export const MAP_EDGES: readonly MapEdge[] = [
  { from: "portal", to: "sales", key: "order" },
  { from: "sales", to: "approvals", key: "approve" },
  { from: "sales", to: "warehouse", key: "reserve" },
  { from: "sales", to: "accounting", key: "invoice" },
  { from: "production", to: "warehouse", key: "output" },
  { from: "warehouse", to: "production", key: "materials" },
  { from: "purchasing", to: "warehouse", key: "receive" },
  { from: "quality", to: "production", key: "inspect" },
  { from: "management", to: "approvals", key: "decide" },
  { from: "accounting", to: "management", key: "reports" },
  { from: "operations", to: "production", key: "dispatch" },
];

// ── رحلة أمر البيع ──
export const ORDER_STATES = ["draft", "pending_approval", "confirmed", "shipped", "paid", "cancelled"] as const;
export type OrderState = (typeof ORDER_STATES)[number];
export const ORDER_EDGES: ReadonlyArray<{ from: OrderState; to: OrderState; key: string }> = [
  { from: "draft", to: "confirmed", key: "confirm" },
  { from: "draft", to: "pending_approval", key: "hold" },
  { from: "pending_approval", to: "confirmed", key: "approved" },
  { from: "pending_approval", to: "cancelled", key: "rejected" },
  { from: "confirmed", to: "shipped", key: "ship" },
  { from: "shipped", to: "paid", key: "pay" },
  { from: "draft", to: "cancelled", key: "cancel" },
  { from: "confirmed", to: "cancelled", key: "cancel" },
  { from: "shipped", to: "cancelled", key: "cancel" },
];
export const ORDER_POS: Record<OrderState, { x: number; y: number }> = {
  paid: { x: 90, y: 90 },
  shipped: { x: 280, y: 90 },
  confirmed: { x: 470, y: 90 },
  draft: { x: 690, y: 90 },
  pending_approval: { x: 580, y: 220 },
  cancelled: { x: 280, y: 230 },
};

/** خطوات تدفق الاعتماد (من أول الطلب لحد القرار) بترتيبها في الرسمة. */
export const APPROVAL_FLOW = ["request", "policy", "steps", "decision"] as const;

/** مقاسات عقدة الخريطة. */
export const NW = 170, NH = 58;

/** نقطة تقاطع الخط بين مركزين مع حدود المستطيل (عشان السهم يلمس الحافة مش المركز). */
export function edgeEnds(a: { x: number; y: number }, b: { x: number; y: number }, off: number) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const tt = Math.min(dx === 0 ? Infinity : NW / 2 / Math.abs(dx), dy === 0 ? Infinity : NH / 2 / Math.abs(dy)) * len;
  const px = -uy * off, py = ux * off;
  return { x1: a.x + ux * tt + px, y1: a.y + uy * tt + py, x2: b.x - ux * tt + px, y2: b.y - uy * tt + py };
}
