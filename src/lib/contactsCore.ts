/** منطق جهات الاتصال النقي (من غير قاعدة بيانات): نطاق البائع، مفتاح الهاتف، وأسباب منع الحذف. */

export const SELLER_ROLES = ["online_seller", "offline_seller"] as const;
export const isSellerRole = (role: string) => (SELLER_ROLES as readonly string[]).includes(role);

/**
 * مفتاح مقارنة الهاتف: الأرقام بس، وآخر 10 أرقام لو الرقم طويل.
 * كده "0100 123 4567" و"+20 100 123 4567" و"00201001234567" يتعرّفوا إنهم نفس الرقم.
 */
export function phoneKey(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export interface ContactRefs {
  sales: number;
  purchases: number;
  stockItems: number;
}

/** لو جهة الاتصال مرتبطة بسجلات، الحذف بيتمنع برسالة بتقول إيه اللي مربوط بيها. */
export function deleteBlocker(refs: ContactRefs): string | null {
  const parts: string[] = [];
  if (refs.sales > 0) parts.push(`${refs.sales} فاتورة مبيعات`);
  if (refs.purchases > 0) parts.push(`${refs.purchases} أمر شراء`);
  if (refs.stockItems > 0) parts.push(`${refs.stockItems} صنف مخزون`);
  if (!parts.length) return null;
  return `مينفعش تتحذف: عليها ${parts.join(" و")}. عدّل بياناتها بدل الحذف.`;
}
