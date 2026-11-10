/** @format */
/**
 * السعة المحدودة بمراكز العمل (الخطوة 43): جدولة أمامية بالدقايق من غير قاعدة بيانات.
 *
 *  - كل أمر بيشيل «لقطة المسار» وقت إنشائه: عمليات (رقم، مركز عمل، تجهيز بالدقايق، تشغيل بالدقيقة للوحدة).
 *  - دقايق العملية = (تجهيز + تشغيل × الكمية) × الجزء المتبقي من الأمر حسب مرحلته.
 *  - سعة المركز في اليوم = سعة الوردية × عدد الورديات النشطة × سقف التحميل (85%).
 *  - الأوامر بتتجدول بالأقرب موعدًا أول، وكل عملية بتبدأ من اليوم اللي خلصت فيه اللي قبلها، وبتتوزع على أيام العمل.
 *  - الأمر اللي من غير مسار أو من غير مركز معرّف ما بيتحسبش (وبيتعدّ عشان يتعرض بصراحة).
 */
import { CAPACITY_CAP, remainingFraction, workDaysFrom, type WorkCalendar } from "./operationsCapacityCore";

export const HEATMAP_DAYS = 14;
export const SCHEDULE_HORIZON_DAYS = 60;

export interface RoutingOp {
  operationNo: number;
  workCenterId: number | null;
  setupMinutes: number;
  runMinutesPerUnit: number;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** قراءة لقطة المسار بأي شكل (camel أو snake)، مرتّبة برقم العملية. */
export function parseRouting(raw: unknown): RoutingOp[] {
  if (!Array.isArray(raw)) return [];
  const ops: RoutingOp[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object") continue;
    const wc = num(item.workCenterId ?? item.work_center_id);
    ops.push({
      operationNo: num(item.operationNo ?? item.operation_no),
      workCenterId: wc > 0 ? wc : null,
      setupMinutes: Math.max(0, num(item.setupMinutes ?? item.setup_minutes)),
      runMinutesPerUnit: Math.max(0, num(item.runMinutesPerUnit ?? item.run_minutes_per_unit)),
    });
  }
  return ops.sort((a, b) => a.operationNo - b.operationNo);
}

export function opMinutes(op: RoutingOp, qty: number): number {
  return Math.round((op.setupMinutes + op.runMinutesPerUnit * Math.max(0, qty)) * 100) / 100;
}

/** سعة المركز في اليوم (قبل سقف التحميل): سعة الوردية × عدد الورديات النشطة (وردية واحدة على الأقل). */
export function centerDailyMinutes(capacityMinutesPerShift: number, activeShifts: number): number {
  return Math.max(0, capacityMinutesPerShift) * Math.max(1, activeShifts);
}

export interface CenterInput {
  id: number;
  code: string;
  name: string;
  dailyMinutes: number;
}
export interface OrderInput {
  id: number;
  /** مضروب في الدقايق (للوعد: 0.9 أقرب، 1 أرجح، 1.3 أبعد) */
  scale?: number;
  orderNumber: string;
  productName: string;
  neededBy: string | null;
  qty: number;
  status: string;
  routing: unknown;
}
export interface CenterDay {
  date: string;
  used: number;
  capacity: number;
  load: number;
}
export interface CenterRow {
  id: number;
  code: string;
  name: string;
  days: CenterDay[];
  utilization: number;
}
export interface OrderResult {
  id: number;
  orderNumber: string;
  productName: string;
  neededBy: string | null;
  /** تاريخ الانتهاء المتوقع، أو null لو بعد أفق الجدولة */
  finish: string | null;
  late: boolean;
  /** أيام التأخير بالتقويم لما نعرف التاريخين، وإلا null */
  lateDays: number | null;
}
export interface CenterSchedule {
  centers: CenterRow[];
  orders: OrderResult[];
  scheduledOrders: number;
  noRoutingOrders: number;
  unassignedOps: number;
}

const EPS = 1e-9;
const DAY = 86_400_000;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildCenterSchedule(input: {
  orders: readonly OrderInput[];
  centers: readonly CenterInput[];
  startIso: string;
  shownDays?: number;
  horizon?: number;
  cap?: number;
  calendar?: WorkCalendar;
}): CenterSchedule {
  const cap = input.cap ?? CAPACITY_CAP;
  const horizon = input.horizon ?? SCHEDULE_HORIZON_DAYS;
  const shown = Math.min(input.shownDays ?? HEATMAP_DAYS, horizon);
  const dates = workDaysFrom(input.startIso, horizon, input.calendar);
  const centers = input.centers.filter((c) => c.dailyMinutes > 0);
  const capOf = new Map(centers.map((c) => [c.id, c.dailyMinutes * cap]));
  const used = new Map(centers.map((c) => [c.id, new Array<number>(dates.length).fill(0)]));

  const sorted = [...input.orders].sort((a, b) => (a.neededBy ?? "9999-12-31").localeCompare(b.neededBy ?? "9999-12-31") || a.id - b.id);
  const results: OrderResult[] = [];
  let noRouting = 0;
  let unassigned = 0;

  for (const o of sorted) {
    const fraction = remainingFraction(o.status);
    if (fraction <= 0) continue;
    const ops = parseRouting(o.routing).filter((op) => opMinutes(op, o.qty) > 0);
    const usable = ops.filter((op) => op.workCenterId !== null && capOf.has(op.workCenterId));
    unassigned += ops.length - usable.length;
    if (usable.length === 0) {
      noRouting += 1;
      continue;
    }
    let cursor = 0;
    let beyond = false;
    for (const op of usable) {
      let left = opMinutes(op, o.qty) * fraction * (o.scale ?? 1);
      const slots = used.get(op.workCenterId as number) as number[];
      const dayCap = capOf.get(op.workCenterId as number) as number;
      let idx = cursor;
      while (left > EPS) {
        if (idx >= dates.length) {
          beyond = true;
          break;
        }
        const room = dayCap - (slots[idx] ?? 0);
        if (room <= EPS) {
          idx += 1;
          continue;
        }
        const take = Math.min(room, left);
        slots[idx] = (slots[idx] ?? 0) + take;
        left -= take;
      }
      if (beyond) break;
      cursor = Math.min(idx, dates.length - 1);
    }
    const finish = beyond ? null : (dates[cursor] ?? null);
    let lateDays: number | null = null;
    let late = false;
    if (o.neededBy) {
      if (finish) {
        lateDays = Math.round((Date.parse(`${finish}T00:00:00Z`) - Date.parse(`${o.neededBy}T00:00:00Z`)) / DAY);
        late = lateDays > 0;
      } else late = true;
    }
    results.push({ id: o.id, orderNumber: o.orderNumber, productName: o.productName, neededBy: o.neededBy, finish, late, lateDays });
  }

  const shownDates = dates.slice(0, shown);
  const rows: CenterRow[] = centers.map((c) => {
    const slots = used.get(c.id) as number[];
    const dayCap = c.dailyMinutes * cap;
    const days = shownDates.map((date, i) => ({ date, used: r1(slots[i] ?? 0), capacity: r1(dayCap), load: Math.round(((slots[i] ?? 0) / dayCap) * 1000) / 1000 }));
    const total = days.reduce((s, d) => s + d.used, 0);
    return { id: c.id, code: c.code, name: c.name, days, utilization: days.length ? Math.round((total / (dayCap * days.length)) * 1000) / 1000 : 0 };
  });

  return { centers: rows, orders: results, scheduledOrders: results.length, noRoutingOrders: noRouting, unassignedOps: unassigned };
}

export interface RoutingVersionRow {
  id: number;
  productId: number;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  routingSnapshot: unknown;
}
/** النسخة المعتمدة السارية النهارده لكل منتج هندسي (الأحدث بداية سريان ثم رقمًا). */
export function pickRoutingVersions(rows: readonly RoutingVersionRow[], todayIso: string): Map<number, unknown> {
  const best = new Map<number, RoutingVersionRow>();
  for (const r of rows) {
    if (r.status !== "released") continue;
    if (r.effectiveFrom && r.effectiveFrom > todayIso) continue;
    if (r.effectiveTo && r.effectiveTo < todayIso) continue;
    const cur = best.get(r.productId);
    if (!cur || (r.effectiveFrom ?? "") > (cur.effectiveFrom ?? "") || ((r.effectiveFrom ?? "") === (cur.effectiveFrom ?? "") && r.id > cur.id)) best.set(r.productId, r);
  }
  return new Map([...best].map(([k, v]) => [k, v.routingSnapshot]));
}

/** المسار صالح للحساب: فيه عملية بدقايق على مركز عمل معروف. */
export function hasUsableRouting(routing: unknown, qty: number, centerIds: ReadonlySet<number>): boolean {
  return parseRouting(routing).some((op) => opMinutes(op, qty) > 0 && op.workCenterId !== null && centerIds.has(op.workCenterId));
}
