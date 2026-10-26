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
