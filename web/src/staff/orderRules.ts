/** قواعد تبويب «أوامر الإنتاج»: مين يعمل إيه وعلى أنهي حالة. السيرفر هو الحَكَم الفعلي، وده بس عشان نخفي الأزرار اللي هتترفض. */

/** نفس ACCESS.productionWorkflowRead في السيرفر. */
export const ORDER_VIEW_ROLES = [
  "chairman", "executive_manager", "operations_manager", "hr", "hr_manager", "production_manager", "production_controller",
  "warehouse_manager", "supervisor", "production_quality_controller", "quality_engineer", "raw_material_quality_controller",
] as const;
/** نفس POST /production-workflow (اللي يقدر يشوف القايمة منهم). */
export const ORDER_CREATE_ROLES = ["chairman", "executive_manager", "hr", "hr_manager"] as const;
export const ORDER_RECEIVE_ROLES = ["chairman", "executive_manager", "operations_manager", "production_manager"] as const;
export const ORDER_DELIVER_ROLES = ORDER_RECEIVE_ROLES;
/** نفس صلاحية productionWorkflow.cancel الافتراضية. */
export const ORDER_CANCEL_ROLES = ["chairman", "executive_manager"] as const;
export const CONFIRM_CUSTOMER_ROLES = ["chairman", "executive_manager", "hr", "hr_manager"] as const;
export const CONFIRM_WAREHOUSE_ROLES = ["chairman", "executive_manager", "operations_manager", "warehouse_manager", "storekeeper"] as const;

export const ORDER_STATUSES = [
  "new", "awaiting_operations_claim", "claimed", "pending_supervisor", "materials_requested", "materials_approved", "materials_partial",
  "materials_rejected", "in_production", "held", "rework", "partially_completed", "quality_check", "completed", "delivery_pending_customer", "delivery_pending_warehouse",
  "delivered_customer", "delivered_warehouse", "cancelled", "closed", "corrected",
] as const;
export const FINAL_STATUSES = ["delivered_customer", "delivered_warehouse", "cancelled", "closed"] as const;
/** نفس lifecycleRoles في routes/production-lifecycle.ts. */
export const LIFECYCLE_ROLES = ["chairman", "executive_manager", "operations_manager", "production_manager", "production_controller", "supervisor", "production_quality_controller", "warehouse_manager"] as const;
/** نفس أدوار PATCH /production-workflow/:id/dispatch. */
export const DISPATCH_ROLES = ["chairman", "executive_manager", "operations_manager", "production_manager", "production_controller"] as const;
/** نفس assertLifecycleRole للتصحيح (corrected). */
export const CORRECT_ROLES = ["chairman", "executive_manager", "production_manager", "quality_engineer"] as const;
export const ORDER_PRIORITIES = ["urgent", "high", "normal", "low"] as const;

const has = (list: readonly string[], role: string) => list.includes(role);

export type OrderAction = "receive" | "cancel" | "deliver" | "confirm" | "dispatch" | "hold" | "resume" | "rework" | "partial" | "correct";

/** الكمية الجزئية: أكبر من صفر وأقل من كمية الأمر (نفس قاعدة السيرفر). */
export function partialQtyError(qty: string, total: string): "bad" | "tooMuch" | null {
  if (!isPositiveQty(qty)) return "bad";
  return Number(qty) >= Number(total) ? "tooMuch" : null;
}

export interface OrderLike { workflowStatus: string; createdById?: number }

/** الإجراءات المتاحة للدور على الأمر (غير تعديل الموعد، لأنه مربوط بصاحب الطلب). */
export function orderActions(role: string, status: string): OrderAction[] {
  const out: OrderAction[] = [];
  if (status === "claimed" && has(ORDER_RECEIVE_ROLES, role)) out.push("receive");
  if (status === "completed" && has(ORDER_DELIVER_ROLES, role)) out.push("deliver");
  if (status === "delivery_pending_customer" && has(CONFIRM_CUSTOMER_ROLES, role)) out.push("confirm");
  if (status === "delivery_pending_warehouse" && has(CONFIRM_WAREHOUSE_ROLES, role)) out.push("confirm");
  if ((status === "materials_approved" || status === "materials_partial") && has(DISPATCH_ROLES, role)) out.push("dispatch");
  if (has(LIFECYCLE_ROLES, role)) {
    if (["in_production", "quality_check", "partially_completed", "rework"].includes(status)) out.push("hold");
    if (status === "held") out.push("resume");
    if (["in_production", "quality_check", "held"].includes(status)) out.push("rework");
    if (status === "in_production" || status === "quality_check") out.push("partial");
  }
  if (["completed", "delivered_customer", "delivered_warehouse"].includes(status) && has(CORRECT_ROLES, role)) out.push("correct");
  if (!has(FINAL_STATUSES, status) && has(ORDER_CANCEL_ROLES, role)) out.push("cancel");
  return out;
}

