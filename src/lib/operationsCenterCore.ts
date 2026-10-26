/**
 * منطق مركز قيادة التشغيل النقي (من غير قاعدة بيانات):
 * ساعات العمل، مهل الـSLA، درجة الخطر، الخطوة التالية، ومطابقة وصفة التصنيع.
 */

/** قيم افتراضية لحد ما تتحول لإعداد من الشاشة (قرار L7): السبت–الخميس، 9 ص – 5 م بتوقيت القاهرة. */
export const OPS_WORK = {
  workDays: [6, 0, 1, 2, 3, 4], // 0 = الأحد … 6 = السبت
  startHour: 9,
  endHour: 17,
} as const;

/** مهلة التصعيد (قرار Q10): 4 ساعات عمل. */
export const OPS_SLA_HOURS = 4;
/** مهلة انتظار رد المبيعات على طلب توضيح: يوم عمل كامل. */
export const OPS_CLARIFICATION_HOURS = 8;

export const ACTIVE_CASE_STATUSES = [
  "received",
  "under_validation",
  "needs_sales_clarification",
  "analysis_ready",
] as const;
export const TERMINAL_CASE_STATUSES = ["converted", "cancelled", "completed", "closed"] as const;

export const isActiveCase = (status: string) =>
  (ACTIVE_CASE_STATUSES as readonly string[]).includes(status);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const cairoFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Cairo",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** الوقت على ساعة حائط القاهرة، متمثّل كـUTC ms (للحساب بالأيام). */
export function cairoWall(date: Date): number {
  const parts: Record<string, string> = {};
  for (const p of cairoFmt.formatToParts(date)) parts[p.type] = p.value;
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
}

/** تاريخ اليوم في القاهرة بصيغة YYYY-MM-DD. */
export function cairoDateString(date: Date): string {
  return new Date(cairoWall(date)).toISOString().slice(0, 10);
}

/**
 * عدد ساعات العمل بين لحظتين (بتوقيت القاهرة). بيتجاهل الجمعة وخارج 9–17.
 * فرق التوقيت الصيفي ممكن يغيّر ساعة واحدة في يوم التبديل بس — مقبول للتنبيه.
 */
export function workingHoursBetween(from: Date, to: Date): number {
  if (!(to.getTime() > from.getTime())) return 0;
  const a = cairoWall(from);
  const b = cairoWall(to);
  if (b <= a) return 0;
  let total = 0;
  let day = Math.floor(a / DAY) * DAY;
  for (let i = 0; day <= b && i < 400; i += 1, day += DAY) {
    const dow = new Date(day).getUTCDay();
    if (!(OPS_WORK.workDays as readonly number[]).includes(dow)) continue;
    const start = Math.max(a, day + OPS_WORK.startHour * HOUR);
    const end = Math.min(b, day + OPS_WORK.endHour * HOUR);
    if (end > start) total += end - start;
  }
  return Math.round((total / HOUR) * 100) / 100;
}

export type SlaState = "ok" | "due" | "breached";
export interface SlaClock {
  kind: "intake" | "waiting_sales";
  hours: number;
  limit: number;
  state: SlaState;
}

export function classifySla(hours: number, limit: number): SlaState {
  if (hours >= limit) return "breached";
  if (hours >= limit * 0.75) return "due";
  return "ok";
}

/** العدّاد المناسب لحالة الحالة: استقبال/تحقق من وقت الاستقبال، وانتظار المبيعات من وقت الطلب. */
export function slaClock(
  input: { status: string; createdAt: Date; updatedAt: Date },
  now: Date,
): SlaClock | null {
  if (input.status === "received" || input.status === "under_validation") {
    const hours = workingHoursBetween(input.createdAt, now);
    return { kind: "intake", hours, limit: OPS_SLA_HOURS, state: classifySla(hours, OPS_SLA_HOURS) };
  }
  if (input.status === "needs_sales_clarification") {
    const hours = workingHoursBetween(input.updatedAt, now);
    return {
      kind: "waiting_sales",
      hours,
      limit: OPS_CLARIFICATION_HOURS,
      state: classifySla(hours, OPS_CLARIFICATION_HOURS),
    };
  }
  return null;
}

