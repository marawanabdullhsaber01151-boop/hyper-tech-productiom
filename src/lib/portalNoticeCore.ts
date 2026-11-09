/** @format */
// قواعد إشعارات الطلبات الخارجية (إيميل/تيليجرام) بدون قاعدة بيانات، عشان تتختبر لوحدها.

/**
 * الأنواع اللي بتتبعت برّه البوابة كمان. كل نوع هنا = حدث مهم للعميل (سعر، رفض، إنتاج، تسليم، إلغاء، رد على سؤال سعر).
 * مقصود إن رسائل المحادثة وطلبات استعادة كلمة السر وفحوصات الجودة الداخلية مش هنا: كتيرة أو داخلية، وتفضل جوه البوابة.
 */
export const EXTERNAL_NOTICE_TYPES: readonly string[] = [
  "portal_order_priced",
  "portal_order_rejected",
  "portal_order_cancelled_by_staff",
  "portal_price_inquiry_answered",
  "workflow_in_production",
  "workflow_delivery_pending",
  "workflow_delivered",
  "workflow_cancelled",
];

export function isExternalNotice(type: string): boolean {
  return EXTERNAL_NOTICE_TYPES.includes(type);
}

/** مستلمو الإشعار: صاحب الحدث (لو موظف معيّن) + أصحاب الشركة. بدون تكرار، وبترتيب ثابت. */
export function noticeRecipientIds(input: { memberUserId?: number | null; ownerUserIds: readonly number[] }): number[] {
  const out: number[] = [];
  const add = (n: number | null | undefined) => {
    if (typeof n === "number" && Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  };
  add(input.memberUserId);
  input.ownerUserIds.forEach(add);
  return out;
}
