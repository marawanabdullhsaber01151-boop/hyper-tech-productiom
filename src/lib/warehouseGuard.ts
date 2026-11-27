/** @format */
// ترجرات المخازن (هجرة 0110) كرسايل عربية. ملف صغير من غير اعتماديات علشان يتختبر لوحده.
const GUARDS: readonly { key: string; code: string; message: string }[] = [
  { key: "WH_KIND_MISMATCH", code: "WAREHOUSE_KIND_MISMATCH", message: "نوع المخزن مايناسبش فئة الصنف. الخام في مخزن خام أو تحت تشغيل، والتام في تحت تشغيل أو تام، ونص المصنّع في تحت تشغيل بس. انقل الرصيد الأول لو بتغيّر فئة صنف عليه رصيد" },
  { key: "WH_INACTIVE", code: "WAREHOUSE_INACTIVE", message: "المخزن موقوف ومينفعش يستقبل رصيد" },
  { key: "WH_DEFAULT_LOCKED", code: "WAREHOUSE_DEFAULT_LOCKED", message: "المخزن الافتراضي لنوعه مينفعش يتوقف ولا يتمسح ولا يتغيّر كونه افتراضي" },
  { key: "WH_KIND_LOCKED", code: "WAREHOUSE_KIND_LOCKED", message: "نوع المخزن ثابت ومينفعش يتغيّر بعد الإنشاء" },
  { key: "WH_HAS_STOCK", code: "WAREHOUSE_HAS_STOCK", message: "المخزن عليه رصيد. انقل الرصيد لمخزن تاني الأول وبعدها وقّفه" },
  { key: "WH_IN_USE", code: "WAREHOUSE_IN_USE", message: "المخزن اتستخدم قبل كده (فيه رصيد أو حركات) فمينفعش يتمسح. وقّفه بدل المسح" },
  { key: "WH_NO_DEFAULT", code: "WAREHOUSE_NO_DEFAULT", message: "مفيش مخزن افتراضي لنوع الصنف ده. راجع إعدادات المخازن" },
  { key: "stock_balances_qty_nonneg", code: "STOCK_NEGATIVE", message: "الكمية مش كفاية في المخزن، والرصيد مينفعش يبقى بالسالب" },
  { key: "stock_balances_reserved_nonneg", code: "STOCK_NEGATIVE", message: "المحجوز مينفعش يبقى بالسالب" },
  { key: "stock_balances_quarantine_nonneg", code: "STOCK_NEGATIVE", message: "كمية الحجر مينفعش تبقى بالسالب" },
];

/** رسالة ترجر المخازن من سلسلة الأخطاء (drizzle بيغلّف رسالة postgres جوّه cause). */
export function warehouseGuardOf(err: unknown): { code: string; message: string } | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && typeof cur === "object" && cur !== null; i += 1) {
    const msg = String((cur as { message?: unknown }).message ?? "");
    const hit = GUARDS.find((g) => msg.includes(g.key));
    if (hit) return { code: hit.code, message: hit.message };
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}