export type RiskLevel = "low" | "medium" | "high";
export type RiskReason =
  | "overdue"
  | "due_soon"
  | "sla_breached"
  | "sla_due"
  | "waiting_sales"
  | "urgent_unassigned";

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY);
}

export interface RiskInput {
  status: string;
  priority: string;
  dueDate: string | null;
  assignedTo: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export function caseRisk(input: RiskInput, now: Date): { level: RiskLevel; reasons: RiskReason[]; sla: SlaClock | null } {
  const reasons: RiskReason[] = [];
  let level: RiskLevel = "low";
  const bump = (to: RiskLevel) => {
    if (RISK_RANK[to] > RISK_RANK[level]) level = to;
  };
  if (!isActiveCase(input.status)) return { level, reasons, sla: null };

  if (input.dueDate) {
    const left = daysBetween(cairoDateString(now), input.dueDate);
    if (left < 0) {
      reasons.push("overdue");
      bump("high");
    } else if (left <= 2) {
      reasons.push("due_soon");
      bump("medium");
    }
  }
  const sla = slaClock(input, now);
  if (sla?.state === "breached") {
    reasons.push(sla.kind === "waiting_sales" ? "waiting_sales" : "sla_breached");
    bump("high");
  } else if (sla?.state === "due") {
    reasons.push("sla_due");
    bump("medium");
  }
  if (input.priority === "urgent" && input.assignedTo === null) {
    reasons.push("urgent_unassigned");
    bump("medium");
  }
  return { level, reasons, sla };
}

export type NextAction =
  | "start_validation"
  | "complete_validation"
  | "resume_validation"
  | "convert"
  | "track_orders"
  | "none";

/** الخطوة اللي المدير المفروض يعملها دلوقتي، عشان الواجهة تبرز زر واحد واضح. */
export function nextActionFor(status: string, hasWorkflowOrder: boolean): NextAction {
  switch (status) {
    case "received":
      return "start_validation";
    case "under_validation":
      return "complete_validation";
    case "needs_sales_clarification":
      return "resume_validation";
    case "analysis_ready":
      return hasWorkflowOrder ? "track_orders" : "convert";
    case "converted":
      return "track_orders";
    default:
      return "none";
  }
}

/** تطبيع عربي للمقارنة: تشكيل، همزات، ياء/ألف مقصورة، تاء مربوطة، مسافات. */
export function normalizeProductName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

export interface RecipeRef {
  id: number;
  productName: string;
}
export type RecipeMatch =
  | { recipeId: number; reason: "matched" }
  | { recipeId: null; reason: "none" | "ambiguous" };

/** وصفة واحدة بالظبط بنفس الاسم (بعد التطبيع) = مطابقة. صفر أو أكتر من واحدة = مرفوض بسبب واضح. */
export function matchRecipe(productName: string, recipes: readonly RecipeRef[]): RecipeMatch {
  const key = normalizeProductName(productName);
  if (!key) return { recipeId: null, reason: "none" };
  const hits = recipes.filter((r) => normalizeProductName(r.productName) === key);
  const only = hits[0];
  if (hits.length === 1 && only) return { recipeId: only.id, reason: "matched" };
  return { recipeId: null, reason: hits.length === 0 ? "none" : "ambiguous" };
}

export interface ConversionLine {
  id: number;
  productNameSnapshot: string;
}
export interface ConversionPlan {
  resolved: Array<{ lineId: number; recipeId: number }>;
  unresolved: Array<{ lineId: number; productName: string; reason: "none" | "ambiguous" }>;
}

export function planConversion(lines: readonly ConversionLine[], recipes: readonly RecipeRef[]): ConversionPlan {
  const plan: ConversionPlan = { resolved: [], unresolved: [] };
  for (const line of lines) {
    const m = matchRecipe(line.productNameSnapshot, recipes);
    if (m.recipeId !== null) plan.resolved.push({ lineId: line.id, recipeId: m.recipeId });
    else plan.unresolved.push({ lineId: line.id, productName: line.productNameSnapshot, reason: m.reason });
  }
  return plan;
}

/** أدوار تحويل الحالة لأمر إنتاج: التشغيل والإدارة بس (مش أدوار الإنتاج). */
export const OPS_CONVERT_ROLES = ["operations_manager", "executive_manager", "chairman"] as const;

/** أدوار يتم إبلاغها لما المدير التشغيلي يطلب توضيح. */
export const SALES_NOTIFY_ROLES = ["sales_manager", "online_seller", "offline_seller"] as const;

export const TRANSFER_DIRECTIONS = [
  "warehouse_to_operations",
  "operations_to_production",
  "production_to_operations",
  "operations_to_warehouse",
] as const;
export type TransferDirection = (typeof TRANSFER_DIRECTIONS)[number];

const OPS = ["operations_manager", "executive_manager", "chairman"] as const;

/** مين يبدأ كل اتجاه ومين يستلمه (مصدر واحد للسيرفر، والويب بيعكسه). */
export const TRANSFER_CREATORS: Record<TransferDirection, readonly string[]> = {
  warehouse_to_operations: ["warehouse_manager", ...OPS],
  operations_to_production: [...OPS],
  production_to_operations: ["production_manager", "supervisor", ...OPS],
  operations_to_warehouse: [...OPS],
};
export const TRANSFER_RECEIVERS: Record<TransferDirection, readonly string[]> = {
  warehouse_to_operations: [...OPS],
  operations_to_production: ["production_manager", "supervisor"],
  production_to_operations: [...OPS],
  operations_to_warehouse: ["warehouse_manager"],
};

/**
 * أثر المخزون عند استلام التحويل: الخامة بتخرج من رصيد المخزن مرة واحدة بس (من المخزن للتشغيل)،
 * ولما ترجع للمخزن بتدخل. التنقل بين التشغيل والإنتاج عهدة بس، من غير حركة مخزون
 * (قبل كده كان بيخصم تاني عند «من التشغيل للإنتاج» فالخامة كانت بتتخصم مرتين).
 */
export function stockEffectOf(direction: string): "out" | "in" | null {
  if (direction === "warehouse_to_operations") return "out";
  if (direction === "operations_to_warehouse") return "in";
  return null;
}

/**
 * مستويات اعتماد خطة التشغيل حسب قيمة عجز الخامات (بالجنيه):
 * 0 تلقائي لحد 10 آلاف، 1 مدير تنفيذي أو رئيس لحد 50 ألف، 2 رئيس المجلس لحد 200 ألف،
 * 3 رئيس المجلس بسبب مكتوب فوق 200 ألف. القيم ثابتة هنا لحد ما تبقى إعداد من الشاشة.
 */
export const PLAN_LEVEL_LIMITS = { auto: 10_000, level1: 50_000, level2: 200_000 } as const;
export type PlanLevel = 0 | 1 | 2 | 3;

export function approvalLevelFor(value: number): PlanLevel {
  if (!Number.isFinite(value) || value <= PLAN_LEVEL_LIMITS.auto) return 0;
  if (value <= PLAN_LEVEL_LIMITS.level1) return 1;
  if (value <= PLAN_LEVEL_LIMITS.level2) return 2;
  return 3;
}

export const PLAN_LEVEL_ROLES: Record<PlanLevel, readonly string[]> = {
  0: ["operations_manager", "executive_manager", "chairman"],
  1: ["executive_manager", "chairman"],
  2: ["chairman"],
  3: ["chairman"],
};

/** قيمة العجز: مجموع (كمية العجز × سعر الوحدة) للخامات اللي لازم تتشترى، مقرّبة لقرشين. */
export function planShortageValue(rows: ReadonlyArray<{ shortageQty: string; unitPrice: string | null }>): number {
  let total = 0;
  for (const r of rows) {
    const q = Number(r.shortageQty);
    const p = Number(r.unitPrice ?? 0);
    if (q > 0 && p > 0) total += q * p;
  }
  return Math.round(total * 100) / 100;
}

export interface PlanDecisionInput {
  role: string;
  userId: number;
  level: PlanLevel;
  submittedBy: number | null;
  note: string;
}
export type PlanDecisionCheck = { ok: true } | { ok: false; code: "ROLE_NOT_ALLOWED" | "SELF_APPROVAL" | "NOTE_REQUIRED" };

/** مين يقدر يعتمد: الدور المناسب للمستوى، مش نفس اللي رفعها (من المستوى 1)، وسبب مكتوب في المستوى 3. */
export function checkPlanDecision(i: PlanDecisionInput): PlanDecisionCheck {
  if (!PLAN_LEVEL_ROLES[i.level].includes(i.role)) return { ok: false, code: "ROLE_NOT_ALLOWED" };
  if (i.level >= 1 && i.submittedBy !== null && i.submittedBy === i.userId) return { ok: false, code: "SELF_APPROVAL" };
  if (i.level === 3 && i.note.trim().length < 3) return { ok: false, code: "NOTE_REQUIRED" };
  return { ok: true };
}

/** الجزء المتاح من كل خامة في الخطة (المطلوب − العجز) متجمّع بالصنف: ده اللي بيتحجز عند الاعتماد. */
export function planReservationWants(
  plan: ReadonlyArray<{ requirements?: ReadonlyArray<{ inventoryItemId: number | null; requiredQty: string; shortageQty: string }> }>,
): Array<{ inventoryItemId: number; qty: number }> {
  const byItem = new Map<number, number>();
  for (const line of plan) {
    for (const r of line.requirements ?? []) {
      if (r.inventoryItemId === null) continue;
      const have = Number(r.requiredQty) - Number(r.shortageQty);
      if (have > 0) byItem.set(r.inventoryItemId, Math.round(((byItem.get(r.inventoryItemId) ?? 0) + have) * 1000) / 1000);
    }
  }
  return [...byItem.entries()].map(([inventoryItemId, qty]) => ({ inventoryItemId, qty }));
}

/** صرف كمية من الحجوزات النشطة بالترتيب (الأقدم أول) من غير ما يتعدّى المتبقي في كل حجز. */
export function allocateConsumption(
  reservations: ReadonlyArray<{ id: number; remaining: number }>,
  qty: number,
): Array<{ id: number; take: number }> {
  const out: Array<{ id: number; take: number }> = [];
  let left = qty;
  for (const r of reservations) {
    if (left <= 0) break;
    const take = Math.min(r.remaining, left);
    if (take > 0) {
      out.push({ id: r.id, take: Math.round(take * 1000) / 1000 });
      left = Math.round((left - take) * 1000) / 1000;
    }
  }
  return out;
}

/**
 * تكلفة الخامة اللي بتتسجل تلقائي على أمر الإنتاج لما التحويل يتستلم:
 * خروج من المخزن للتشغيل = تكلفة موجبة، ورجوع للمخزن = تكلفة سالبة (بتقلّل الإجمالي). الباقي عهدة بدون تكلفة.
 */
export function transferCostAmount(direction: string, qty: string | number, unitPrice: string | number | null): number | null {
  const sign = direction === "warehouse_to_operations" ? 1 : direction === "operations_to_warehouse" ? -1 : 0;
  const q = Number(qty);
  const p = Number(unitPrice ?? 0);
  if (!sign || !(q > 0) || !(p > 0)) return null;
  return Math.round(sign * q * p * 100) / 100;
}
