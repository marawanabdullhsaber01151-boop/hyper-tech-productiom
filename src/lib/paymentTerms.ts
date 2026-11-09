/** @format */
// شروط الدفع (الخطوة 42ج): قايمة مغلقة. نقية من غير قاعدة بيانات. القيمة بتتحدد من إعداد «orders.payment_terms»
// (عام أو لشركة معينة) وبتتسجّل على كل سطر طلب وقت الطلب (لقطة)، فتغيير الإعداد بعد كده مايغيّرش طلب اتبعت.
export const PAYMENT_TERMS = ["cash", "credit_15", "credit_30", "credit_60"] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];
export const DEFAULT_PAYMENT_TERMS: PaymentTerms = "cash";

export const isPaymentTerms = (v: unknown): v is PaymentTerms => typeof v === "string" && (PAYMENT_TERMS as readonly string[]).includes(v);

/** عدد أيام الآجل (0 = نقدي). قيمة مجهولة تتعامل كنقدي. */
export function creditDays(terms: unknown): number {
  if (!isPaymentTerms(terms)) return 0;
  return terms === "cash" ? 0 : Number(terms.slice("credit_".length));
}

/** تاريخ الاستحقاق (YYYY-MM-DD) من تاريخ الطلب وشروط الدفع. نقدي = نفس اليوم. */
export function dueDateFor(orderDate: string, terms: unknown): string {
  const d = new Date(`${orderDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + creditDays(terms));
  return d.toISOString().slice(0, 10);
}
