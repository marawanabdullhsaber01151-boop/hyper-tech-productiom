/** @format */
/**
 * Pre-Production Cancellation Guard — قاعدة إلغاء أسطر طلبات البوابة (Phase 3)
 *
 * ده خاص بأسطر الإنتاج اللي جايه من بوابة العملاء بس (اللي عندها
 * portalCustomerId). الحدود هنا مقصودة تكون **أضيق** من إندپوينت الإلغاء
 * الداخلي العام PATCH /production-workflow/:id/cancel (المستخدم من فريق
 * الإنتاج لأسباب تشغيلية داخلية ومسموح فيه الإلغاء حتى مراحل متأخرة أكتر،
 * مع منطق رجوع خصومات المخزون بتاعه) — مفيش أي تعديل على الإندپوينت ده في
 * المرحلة دي، والاتنين موجودين بجانب بعض عمدًا لغرضين مختلفين.
 *
 * الحد المسموح به هنا: العميل أو مبيعات البوابة يقدروا يلغوا السطر بس لسه
 * في مرحلة "قبل الإنتاج" — بما فيها بوابة مدير التشغيل قبل أي خصم فعلي من
 * المخزون. بمجرد ما مدير
 * المخازن يوافق (materials_approved/materials_partial) أو الطلب يدخل
 * in_production أو أي مرحلة بعدها، الإلغاء مرفوض تمامًا، من غير استثناء —
 * راجع test في src/lib/cancellation.test.ts اللي بيثبت الحماية دي.
 */
export const CANCELLABLE_WORKFLOW_STATUSES = new Set([
  "new",
  "awaiting_operations_claim",
  "claimed",
  "pending_supervisor",
  "materials_requested",
  "materials_rejected",
]);

export function isCancellableStatus(workflowStatus: string): boolean {
  return CANCELLABLE_WORKFLOW_STATUSES.has(workflowStatus);
}

export function assertCancellable(workflowStatus: string): void {
  if (!isCancellableStatus(workflowStatus)) {
    throw Object.assign(
      new Error(
        "لا يمكن إلغاء هذا الصنف — دخل مرحلة الإنتاج بالفعل ولا يمكن التراجع عنه",
      ),
      { status: 409 },
    );
  }
}

/**
 * Plan 02 — company-level cancel. The company owner (or anyone granted
 * orders.cancel_company) may cancel an order in ANY stage that is not already
 * finished. Cancelling after the early stages is a "late cancel": the order is
 * cancelled and the stage is recorded in `cancel_stage`, and staff are told
 * (`order.cancelled_late`). What a late cancel does to stock or money is
 * deliberately NOT decided here; it is a separate policy to be added later.
 */
export const FINISHED_WORKFLOW_STATUSES = new Set([
  "cancelled",
  "completed",
  "closed",
  "shipped",
  "delivered",
]);

export const WORKFLOW_STAGE_ORDER = [
  "new",
  "awaiting_operations_claim",
  "claimed",
  "pending_supervisor",
  "materials_requested",
  "materials_rejected",
  "materials_approved",
  "materials_partial",
  "in_production",
  "quality_check",
  "packaging",
  "ready_for_delivery",
  "shipped",
  "delivered",
  "completed",
  "closed",
] as const;

export type CompanyCancelDecision =
  | { allowed: true; late: boolean }
  | { allowed: false; reason: "finished" | "beyond_company_limit" };

/**
 * @param maxStatus company setting `orders.cancel.company_max_status`
 *   (null/empty = any stage until finished).
 */
export function decideCompanyCancel(
  workflowStatus: string,
  maxStatus: string | null | undefined,
): CompanyCancelDecision {
  if (FINISHED_WORKFLOW_STATUSES.has(workflowStatus)) {
    return { allowed: false, reason: "finished" };
  }
  if (maxStatus) {
    const limit = (WORKFLOW_STAGE_ORDER as readonly string[]).indexOf(maxStatus);
    const current = (WORKFLOW_STAGE_ORDER as readonly string[]).indexOf(workflowStatus);
    if (limit >= 0 && current > limit) {
      return { allowed: false, reason: "beyond_company_limit" };
    }
  }
  return { allowed: true, late: !isCancellableStatus(workflowStatus) };
}
