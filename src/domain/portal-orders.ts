/** @format */

export type PortalOrderItem = {
  id: number;
  orderNumber: string;
  productName: string;
  qty: string;
  unit: string;
  workflowStatus: string;
  // Phase 3: تسعير مرجعي + تواريخ/طرق تسليم مقترحة، كلها معروضة للعميل
  // كمعلومات إرشادية فقط — مفيش أي منها مربوط بفاتورة أو رصيد.
  neededBy: string | null;
  suggestedDueDate: string | null;
  referenceUnitPrice: string | null;
  referenceLineTotal: string | null;
  suggestedDeliveryMethod: string | null;
  cancelledAt: string | Date | null;
  cancelReason: string | null;
};

export function toPortalOrderItem(
  order: PortalOrderItem,
): PortalOrderItem {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    productName: order.productName,
    qty: order.qty,
    unit: order.unit,
    workflowStatus: order.workflowStatus,
    neededBy: order.neededBy ?? null,
    suggestedDueDate: order.suggestedDueDate ?? null,
    referenceUnitPrice: order.referenceUnitPrice ?? null,
    referenceLineTotal: order.referenceLineTotal ?? null,
    suggestedDeliveryMethod: order.suggestedDeliveryMethod ?? null,
    cancelledAt: order.cancelledAt ?? null,
    cancelReason: order.cancelReason ?? null,
  };
}

// Phase 3: ملخص حالة مجمّع لكل "إرسالية" (batch) — مبني من الحالات
// الفعلية لكل سطر فيها، مش نص ثابت. الترتيب هنا يعكس أولوية العرض: لو أي
// سطر لسه في مرحلة تحتاج انتباه (مرفوض/ملغي) بيتقدّم في الأولوية.
export type BatchRollupStatus =
  | "all_cancelled"
  | "needs_attention" // فيه رفض واحد على الأقل، والباقي لسه شغال
  | "all_completed"
  | "in_progress"
  | "pending_review"; // لسه محدش راجع الإرسالية خالص

export function computeBatchRollupStatus(params: {
  itemStatuses: string[];
  hasReview: boolean;
}): BatchRollupStatus {
  const { itemStatuses, hasReview } = params;
  if (itemStatuses.length === 0) return "pending_review";
  const terminal = new Set([
    "cancelled",
    "completed",
    "delivered_customer",
    "delivered_warehouse",
  ]);
  const allCancelled = itemStatuses.every((s) => s === "cancelled");
  if (allCancelled) return "all_cancelled";
  const allTerminal = itemStatuses.every((s) => terminal.has(s));
  const anyRejectedOrCancelled = itemStatuses.some(
    (s) => s === "materials_rejected" || s === "cancelled",
  );
  if (allTerminal && !anyRejectedOrCancelled) return "all_completed";
  if (anyRejectedOrCancelled) return "needs_attention";
  if (!hasReview) return "pending_review";
  return "in_progress";
}