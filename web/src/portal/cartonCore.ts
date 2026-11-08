/** اقتراح تكملة الكرتونة (الخطوة 42أ). اقتراح بس، عمره ما بيمنع الطلب. نفس قاعدة السيرفر في src/lib/cartonConversion.ts. */
export interface CartonHint { add: number; total: number; cartons: number }

/**
 * لو الكمية بالقطعة فوق الحد الأدنى ومش مضاعف كرتونة: بنقترح أقرب كرتونة كاملة لفوق.
 * من غير تحويل كرتونة (أو أقل من الحد الأدنى أو كمية فاسدة) مفيش اقتراح.
 */
export function cartonHint(pieces: number, perCarton: number | null | undefined, min: number): CartonHint | null {
  const per = Number(perCarton);
  if (!Number.isInteger(per) || per <= 1) return null;
  if (!Number.isFinite(pieces) || !Number.isInteger(pieces) || pieces < 1 || pieces < min) return null;
  if (pieces % per === 0) return null;
  const cartons = Math.ceil(pieces / per);
  return { add: cartons * per - pieces, total: cartons * per, cartons };
}
