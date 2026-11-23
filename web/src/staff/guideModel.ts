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
  // شبكة 3 أعمدة × 4 صفوف: كل سهم بين خليتين متجاورتين، فمفيش خط بيعدّي فوق مربع.
  { id: "operations", x: 180, y: 60, dept: "operations" },
  { id: "purchasing", x: 440, y: 60, dept: "purchasing" },
  { id: "portal", x: 700, y: 60, dept: "customer-portal" },
  { id: "production", x: 180, y: 190, dept: "production" },
  { id: "warehouse", x: 440, y: 190, dept: "warehouse" },
  { id: "sales", x: 700, y: 190, dept: "sales" },
  { id: "quality", x: 180, y: 320, dept: "quality" },
  { id: "approvals", x: 440, y: 320, dept: "approvals" },
  { id: "accounting", x: 700, y: 320, dept: "foundation-data" },
  { id: "management", x: 440, y: 450, dept: "top-management" },
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
/** مقاس مربع حالة الأمر في الرسمة. */
export const ORDER_W = 130, ORDER_H = 50;
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
  shipped: { x: 300, y: 90 },
  confirmed: { x: 510, y: 90 },
  draft: { x: 730, y: 90 },
  pending_approval: { x: 620, y: 220 },
  cancelled: { x: 300, y: 230 },
};

/** خطوات تدفق الاعتماد (من أول الطلب لحد القرار) بترتيبها في الرسمة. */
export const APPROVAL_FLOW = ["request", "policy", "steps", "decision"] as const;

/** مقاسات عقدة الخريطة. */
export const NW = 170, NH = 58;

/**
 * هندسة سهم بين مركزين: بداية ونهاية على حافة المستطيل (مش المركز) + مكان الاسم.
 * off ≠ 0 لما في سهمين عكس بعض (بيتزحزحوا على الجانبين واسميهما بيتباعدوا).
 */
export function edgeGeom(a: { x: number; y: number }, b: { x: number; y: number }, w: number, h: number, off = 0) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const tt = Math.min(dx === 0 ? Infinity : w / 2 / Math.abs(dx), dy === 0 ? Infinity : h / 2 / Math.abs(dy)) * len;
  const px = -uy * off, py = ux * off;
  const x1 = a.x + ux * tt + px, y1 = a.y + uy * tt + py, x2 = b.x - ux * tt + px, y2 = b.y - uy * tt + py;
  return { x1, y1, x2, y2, lx: (x1 + x2) / 2 - uy * off * 1.2, ly: (y1 + y2) / 2 + ux * off * 1.2 - 5 };
}
/** توافق مع النداءات القديمة. */
export const edgeEnds = (a: { x: number; y: number }, b: { x: number; y: number }, off: number) => edgeGeom(a, b, NW, NH, off);

/** هل القطعة (x1,y1)-(x2,y2) بتعدّي جوه مستطيل مركزه c (مع هامش pad)؟ (Liang–Barsky) */
export function segmentHitsBox(x1: number, y1: number, x2: number, y2: number, c: { x: number; y: number }, w: number, h: number, pad = 0): boolean {
  const xmin = c.x - w / 2 - pad, xmax = c.x + w / 2 + pad, ymin = c.y - h / 2 - pad, ymax = c.y + h / 2 + pad;
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, x1 - xmin) && clip(dx, xmax - x1) && clip(-dy, y1 - ymin) && clip(dy, ymax - y1);
}

// ── المرحلة 2: خرائط العمليات (خطوات على شبكة + أسهم). النصوص كلها في copy/guide2.ts بمفاتيح guide.fl.<flow>.* ──
export const FLOW_IDS = ["preq", "porder", "po", "portal"] as const;
export type FlowId = (typeof FLOW_IDS)[number];
export interface FlowStep { id: string; col: number; row: number }
export interface FlowEdge { from: string; to: string; key: string }
export interface FlowDef { steps: readonly FlowStep[]; edges: readonly FlowEdge[] }

