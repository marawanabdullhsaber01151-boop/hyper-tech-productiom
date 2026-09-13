/** @format */

export const SALES_ORDER_STATUSES = [
  "draft",
  "pending_approval",
  "confirmed",
  "shipped",
  "paid",
  "cancelled",
] as const;

export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export type SalesTransitionEffect =
  | "reserve"
  | "releaseReservation"
  | "deductStock"
  | "restoreStock"
  | "increaseBalance"
  | "decreaseBalance";

export interface SalesStatusTransitionPlan {
  fromStatus: SalesOrderStatus;
  toStatus: SalesOrderStatus;
  allowed: boolean;
  effects: SalesTransitionEffect[];
  reason?: string;
}

const LIFECYCLE_POSITION: Record<
  Exclude<SalesOrderStatus, "pending_approval" | "cancelled">,
  number
> = {
  draft: 0,
  confirmed: 1,
  shipped: 2,
  paid: 3,
};

export type SalesOrderStockState = "none" | "reserved" | "deducted";

export function isSalesOrderStatus(value: string): value is SalesOrderStatus {
  return (SALES_ORDER_STATUSES as readonly string[]).includes(value);
}

export function getSalesOrderStockState(
  status: SalesOrderStatus,
): SalesOrderStockState {
  if (status === "confirmed") return "reserved";
  if (status === "shipped" || status === "paid") return "deducted";
  return "none";
}

export function hasOutstandingSalesBalance(status: SalesOrderStatus): boolean {
  return status === "confirmed" || status === "shipped";
}

function getLifecyclePosition(
  status: SalesOrderStatus,
): number | null {
  if (status === "pending_approval" || status === "cancelled") return null;
  return LIFECYCLE_POSITION[status];
}

function forbidden(
  fromStatus: SalesOrderStatus,
  toStatus: SalesOrderStatus,
  reason: string,
): SalesStatusTransitionPlan {
  return { fromStatus, toStatus, allowed: false, effects: [], reason };
}

/**
 * Pure source of truth for all sales-order state changes.
 *
 * `pending_approval` is deliberately isolated from the lifecycle. The
 * governance route owns approval decisions because it also owns the approval
 * request and its rollback behavior.
 */
export function computeStockAndBalanceEffects(
  fromStatus: SalesOrderStatus,
  toStatus: SalesOrderStatus,
): SalesStatusTransitionPlan {
  if (fromStatus === toStatus) {
    return { fromStatus, toStatus, allowed: true, effects: [] };
  }

  if (fromStatus === "cancelled") {
    return forbidden(fromStatus, toStatus, "الحالة الملغاة نهائية ولا يمكن إعادتها");
  }

  if (fromStatus === "pending_approval") {
    return forbidden(
      fromStatus,
      toStatus,
      "هذا الأمر في انتظار الاعتماد؛ استخدم قرار طلب الاعتماد بدل تغيير الحالة مباشرة",
    );
  }

  if (toStatus === "pending_approval") {
    if (fromStatus === "draft") {
      return { fromStatus, toStatus, allowed: true, effects: [] };
    }
    return forbidden(
      fromStatus,
      toStatus,
      "لا يمكن نقل أمر قائم إلى انتظار الاعتماد مباشرة",
    );
  }

  if (toStatus === "cancelled") {
    const fromPosition = getLifecyclePosition(fromStatus)!;
    const effects: SalesTransitionEffect[] = [];
    if (fromPosition === 1) effects.push("releaseReservation");
    if (fromPosition >= 2) effects.push("restoreStock");
    if (hasOutstandingSalesBalance(fromStatus)) effects.push("decreaseBalance");
    return { fromStatus, toStatus, allowed: true, effects };
  }

  const fromPosition = getLifecyclePosition(fromStatus)!;
  const toPosition = getLifecyclePosition(toStatus)!;
  if (toPosition < fromPosition) {
    return forbidden(fromStatus, toStatus, "لا يمكن إرجاع أمر البيع إلى حالة سابقة");
  }

  const effects: SalesTransitionEffect[] = [];
  if (fromPosition < 1 && toPosition >= 1) {
    effects.push("reserve", "increaseBalance");
  }
  if (fromPosition < 2 && toPosition >= 2) {
    effects.push("releaseReservation");
    effects.push("deductStock");
  }
  if (fromPosition < 3 && toPosition >= 3) {
    effects.push("decreaseBalance");
  }

  return { fromStatus, toStatus, allowed: true, effects };
}