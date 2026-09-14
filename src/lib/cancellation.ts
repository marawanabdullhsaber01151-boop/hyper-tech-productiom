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