export const FLOWS: Record<FlowId, FlowDef> = {
  // طلب خامات للإنتاج: مشرف ← مخزن ← إدارة الإنتاج ← يتحوّل لدورة إنتاج
  preq: {
    steps: [
      { id: "create", col: 0, row: 0 }, { id: "warehouse", col: 1, row: 0 }, { id: "director", col: 2, row: 0 }, { id: "approved", col: 3, row: 0 },
      { id: "cancelled", col: 0, row: 1 }, { id: "rejected", col: 2, row: 1 },
    ],
    edges: [
      { from: "create", to: "warehouse", key: "send" }, { from: "warehouse", to: "director", key: "wh_ok" }, { from: "director", to: "approved", key: "dir_ok" },
      { from: "warehouse", to: "rejected", key: "wh_no" }, { from: "director", to: "rejected", key: "dir_no" }, { from: "create", to: "cancelled", key: "cancel" },
    ],
  },
  // أمر الإنتاج من أول التسلّم لحد التسليم
  porder: {
    steps: [
      { id: "intake", col: 0, row: 0 }, { id: "materials", col: 1, row: 0 }, { id: "making", col: 2, row: 0 }, { id: "quality", col: 3, row: 0 },
      { id: "done", col: 3, row: 1 }, { id: "delivery", col: 2, row: 1 }, { id: "rework", col: 1, row: 1 }, { id: "cancelled", col: 0, row: 1 },
    ],
    edges: [
      { from: "intake", to: "materials", key: "claim" }, { from: "materials", to: "making", key: "mat_ok" }, { from: "making", to: "quality", key: "finish" },
      { from: "quality", to: "done", key: "pass" }, { from: "done", to: "delivery", key: "deliver" }, { from: "quality", to: "rework", key: "fail" },
      { from: "rework", to: "making", key: "redo" }, { from: "intake", to: "cancelled", key: "cancel" },
    ],
  },
  // أمر الشراء ثم الاستلام ثم فحص الخامات ثم دخول المخزون
  po: {
    steps: [
      { id: "draft", col: 0, row: 0 }, { id: "approval", col: 1, row: 0 }, { id: "approved", col: 2, row: 0 }, { id: "sent", col: 3, row: 0 },
      { id: "cancelled", col: 0, row: 1 }, { id: "receive", col: 3, row: 1 }, { id: "inspect", col: 2, row: 1 }, { id: "stock", col: 1, row: 1 },
    ],
    edges: [
      { from: "draft", to: "approval", key: "submit" }, { from: "approval", to: "approved", key: "approve" }, { from: "approval", to: "draft", key: "back" },
      { from: "approved", to: "sent", key: "send" }, { from: "sent", to: "receive", key: "arrive" }, { from: "receive", to: "inspect", key: "inspect" },
      { from: "inspect", to: "stock", key: "accept" }, { from: "draft", to: "cancelled", key: "cancel" },
    ],
  },
  // بوابة العملاء: من الانضمام لحد الاستلام
  portal: {
    steps: [
      { id: "apply", col: 0, row: 0 }, { id: "account", col: 1, row: 0 }, { id: "order", col: 2, row: 0 }, { id: "review", col: 3, row: 0 },
      { id: "activation", col: 0, row: 1 }, { id: "quote", col: 2, row: 1 }, { id: "progress", col: 3, row: 1 },
    ],
    edges: [
      { from: "apply", to: "account", key: "approve" }, { from: "activation", to: "account", key: "activate" }, { from: "account", to: "order", key: "login" },
      { from: "order", to: "review", key: "send" }, { from: "quote", to: "order", key: "accept" }, { from: "review", to: "progress", key: "confirm" },
    ],
  },
};

export const FLOW_STEP_W = 150, FLOW_STEP_H = 54, FLOW_GAP_X = 230, FLOW_GAP_Y = 120, FLOW_PAD = 40;
/** مركز الخطوة بالـSVG: أول عمود على اليمين (الاتجاه عربي). */
export function flowPos(step: FlowStep, cols = 4): { x: number; y: number } {
  return { x: FLOW_PAD + FLOW_STEP_W / 2 + (cols - 1 - step.col) * FLOW_GAP_X, y: FLOW_PAD + FLOW_STEP_H / 2 + step.row * FLOW_GAP_Y };
}
export const flowViewBox = (f: FlowDef): { w: number; h: number } => {
  const cols = Math.max(...f.steps.map((s) => s.col)) + 1, rows = Math.max(...f.steps.map((s) => s.row)) + 1;
  return { w: FLOW_PAD * 2 + FLOW_STEP_W + (cols - 1) * FLOW_GAP_X, h: FLOW_PAD * 2 + FLOW_STEP_H + (rows - 1) * FLOW_GAP_Y };
};

/** مواضيع فصل الحسابات (نصوص guide.acc.<id>.t/.d) وجدول «الحدث ← القيد التلقائي». */
export const ACC_TOPICS = ["entry", "reversal", "accounts", "trial", "periods", "auto", "collections", "transfers", "balances", "aging", "credit"] as const;
export const AUTO_RULES = ["sale", "unsale", "receipt", "payment", "advance"] as const;

/** عرض تقريبي (بكسل) لحرف عربي في اسم السهم (خط 12px). */
export const EDGE_CHAR_PX = 6.6;
export const edgeTextWidth = (s: string): number => s.length * EDGE_CHAR_PX;
/**
 * بيقسّم اسم السهم على أكتر من سطر (بالكلمات) عشان يتّسع في الفراغ بين مربعين بدل ما يتقصّ تحت المربعات.
 * كلمة أطول من العرض بتفضل لوحدها في سطر (والاختبار بيضمن إن ده مبيحصلش في الرسمات الفعلية).
 */
export function wrapEdgeLabel(text: string, maxPx: number, charPx = EDGE_CHAR_PX): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && next.length * charPx > maxPx) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}
/** أقصى عرض متاح لاسم السهم: طول السهم الأفقي تقريبًا (السهم الرأسي الاسم جنبه فاضي). */
export function edgeLabelRoom(g: { x1: number; y1: number; x2: number; y2: number }): number {
  const dx = Math.abs(g.x2 - g.x1), dy = Math.abs(g.y2 - g.y1);
  return dy > dx * 1.5 ? 140 : Math.max(46, Math.hypot(dx, dy) - 10);
}
/** اسم المربع (خط 15px عريض ≈ 8px للحرف): بيتقسّم لسطرين لو أعرض من المربع. */
export const NODE_CHAR_PX = 8;
export const nodeLabelLines = (text: string, w: number): string[] => wrapEdgeLabel(text, w - 16, NODE_CHAR_PX);
