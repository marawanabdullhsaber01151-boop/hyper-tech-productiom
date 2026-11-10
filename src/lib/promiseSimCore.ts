/** @format */
/**
 * وعد التسليم بنسبة ثقة (الخطوة 44أ): محاكاة مونت كارلو فوق محرك الجدولة بمراكز العمل.
 *
 *  - كل أمر (في الطابور والطلب الجديد) مدته بتتغيّر عشوائيًا بمعامل مثلثي: أقل 1 − ت/2، الأرجح 1، أعلى 1 + 1.5×ت (ت = نسبة التذبذب، 20% افتراضي
 *    يعني 0.9 … 1.3 وده نفس نطاق الوعد القديم). الميل لفوق عن قصد: التأخير أشيع من التبكير.
 *  - بنعمل N تشغيلة، وتاريخ كل تشغيلة = آخر سطر من الطلب الجديد يخلص.
 *  - بنقرا من التواريخ المرتبة: P10 (أقرب)، P50 (أرجح)، نسبة الثقة المختارة (الوعد)، P95 (أبعد).
 *  - البذرة ثابتة (رقم الحالة + اليوم + حجم الطابور) فنفس البيانات بتدّي نفس الأرقام: الشاشة ما بتتنطّطش مع كل تحديث.
 */
import { buildCenterSchedule, hasUsableRouting, type CenterInput, type OrderInput } from "./capacityCentersCore";
import type { WorkCalendar } from "./operationsCapacityCore";

export const SIM_RUNS = 300;
export const FAR = "9999-12-31";

/** مولّد أرقام عشوائية بذرة (mulberry32): نفس البذرة = نفس السلسلة. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** توزيع مثلثي من رقم u بين 0 و1. */
export function triangular(u: number, min: number, mode: number, max: number): number {
  if (max <= min) return mode;
  const f = (mode - min) / (max - min);
  return u < f ? min + Math.sqrt(u * (max - min) * (mode - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

/** معامل المدة: 1 − ت/2 … 1 … 1 + 1.5×ت. */
export function durationFactor(u: number, variability: number): number {
  const v = Math.max(0, variability);
  return triangular(u, 1 - v / 2, 1, 1 + 1.5 * v);
}

/** النسبة p (0–1) من تواريخ مرتبة تصاعديًا: أقل تاريخ بيغطي p من التشغيلات. */
export function percentileDate(sorted: readonly string[], p: number): string {
  if (sorted.length === 0) return FAR;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] as string;
}

export interface SimPromise {
  earliest: string; // P10
  likely: string; // P50
  confidenceDate: string; // نسبة الثقة المختارة: ده تاريخ الوعد
  latest: string; // P95
  confidence: number; // 0–1
  runs: number;
  verdict: "ok" | "tight" | "late" | "none";
}

/** مجموع بسيط يتحوّل لبذرة. */
export function seedOf(parts: readonly (number | string)[]): number {
  let h = 2166136261;
  for (const c of parts.join("|")) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h >>> 0;
}

/**
 * بيرجّع null لو أي سطر من غير مسار صالح (المنادي يرجع لحساب مدة الوصفة).
 * ت = 0 معناها تشغيلة واحدة بدون تذبذب (الوعد حتمي).
 */
export function simulatePromise(input: {
  queue: readonly OrderInput[];
  centers: readonly CenterInput[];
  lines: readonly { qty: number; routing: unknown }[];
  dueDate: string | null;
  startIso: string;
  cap?: number;
  calendar?: WorkCalendar;
  variability: number; // 0–1
  confidence: number; // 0.5–0.99
  runs?: number;
  seed: number;
}): SimPromise | null {
  const ids = new Set(input.centers.filter((c) => c.dailyMinutes > 0).map((c) => c.id));
  if (input.lines.length === 0 || input.lines.some((l) => !hasUsableRouting(l.routing, l.qty, ids))) return null;
  const runs = input.variability <= 0 ? 1 : Math.max(1, input.runs ?? SIM_RUNS);
  const rnd = mulberry32(input.seed);
  const base = Number.MAX_SAFE_INTEGER - input.lines.length;
  const finishes: string[] = [];
  for (let r = 0; r < runs; r += 1) {
    const queue = input.queue.map((o): OrderInput => ({ ...o, scale: input.variability <= 0 ? 1 : durationFactor(rnd(), input.variability) }));
    const mine = input.lines.map((l, i): OrderInput => ({
      id: base + i + 1,
      scale: input.variability <= 0 ? 1 : durationFactor(rnd(), input.variability),
      orderNumber: "new",
      productName: "new",
      neededBy: null,
      qty: l.qty,
      status: "released",
      routing: l.routing,
    }));
    const s = buildCenterSchedule({ orders: [...queue, ...mine], centers: input.centers, startIso: input.startIso, cap: input.cap, calendar: input.calendar, shownDays: 1 });
    const dates = s.orders.filter((o) => o.id > base).map((o) => o.finish ?? FAR);
    finishes.push(dates.sort()[dates.length - 1] ?? FAR);
  }
  finishes.sort();
  const likely = percentileDate(finishes, 0.5);
  const confidenceDate = percentileDate(finishes, input.confidence);
  let verdict: SimPromise["verdict"] = "none";
  if (input.dueDate) verdict = confidenceDate <= input.dueDate ? "ok" : likely <= input.dueDate ? "tight" : "late";
  return { earliest: percentileDate(finishes, 0.1), likely, confidenceDate, latest: percentileDate(finishes, 0.95), confidence: input.confidence, runs, verdict };
}
