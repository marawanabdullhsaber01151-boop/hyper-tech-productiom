/**
 * Canonical production workflow states and guarded transitions.
 *
 * @format
 */

import {
  CANONICAL_PRODUCTION_STATUSES,
  CANONICAL_PRODUCTION_TRANSITIONS,
  type CanonicalProductionStatus,
  isCanonicalProductionStatus,
  canTransitionCanonicalProduction,
} from "./production-lifecycle";

export const PRODUCTION_STATUSES = CANONICAL_PRODUCTION_STATUSES;

export type ProductionStatus = CanonicalProductionStatus;

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
  held: "معلّق",
  rework: "إعادة تشغيل",
  partially_completed: "مكتمل جزئياً",
  corrected: "يحتاج تصحيحاً",
  closed: "مغلق",
};

export const PRODUCTION_TRANSITIONS: Readonly<
  Record<ProductionStatus, readonly ProductionStatus[]>
> = CANONICAL_PRODUCTION_TRANSITIONS;

export function isProductionStatus(value: string): value is ProductionStatus {
  return isCanonicalProductionStatus(value);
}

export function canTransitionProduction(
  from: string,
  to: string,
): to is ProductionStatus {
  return canTransitionCanonicalProduction(from, to);
}

export function assertProductionTransition(from: string, to: string): void {
  if (!canTransitionProduction(from, to)) {
    throw Object.assign(
      new Error(`انتقال حالة الإنتاج غير مسموح: ${from} → ${to}`),
      { status: 409, code: "INVALID_PRODUCTION_TRANSITION" },
    );
  }
}
