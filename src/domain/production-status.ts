/**
 * Canonical production workflow states and guarded transitions.
 *
 * @format
 */

export const PRODUCTION_STATUSES = [
  "new",
  "awaiting_operations_claim",
  "claimed",
  "pending_supervisor",
  "materials_requested",
  "materials_approved",
  "materials_partial",
  "materials_rejected",
  "in_production",
  "quality_check",
  "completed",
  "delivery_pending_customer",
  "delivery_pending_warehouse",
  "delivered_customer",
  "delivered_warehouse",
  "cancelled",
] as const;

export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  new: "جديد",
  awaiting_operations_claim: "في انتظار استلام مدير التشغيل",
  claimed: "تم استلامه من مدير التشغيل",
  pending_supervisor: "في انتظار مشرف الإنتاج",
  materials_requested: "تم طلب المواد الخام",
  materials_approved: "المواد موافق عليها",
  materials_partial: "موافقة جزئية على المواد",
  materials_rejected: "المواد مرفوضة",
  in_production: "قيد التنفيذ",
  quality_check: "فحص الجودة",
  completed: "مكتمل",
  delivery_pending_customer: "بانتظار تسليم العميل",
  delivery_pending_warehouse: "بانتظار استلام المخزن",
  delivered_customer: "تم التسليم للعميل",
  delivered_warehouse: "تم التسليم للمخزن",
  cancelled: "ملغي",
};

export const PRODUCTION_TRANSITIONS: Readonly<
  Record<ProductionStatus, readonly ProductionStatus[]>
> = {
  new: ["awaiting_operations_claim", "cancelled"],
  awaiting_operations_claim: ["claimed", "cancelled"],
  claimed: ["materials_requested", "cancelled"],
  pending_supervisor: ["materials_requested", "cancelled"],
  materials_requested: [
    "materials_approved",
    "materials_partial",
    "materials_rejected",
    "cancelled",
  ],
  materials_approved: ["in_production", "cancelled"],
  materials_partial: ["in_production", "cancelled"],
  materials_rejected: ["cancelled"],
  in_production: ["quality_check", "cancelled"],
  // A failed quality inspection is recorded while the order remains in
  // quality_check so it can be inspected again.
  quality_check: ["quality_check", "completed", "cancelled"],
  completed: [
    "delivery_pending_customer",
    "delivery_pending_warehouse",
    "cancelled",
  ],
  delivery_pending_customer: ["delivered_customer", "cancelled"],
  delivery_pending_warehouse: ["delivered_warehouse", "cancelled"],
  delivered_customer: [],
  delivered_warehouse: [],
  cancelled: [],
};

export function isProductionStatus(value: string): value is ProductionStatus {
  return (PRODUCTION_STATUSES as readonly string[]).includes(value);
}

export function canTransitionProduction(
  from: string,
  to: string,
): to is ProductionStatus {
  return (
    isProductionStatus(from) &&
    isProductionStatus(to) &&
    PRODUCTION_TRANSITIONS[from].includes(to)
  );
}

export function assertProductionTransition(from: string, to: string): void {
  if (!canTransitionProduction(from, to)) {
    throw Object.assign(
      new Error(`انتقال حالة الإنتاج غير مسموح: ${from} → ${to}`),
      { status: 409, code: "INVALID_PRODUCTION_TRANSITION" },
    );
  }
}
