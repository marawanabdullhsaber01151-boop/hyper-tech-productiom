/** @format */
/**
 * المرحلة الواقفة (الخطوة 37أ): أمر إنتاج مفتوح ما حصلش عليه أي نشاط (تغيير حالة، ملاحظة، تأكيد عملية، توقف)
 * أكتر من الحد المسموح لمرحلته. منطق نقي من غير قاعدة بيانات.
 */

/** ساعات السكون المسموحة لكل حالة. الحالات المنتهية (مكتمل، متسلّم، ملغي...) مالهاش حد. */
export const STALL_HOURS: Readonly<Record<string, number>> = {
  awaiting_operations_claim: 24,
  claimed: 24,
  pending_supervisor: 24,
  materials_requested: 48,
  materials_approved: 24,
  materials_partial: 48,
  materials_rejected: 24,
  in_production: 24,
  held: 72,
  rework: 24,
  quality_check: 12,
  partially_completed: 48,
  delivery_pending_customer: 72,
  delivery_pending_warehouse: 48,
};
export const STALL_STATUSES = Object.keys(STALL_HOURS);

/** مين المسؤول عن تحريك الأمر في كل حالة (للمهمة التلقائية)، ومين يتصعّد له لو الأمر مشرف. */
export const STALL_OWNER: Readonly<Record<string, { role: string; escalateTo: string }>> = {
  awaiting_operations_claim: { role: "operations_manager", escalateTo: "executive_manager" },
  claimed: { role: "operations_manager", escalateTo: "executive_manager" },
  pending_supervisor: { role: "supervisor", escalateTo: "production_manager" },
  materials_requested: { role: "warehouse_manager", escalateTo: "operations_manager" },
  materials_approved: { role: "supervisor", escalateTo: "production_manager" },
  materials_partial: { role: "warehouse_manager", escalateTo: "operations_manager" },
  materials_rejected: { role: "operations_manager", escalateTo: "executive_manager" },
  in_production: { role: "supervisor", escalateTo: "production_manager" },
  held: { role: "production_manager", escalateTo: "executive_manager" },
  rework: { role: "supervisor", escalateTo: "production_manager" },
  quality_check: { role: "production_quality_controller", escalateTo: "production_manager" },
  partially_completed: { role: "supervisor", escalateTo: "production_manager" },
  delivery_pending_customer: { role: "warehouse_manager", escalateTo: "operations_manager" },
  delivery_pending_warehouse: { role: "warehouse_manager", escalateTo: "operations_manager" },
};

export interface StallInfo {
  stalled: boolean;
  idleHours: number;
  thresholdHours: number;
  /** نسبة السكون للحد: 1 = وصل الحد، 2 = ضعفه. */
  ratio: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function stallInfo(status: string, lastActivity: Date, now: Date, factor = 1): StallInfo {
  const base = STALL_HOURS[status];
  const threshold = base ? Math.max(1, Math.round(base * factor * 10) / 10) : 0;
  if (!threshold) return { stalled: false, idleHours: 0, thresholdHours: 0, ratio: 0 };
  const idle = Math.max(0, (now.getTime() - lastActivity.getTime()) / 3_600_000);
  return { stalled: idle >= threshold, idleHours: r1(idle), thresholdHours: threshold, ratio: r1(idle / threshold) };
}

/** أولوية المهمة: ضعف الحد أو أكتر = عالية، غير كده عادية. */
export const stallPriority = (info: StallInfo): "normal" | "high" => (info.ratio >= 2 ? "high" : "normal");

/** مفتاح منع التكرار: نفس الأمر + نفس الحالة + نفس آخر نشاط = مهمة واحدة بس؛ أي نشاط جديد وبعدين وقف تاني = مهمة جديدة. */
export const stallDedupeKey = (orderId: number, status: string, lastActivity: Date) => `stalled:${orderId}:${status}:${lastActivity.toISOString().slice(0, 13)}`;
