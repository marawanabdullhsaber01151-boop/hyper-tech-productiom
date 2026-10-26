/**
 * السعة ووعد التسليم (م4): منطق نقي من غير قاعدة بيانات.
 *
 * النموذج (تقديري بشكل معلن، لحد ما يبقى فيه مسارات تصنيع بدقائق لكل منتج):
 *  - طاقة المصنع = عدد خطوط الإنتاج النشطة × أيام العمل (السبت–الخميس) × سقف التحميل 85%.
 *  - طلب كل أمر مفتوح = مدته التقديرية (مدة الوصفة وعامل الكمية، زي اقتراح تاريخ البوابة) × المتبقي منه حسب مرحلته.
 *  - الأوامر بتتجدول بالترتيب الأقرب موعدًا أول، وكل يوم عمل بيستوعب (خطوط × 85%) يوم-خط.
 *  - وعد التسليم نطاق: الأقرب (×0.9) والأرجح (×1.0) والأبعد (×1.3) على الطابور + مدة الطلب الجديد.
 */
import { computeBaseDurationDays } from "./dueDateSuggestion.core";
import { OPS_WORK, cairoDateString } from "./operationsCenterCore";

export const CAPACITY_CAP = 0.85;
export const FORECAST_DAYS = 14;
export const PROMISE_FACTORS = { earliest: 0.9, likely: 1, latest: 1.3 } as const;

/** الجزء المتبقي من شغل الأمر حسب مرحلته (الباقي غير مدرج = 1 يعني كله لسه). */
export const STAGE_REMAINING: Record<string, number> = {
  in_production: 0.5,
  rework: 0.4,
  held: 0.5,
  partially_completed: 0.3,
  quality_check: 0.1,
  completed: 0,
  delivery_pending_customer: 0,
  delivery_pending_warehouse: 0,
  delivered_customer: 0,
  delivered_warehouse: 0,
  cancelled: 0,
  closed: 0,
  corrected: 0,
};
export const remainingFraction = (status: string): number => STAGE_REMAINING[status] ?? 1;

export interface DemandInput {
  expectedProductionDays: number | null;
  qty: number;
  outputQty: number;
  status: string;
}
export function orderDemandDays(i: DemandInput): number {
  const days = computeBaseDurationDays({ expectedProductionDays: i.expectedProductionDays, qty: i.qty, outputQty: i.outputQty });
  return Math.round(days * remainingFraction(i.status) * 100) / 100;
}

const DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const isWorkDay = (dateIso: string) => (OPS_WORK.workDays as readonly number[]).includes(new Date(parse(dateIso)).getUTCDay());

/** أول `count` يوم عمل بدءًا من تاريخ (شامل لو هو يوم عمل). */
export function workDaysFrom(startIso: string, count: number): string[] {
  const out: string[] = [];
  for (let ms = parse(startIso), guard = 0; out.length < count && guard < 800; ms += DAY, guard += 1) {
    const d = iso(ms);
    if (isWorkDay(d)) out.push(d);
  }
  return out;
}

export interface ScheduledDemand {
  days: number;
  neededBy: string | null;
}
export interface DayLoad {
  date: string;
  load: number; // 0..1 من سقف اليوم (ممكن يعدّي 1 = زيادة)
  used: number;
  capacity: number;
}
export interface Forecast {
  days: DayLoad[];
  queueDays: number;
  utilization: number; // إجمالي الطلب جوه الأفق ÷ إجمالي الطاقة جوه الأفق
  overloadedDays: number;
  freeDays: number; // يوم-خط فاضي جوه الأفق
  lateOrders: number; // أوامر هتخلص بعد موعدها
}

/** جدولة الطلب على أيام العمل بالأقرب موعدًا أول، وحساب الحمل لكل يوم. */
export function buildForecast(input: { demands: readonly ScheduledDemand[]; lines: number; startIso: string; horizon?: number }): Forecast {
  const horizon = input.horizon ?? FORECAST_DAYS;
  const lines = Math.max(1, input.lines);
  const perDay = lines * CAPACITY_CAP;
  const dates = workDaysFrom(input.startIso, horizon);
  const used = new Array<number>(dates.length).fill(0);
  const sorted = [...input.demands].filter((d) => d.days > 0).sort((a, b) => (a.neededBy ?? "9999-12-31").localeCompare(b.neededBy ?? "9999-12-31"));
  let cursor = 0;
  let late = 0;
  let spill = 0;
  for (const d of sorted) {
    let left = d.days;
    let lastIdx = cursor;
    while (left > 1e-9) {
      if (cursor >= dates.length) {
        spill += left;
        lastIdx = dates.length;
        break;
      }
      const room = perDay - (used[cursor] ?? 0);
      if (room <= 1e-9) {
        cursor += 1;
        continue;
      }
      const take = Math.min(room, left);
      used[cursor] = (used[cursor] ?? 0) + take;
      left -= take;
      lastIdx = cursor;
    }
    const finish = dates[Math.min(lastIdx, dates.length - 1)];
    if (d.neededBy && finish && (lastIdx >= dates.length || finish > d.neededBy)) late += 1;
  }
  const queueDays = Math.round((used.reduce((s, x) => s + x, 0) + spill) * 100) / 100;
  const total = perDay * dates.length;
  const days = dates.map((date, i) => ({ date, used: Math.round((used[i] ?? 0) * 100) / 100, capacity: Math.round(perDay * 100) / 100, load: Math.round(((used[i] ?? 0) / perDay) * 1000) / 1000 }));
  return {
    days,
    queueDays,
    utilization: total > 0 ? Math.round(Math.min(2, (queueDays) / total) * 1000) / 1000 : 0,
    overloadedDays: days.filter((x) => x.load >= 0.999).length,
    freeDays: Math.round(Math.max(0, total - queueDays) * 100) / 100,
    lateOrders: late,
  };
}

export type PromiseVerdict = "ok" | "tight" | "late" | "none";
export interface DeliveryPromise {
  earliest: string;
  likely: string;
  latest: string;
  verdict: PromiseVerdict;
  neededDays: number;
}

/** وعد التسليم لطلب جديد بمدة `newDays` فوق طابور `queueDays`، ومقارنته بالموعد المطلوب. */
export function deliveryPromise(input: { queueDays: number; newDays: number; lines: number; startIso: string; dueDate: string | null }): DeliveryPromise {
  const perDay = Math.max(1, input.lines) * CAPACITY_CAP;
  const finish = (factor: number) => {
    const workDays = Math.max(1, Math.ceil(((input.queueDays + input.newDays) * factor) / perDay));
    const dates = workDaysFrom(input.startIso, workDays);
    return dates[dates.length - 1] ?? input.startIso;
  };
  const earliest = finish(PROMISE_FACTORS.earliest);
  const likely = finish(PROMISE_FACTORS.likely);
  const latest = finish(PROMISE_FACTORS.latest);
  let verdict: PromiseVerdict = "none";
  if (input.dueDate) verdict = latest <= input.dueDate ? "ok" : likely <= input.dueDate ? "tight" : "late";
  return { earliest, likely, latest, verdict, neededDays: Math.round(input.newDays * 100) / 100 };
}

export const todayCairo = (now: Date) => cairoDateString(now);
