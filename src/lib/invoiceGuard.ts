/** @format */
// ترجرات الفاتورة (هجرة 0109) كرسايل عربية. ملف صغير من غير اعتماديات علشان يتختبر لوحده.
/** رسالة ترجر الفاتورة من سلسلة الأخطاء (drizzle بيغلّف رسالة postgres جوّه cause). */
export function invoiceGuardOf(err: unknown): { code: string; message: string } | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && typeof cur === "object" && cur !== null; i += 1) {
    const msg = String((cur as { message?: unknown }).message ?? "");
    if (msg.includes("INV_ORDER_LOCKED")) return { code: "INVOICE_ORDER_LOCKED", message: "الأمر ده ليه فاتورة صادرة، فمينفعش تغيّر العميل أو الإجمالي أو الأصناف أو تلغيه أو تمسحه. التصحيح بإشعار دائن" };
    if (msg.includes("INV_IMMUTABLE")) return { code: "INVOICE_IMMUTABLE", message: "الفاتورة الصادرة ثابتة ومينفعش تتعدّل ولا تتمسح" };
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}
