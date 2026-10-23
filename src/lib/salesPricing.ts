/** @format */
/**
 * قاعدة السعر في بنود الفاتورة: لو البند مربوط بصنف من المخزون فسعر الصنف هو المعتمد (السيرفر بياخده دايمًا).
 * «تعديل سعر» بيتسجّل في الأوديت بس لو البائع كتب سعر مختلف فعلًا. سعر فاضي أو صفر = «استخدم سعر الصنف»،
 * والمقارنة بالقيمة مش بالنص (10 = 10.00) عشان الأوديت ما يتملاش بتنبيهات كاذبة.
 */
export function isCatalogPriceOverride(requested: string, authoritative: string): boolean {
  const req = requested.trim();
  if (req === "") return false;
  const r = Number(req);
  const a = Number(authoritative);
  if (!Number.isFinite(r) || !Number.isFinite(a)) return req !== authoritative;
  if (r === 0) return false;
  return r !== a;
}
