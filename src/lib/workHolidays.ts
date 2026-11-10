/** @format */
// تحقق العطلات (43ب): نقي من غير قاعدة بيانات.

const DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** تاريخ حقيقي بصيغة YYYY-MM-DD (مش 2026-02-30). */
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = parse(s);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

/** بداية القايمة المعروضة: من 30 يوم فاتت. */
export function holidayWindowStart(todayIso: string): string {
  return new Date(parse(todayIso) - 30 * DAY).toISOString().slice(0, 10);
}

/** رسالة المشكلة (بالعربي) أو null لو سليم. بنقفل التواريخ البعيدة غلط (قبل سنة / بعد سنتين). */
export function holidayIssue(date: string, reason: string, todayIso: string): string | null {
  if (!isRealDate(date)) return "التاريخ غير صالح";
  if (reason.trim().length < 2) return "اكتب سبب العطلة (حرفين على الأقل)";
  if (reason.trim().length > 120) return "السبب أطول من المسموح";
  const diff = (parse(date) - parse(todayIso)) / DAY;
  if (diff < -365) return "التاريخ قديم أوي";
  if (diff > 730) return "التاريخ بعيد أوي (أقصى حد سنتين)";
  return null;
}
