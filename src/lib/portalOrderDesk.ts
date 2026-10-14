/** @format */
/**
 * Plan 09 — pure helpers for the staff desk of portal orders: where a line is,
 * and what state a whole batch (إرسالية) is in.
 */
export type LineStage = "cancelled" | "preparing" | "production" | "ready" | "delivered";
export type BatchStatus = "pending" | "confirmed" | "rejected" | "cancelled";
export type BatchProgress = "preparing" | "production" | "ready" | "delivered";

const PRODUCTION = new Set(["in_production", "quality_check"]);
const READY = new Set(["completed", "delivery_pending_customer", "delivery_pending_warehouse"]);
const DELIVERED = new Set(["delivered_customer", "delivered_warehouse", "delivered"]);

export function lineStage(workflowStatus: string): LineStage {
  if (workflowStatus === "cancelled") return "cancelled";
  if (DELIVERED.has(workflowStatus)) return "delivered";
  if (READY.has(workflowStatus)) return "ready";
  if (PRODUCTION.has(workflowStatus)) return "production";
  return "preparing";
}

/** مراجعة موجودة = قرارها، غير كده لو كل الأصناف اتلغت يبقى ملغي، وإلا مستني مراجعة. */
export function batchStatus(reviewStatus: string | null | undefined, workflowStatuses: string[]): BatchStatus {
  if (reviewStatus === "confirmed") return "confirmed";
  if (reviewStatus === "rejected") return "rejected";
  if (workflowStatuses.length > 0 && workflowStatuses.every((s) => s === "cancelled")) return "cancelled";
  return "pending";
}

const ORDER: BatchProgress[] = ["preparing", "production", "ready", "delivered"];

/** أبطأ صنف شغّال هو اللي بيحدد مرحلة الإرسالية. null لو كله ملغي. */
export function batchProgress(workflowStatuses: string[]): BatchProgress | null {
  const live = workflowStatuses.map(lineStage).filter((s): s is BatchProgress => s !== "cancelled");
  if (!live.length) return null;
  return live.reduce((slow, s) => (ORDER.indexOf(s) < ORDER.indexOf(slow) ? s : slow), "delivered" as BatchProgress);
}

/** الصنف ممكن يتلغى من المبيعات لو لسه قبل الإنتاج (نفس قاعدة cancellation.ts). */
export const CLAIMABLE = new Set(["new", "awaiting_operations_claim"]);
