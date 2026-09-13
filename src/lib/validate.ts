/** @format */

import { Response } from "express";

/**
 * يقرأ معرّف رقمي من route params ويتأكد إنه رقم صحيح.
 * لو مش صالح، بيرسل رد 400 واضح ويرجع null — المفروض الـ route يعمل return فوراً في الحالة دي.
 *
 * الاستخدام:
 *   const id = parseIdParam(req.params.id, res);
 *   if (id === null) return;
 */
export function parseIdParam(raw: unknown, res: Response): number | null {
  // ✅ إصلاح حرج: parseInt("4.5", 10) بيقص الجزء العشري ويرجع 4 بصمت بدل
  // ما يرفض القيمة — يعني "4.5" كانت بتتقبل كـ id=4 من غير أي تحذير.
  // Number() بدل ما تقص، بترجع 4.5 كامل فيتم رفضه صح عن طريق Number.isInteger
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: "معرّف غير صالح" } });
    return null;
  }
  return id;
}

/**
 * ✅ إصلاح جوهري: بديل آمن لأي `Number(input.amount)` ساذج في كود الأموال
 * أو الكميات. كان النمط القديم بيحوّل أي قيمة غير صالحة (نص، undefined،
 * فراغ) إلى NaN من غير ما يوقف التنفيذ — وبعدين NaN بتتسجل فعليًا كـ
 * السلسلة النصية "NaN" في رصيد عميل أو كمية مخزون في قاعدة البيانات،
 * لأن `(NaN).toFixed(2)` بترجع "NaN" مش بترمي error.
 *
 * الدالة دي بترمي domain error واضح (status 400) بدل ما تسيب القيمة الفاسدة
 * تعدي. الاستخدام:
 *   const amount = parseFiniteAmount(input.amount, "قيمة التعديل");
 *
 * lowerBound اختياري — مثلاً 0 لو عايز تمنع أي قيمة سالبة (كمية مخزون مثلاً).
 */
export function parseFiniteAmount(
  raw: unknown,
  label: string,
  options?: { min?: number; allowZero?: boolean },
): number {
  // ✅ إصلاح حرج: Number(null) في JavaScript بترجع 0 (مش NaN زي
  // Number(undefined))، يعني null كان بيتحوّل صامتًا لصفر مقبول بدل ما
  // يترفض كـ"قيمة غير موجودة" — نفس نية التوثيق الأصلي فوق بالظبط
  // ("نص، undefined، فراغ") لكن null ماكانتش فعليًا بترفض قبل كده.
  if (raw === null || raw === undefined || raw === "") {
    throw Object.assign(new Error(`${label} غير صالحة — لازم تكون رقم`), {
      status: 400,
    });
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw Object.assign(new Error(`${label} غير صالحة — لازم تكون رقم`), {
      status: 400,
    });
  }
  if (options?.allowZero === false && n === 0) {
    throw Object.assign(new Error(`${label} لا يمكن أن تكون صفر`), {
      status: 400,
    });
  }
  if (options?.min !== undefined && n < options.min) {
    throw Object.assign(
      new Error(`${label} لا يمكن أن تكون أقل من ${options.min}`),
      { status: 400 },
    );
  }
  return n;
}
