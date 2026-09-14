/** @format */
/**
 * Delivery Method Rule Engine — قاعدة تحديد طريقة التسليم (Phase 3)
 *
 * قواعد بيانات-محور (delivery_method_rules، قابلة للتعديل من الإعدادات).
 * كل قاعدة نشطة بتتفحص بترتيب priority (الأصغر أولًا)؛ أول قاعدة يتطابق
 * معاها الحجم/القيمة والتوقيت تكسب. لو مفيش أي قاعدة متطابقة، ترجع
 * DEFAULT_METHOD (نفس القيمة اللي بتتزرع كـ"قاعدة افتراضية" في migration
 * 0051، فالاثنين بيتفقوا مع بعض عمدًا).
 *
 * "timing" بيتحسب برّه الدالة دي وبيتبعت جاهز:
 *  - "any"     → لسه معروفش تاريخ اكتمال فعلي (الحالة الطبيعية وقت اقتراح
 *                أول مرة عند تقديم الطلب أو مراجعته).
 *  - "on_time" → اكتمل قبل أو يوم neededBy بالظبط.
 *  - "late"    → اكتمل بعد neededBy.
 * قاعدة بـ timing="any" بتتطابق مع أي قيمة توقيت مُدخلة (مش بس "any" نفسها)
 * — عشان تقدر تبقى fallback عام بغض النظر عن التوقيت.
 */
import type { DeliveryMethodRule } from "../db/schema/delivery-rules";

export const DEFAULT_DELIVERY_METHOD: "customer" | "warehouse" = "warehouse";

export type DeliveryTiming = "any" | "on_time" | "late";

export function computeTiming(params: {
  neededBy: string | null;
  completedAt: Date | string | null;
}): DeliveryTiming {
  if (!params.completedAt || !params.neededBy) return "any";
  const completed =
    typeof params.completedAt === "string" ?
      new Date(params.completedAt)
    : params.completedAt;
  const due = new Date(`${params.neededBy}T23:59:59Z`);
  return completed.getTime() <= due.getTime() ? "on_time" : "late";
}

export function pickDeliveryMethodRule(
  rules: DeliveryMethodRule[],
  params: { qty: number; value: number; timing: DeliveryTiming },
): DeliveryMethodRule | null {
  const candidates = rules
    .filter((r) => r.isActive)
    .filter((r) => {
      const minQty = r.minQty !== null ? Number(r.minQty) : null;
      const maxQty = r.maxQty !== null ? Number(r.maxQty) : null;
      const minValue = r.minValue !== null ? Number(r.minValue) : null;
      const maxValue = r.maxValue !== null ? Number(r.maxValue) : null;
      if (minQty !== null && params.qty < minQty) return false;
      if (maxQty !== null && params.qty > maxQty) return false;
      if (minValue !== null && params.value < minValue) return false;
      if (maxValue !== null && params.value > maxValue) return false;
      if (r.timing !== "any" && r.timing !== params.timing) return false;
      return true;
    })
    .sort((a, b) => a.priority - b.priority);
  return candidates[0] ?? null;
}

export function computeDeliveryMethod(
  rules: DeliveryMethodRule[],
  params: { qty: number; value: number; timing: DeliveryTiming },
): "customer" | "warehouse" {
  const matched = pickDeliveryMethodRule(rules, params);
  return (matched?.deliveryMethod as "customer" | "warehouse" | undefined) ??
    DEFAULT_DELIVERY_METHOD;
}
