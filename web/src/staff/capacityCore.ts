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
