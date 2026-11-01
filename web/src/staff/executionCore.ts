/**
 * منطق تبويب «التنفيذ والتوقفات» (خطوة 32). بدون واجهة عشان يتختبر لوحده.
 * السيرفر هو الحَكَم الفعلي؛ هنا بنمنع الغلط قبل الإرسال ونشرح للمستخدم ليه الزر مقفول.
 */

/** نفس الافتراضي لصلاحية productionWorkflow.execute في src/lib/actionRegistry.ts (الأدمن ممكن يغيّره، والسيرفر يحكم). */
export const EXECUTE_ROLES = ["supervisor", "production_manager", "production_controller", "operations_manager", "executive_manager", "chairman"] as const;
export const canExecuteBatch = (role: string) => (EXECUTE_ROLES as readonly string[]).includes(role);

/** أكواد أسباب التوقف (مفتاح ثابت يتخزّن، والنص العربي من copy). */
export const DOWNTIME_REASONS = ["mechanical_failure", "electrical_failure", "material_shortage", "changeover_setup", "quality_hold", "planned_maintenance", "power_outage", "operator_break", "other"] as const;
export type DowntimeReason = (typeof DOWNTIME_REASONS)[number];

export const EXEC_QTY_RE = /^\d+(\.\d{1,3})?$/;
const EPS = 0.0005;

export interface BatchLike {
  plannedQty: string;
  producedQty: string;
  acceptedQty: string;
  reworkQty: string;
  scrapQty: string;
  status: string;
}

export interface BatchBalance {
  produced: number;
  accounted: number;
  /** المنتج ناقص (مقبول + إعادة تشغيل + هالك): لازم يبقى صفر عشان القفل. */
  gap: number;
  /** نسبة المقبول من المخطط. */
  progressPct: number;
  overPlanned: boolean;
}

export function batchBalance(b: BatchLike): BatchBalance {
  const produced = Number(b.producedQty) || 0;
  const accounted = (Number(b.acceptedQty) || 0) + (Number(b.reworkQty) || 0) + (Number(b.scrapQty) || 0);
  const planned = Number(b.plannedQty) || 0;
  const gap = Math.abs(produced - accounted) <= EPS ? 0 : produced - accounted;
  return { produced, accounted, gap, progressPct: planned > 0 ? Math.min(100, Math.round(((Number(b.acceptedQty) || 0) / planned) * 100)) : 0, overPlanned: produced > planned + EPS };
}

export type CloseBlock = "done" | "nothing" | "gap" | "over" | null;

/** ليه مينفعش نقفل الدفعة (نفس ترتيب فحوص السيرفر)، أو null لو ينفع. */
export function closeBlockReason(b: BatchLike): CloseBlock {
  if (b.status === "completed") return "done";
  const bal = batchBalance(b);
  if (bal.produced <= 0) return "nothing";
  if (bal.gap !== 0) return "gap";
  if (bal.overPlanned) return "over";
  return null;
}

export const canConfirmBatch = (b: BatchLike) => b.status !== "completed";

export interface ConfirmInput { operationNo: string; shiftCode: string; goodQty: string; scrapQty: string; reworkQty: string; notes: string }
export type ConfirmError = "operationNo" | "qty" | "empty" | null;

export function confirmError(i: ConfirmInput): ConfirmError {
  if (!/^[1-9]\d{0,5}$/.test(i.operationNo.trim())) return "operationNo";
  const parts = [i.goodQty, i.scrapQty, i.reworkQty].map((s) => s.trim());
  if (parts.some((s) => s !== "" && !EXEC_QTY_RE.test(s))) return "qty";
  if (parts.every((s) => !s || Number(s) === 0)) return "empty";
  return null;
}

/** جسم PATCH /production-execution/batches/:id/confirm. الكميات الفاضية بتتحوّل لصفر. */
export function confirmPayload(i: ConfirmInput) {
  const q = (s: string) => (s.trim() === "" ? "0" : s.trim());
  const notes = i.notes.trim();
  const shift = i.shiftCode.trim();
  return { operationNo: Number(i.operationNo.trim()), goodQty: q(i.goodQty), scrapQty: q(i.scrapQty), reworkQty: q(i.reworkQty), ...(shift ? { shiftCode: shift } : {}), ...(notes ? { notes } : {}) };
}

export type DowntimeError = "reason" | "minutes" | null;
export function downtimeError(reason: string, minutes: string): DowntimeError {
  if (!(DOWNTIME_REASONS as readonly string[]).includes(reason)) return "reason";
  if (!/^[1-9]\d{0,4}$/.test(minutes.trim())) return "minutes";
  return null;
}
export function downtimePayload(reason: string, minutes: string, notes: string) {
  const n = notes.trim();
  return { reasonCode: reason, minutes: Number(minutes.trim()), ...(n ? { notes: n } : {}) };
}

export interface TraceLotInput { batchId: number; workflowOrderId: number; traceType: string; lotNumber: string; itemCode: string; quantity: string }
export type TraceLotError = "lot" | "qty" | null;
export const TRACE_TYPES = ["input_lot", "output_lot", "shipment"] as const;
export function traceLotError(i: Pick<TraceLotInput, "lotNumber" | "quantity">): TraceLotError {
  if (!i.lotNumber.trim()) return "lot";
  if (i.quantity.trim() && !EXEC_QTY_RE.test(i.quantity.trim())) return "qty";
  return null;
}
export function traceLotPayload(i: TraceLotInput) {
  const item = i.itemCode.trim();
  const qty = i.quantity.trim();
  return { batchId: i.batchId, workflowOrderId: i.workflowOrderId, traceType: i.traceType, lotNumber: i.lotNumber.trim(), ...(item ? { itemCode: item } : {}), ...(qty ? { quantity: qty } : {}) };
}
