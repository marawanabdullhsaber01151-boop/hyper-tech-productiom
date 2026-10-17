/** @format */
/**
 * تهدئة تحديث «آخر نشاط» للجلسة.
 *
 * قبل: كل طلب API كان بيعمل UPDATE على login_sessions (والشات بيعمل polling كل ثواني)،
 * يعني كتابة قاعدة بيانات مع كل قراءة. الدقة المطلوبة للخمول/آخر ظهور بالدقيقة، فمفيش داعي لأكتر.
 */
export const SESSION_TOUCH_INTERVAL_MS = 60_000;

export function shouldTouchSession(
  lastActiveAt: Date | null | undefined,
  now: Date = new Date(),
  intervalMs: number = SESSION_TOUCH_INTERVAL_MS,
): boolean {
  if (!lastActiveAt) return true;
  const age = now.getTime() - lastActiveAt.getTime();
  // ساعة الجهاز اللي كتب القيمة ممكن تسبق ساعتنا (age < 0): نحدّث عشان نصحّح بدل ما نفضل ساكتين.
  return age < 0 || age >= intervalMs;
}