/** تعديل موعد التسليم: صاحب الطلب بس (نفس قاعدة السيرفر NEEDED_BY_LOCKED) وقبل النهاية. */
export const canEditNeededBy = (userId: number | undefined, order: OrderLike) =>
  userId !== undefined && order.createdById === userId && !has(FINAL_STATUSES, order.workflowStatus);

export const canCreateOrder = (role: string) => has(ORDER_CREATE_ROLES, role);
export const canViewOrders = (role: string) => has(ORDER_VIEW_ROLES, role);

/** الحالات اللي «الدور بتاعها» مسؤول عنها، لفلتر «ينتظر إجراءك» (حتى لو إجراءاتها في شاشات تانية). */
const WAITING: Record<string, readonly string[]> = {
  claimed: ORDER_RECEIVE_ROLES,
  pending_supervisor: ["supervisor"],
  materials_requested: ["warehouse_manager", "operations_manager", "executive_manager", "chairman"],
  materials_approved: DISPATCH_ROLES,
  materials_partial: DISPATCH_ROLES,
  held: ["production_manager", "supervisor"],
  in_production: ["supervisor"],
  quality_check: ["production_quality_controller", "quality_engineer"],
  completed: ORDER_DELIVER_ROLES,
  delivery_pending_customer: CONFIRM_CUSTOMER_ROLES,
  delivery_pending_warehouse: CONFIRM_WAREHOUSE_ROLES,
};
export const isWaitingForRole = (role: string, status: string) => has(WAITING[status] ?? [], role);

/** الدور المسؤول عن الخطوة الجاية، لعرض «عند مين الأمر؟». */
export function ownerRoleKey(status: string): string {
  if (status === "new" || status === "awaiting_operations_claim") return "operations";
  if (status === "claimed" || status === "completed") return "production_manager";
  if (["pending_supervisor", "in_production", "held", "rework", "partially_completed"].includes(status)) return "supervisor";
  if (status === "materials_approved" || status === "materials_partial") return "production_manager";
  if (status === "materials_requested" || status === "delivery_pending_warehouse") return "warehouse";
  if (status === "materials_rejected") return "production_manager";
  if (status === "quality_check") return "quality";
  if (status === "delivery_pending_customer") return "hr";
  return "none";
}

export function countByStatus(rows: Array<{ workflowStatus: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.workflowStatus] = (out[r.workflowStatus] ?? 0) + 1;
  return out;
}

export type OrderGroup = "waiting" | "inProgress" | "done" | "cancelled";
export function groupOf(status: string): OrderGroup {
  if (status === "cancelled" || status === "closed") return "cancelled";
  if (status === "delivered_customer" || status === "delivered_warehouse" || status === "corrected") return "done";
  if (["new", "awaiting_operations_claim", "claimed", "pending_supervisor", "materials_rejected"].includes(status)) return "waiting";
  return "inProgress";
}

/** أمر متأخر: موعد التسليم عدّى وهو لسه مش في حالة نهائية. التاريخ بصيغة YYYY-MM-DD. */
export function isOverdue(neededBy: string | null | undefined, status: string, today: string): boolean {
  if (!neededBy || has(FINAL_STATUSES, status)) return false;
  return neededBy.slice(0, 10) < today;
}

/** أقل مشرف/مراقب حِمل (الأقل أوامر جارية) كاقتراح تلقائي عند الاستلام، والأول في القايمة لو التعادل. */
export function leastLoaded<T extends { id: number; activeCount: number }>(list: T[]): T | undefined {
  let best: T | undefined;
  for (const x of list) if (!best || x.activeCount < best.activeCount) best = x;
  return best;
}

export function receiveError(v: { supervisorId: string; qcId: string; line: string; startDate: string; operational: string; pendingReason: string }):
  "supervisor" | "qc" | "line" | "start" | "pending" | null {
  if (!v.supervisorId) return "supervisor";
  if (!v.qcId) return "qc";
  if (!v.line.trim()) return "line";
  if (!v.startDate) return "start";
  if (v.operational === "pending" && !v.pendingReason.trim()) return "pending";
  return null;
}

export const QTY_RE = /^\d+(\.\d{1,4})?$/;
export const isPositiveQty = (s: string) => QTY_RE.test(s.trim()) && Number(s) > 0;

export function createError(v: { recipeId: string; qty: string; customer: string; neededBy: string }): "recipe" | "qty" | "customer" | "date" | null {
  if (!v.recipeId) return "recipe";
  if (!isPositiveQty(v.qty)) return "qty";
  if (!v.customer.trim()) return "customer";
  if (!v.neededBy) return "date";
  return null;
}
