/** عرض السعة ووعد التسليم في الواجهة (الحساب نفسه في السيرفر). */
export interface CapacityDay {
  date: string;
  used: number;
  capacity: number;
  load: number;
}
export interface Capacity {
  generatedAt: string;
  cap: number;
  lines: number;
  linesAssumed: boolean;
  openOrders: number;
  noRecipeOrders: number;
  days: CapacityDay[];
  queueDays: number;
  utilization: number;
  overloadedDays: number;
  freeDays: number;
  lateOrders: number;
}
export type LoadBand = "free" | "busy" | "full";

/** تلوين اليوم: تحت 60% فاضي، لحد 85% مشغول، وبعده ممتلئ. */
export function loadBand(load: number): LoadBand {
  if (load >= 0.999) return "full";
  if (load >= 0.6) return "busy";
  return "free";
}
export const pct = (n: number) => Math.round(n * 100);
export type PromiseVerdict = "ok" | "tight" | "late" | "none";
export const verdictTone = (v: PromiseVerdict): "success" | "warn" | "danger" | "neutral" =>
  v === "ok" ? "success" : v === "tight" ? "warn" : v === "late" ? "danger" : "neutral";

/** خريطة السعة حسب مركز العمل (الحساب في السيرفر). */
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
export interface CenterOrder {
  id: number;
  orderNumber: string;
  productName: string;
  neededBy: string | null;
  finish: string | null;
  late: boolean;
  lateDays: number | null;
}
export interface CenterCapacity {
  generatedAt: string;
  cap: number;
  centers: CenterRow[];
  orders: CenterOrder[];
  scheduledOrders: number;
  noRoutingOrders: number;
  unassignedOps: number;
  activeShifts: number;
  shiftsAssumed: boolean;
  liveRoutingOrders: number;
}

export type OrderState = "late" | "onTime" | "noDate";
export function orderState(o: Pick<CenterOrder, "late" | "neededBy">): OrderState {
  return o.late ? "late" : o.neededBy ? "onTime" : "noDate";
}
/** المتأخر الأول (الأكتر تأخيرًا فوق)، وبعده بترتيب التاريخ المتوقع، وبحد أقصى. */
export function sortOrders(orders: readonly CenterOrder[], limit = 15): CenterOrder[] {
  const rank = (o: CenterOrder) => (o.late ? 0 : 1);
  return [...orders]
    .sort((a, b) => rank(a) - rank(b) || (b.lateDays ?? 9999) - (a.lateDays ?? 9999) || (a.finish ?? "9999").localeCompare(b.finish ?? "9999"))
    .slice(0, limit);
}
