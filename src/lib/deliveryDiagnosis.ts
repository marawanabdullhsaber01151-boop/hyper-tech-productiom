/** @format */
// تشخيص فشل الرسائل: بيحوّل أكواد الأخطاء الخام لجملة بسيطة تقول السبب وإيه المطلوب (دوال نقية، من غير قاعدة بيانات).

const CHANNEL: Record<string, string> = { sms: "الرسائل النصية", email: "الإيميل", telegram: "تيليجرام", whatsapp: "واتساب" };
export const channelText = (c: string | null | undefined): string => (c ? CHANNEL[c] ?? c : "قناة غير معروفة");

/** كود الخطأ ← سبب بشري. http_401/403 = المفتاح غلط أو الحساب موقوف، 4xx = الطلب مرفوض، 5xx = المزوّد واقع. */
export function errorCodeText(code: string | null | undefined): string {
  const c = (code ?? "").trim();
  if (!c || c === "failed") return "فشل بدون سبب واضح";
  if (c === "request_failed") return "المزوّد ما ردّش (مهلة أو انقطاع اتصال)";
  if (c === "provider_failed") return "المزوّد رفض الإرسال";
  if (c === "exception") return "خطأ غير متوقع أثناء الإرسال";
  if (c === "not_configured") return "القناة مش متضبطة";
  const m = /^http_(\d{3})$/.exec(c);
  if (m) {
    const n = Number(m[1]);
    if (n === 401 || n === 403) return "مفتاح المزوّد مرفوض (غلط أو منتهي أو الحساب موقوف)";
    if (n === 429) return "عدّيت الحد المسموح عند المزوّد (الباقة المجانية)";
    if (n >= 500) return "المزوّد نفسه واقع دلوقتي";
    if (n >= 400) return "المزوّد رفض الطلب (راجع عنوان المرسل أو الرقم)";
  }
  return `فشل (${c})`;
}

export interface FailureRow { channel: string | null; error_code: string | null; n: number }
/** أمثلة للعرض: «الإيميل: مفتاح المزوّد مرفوض … ×٢». الأكتر تكرارًا أولًا، وبحد أقصى `max`. */
export function summarizeFailures(rows: readonly FailureRow[], max = 5): string[] {
  const merged = new Map<string, number>();
  for (const r of rows) {
    const k = `${channelText(r.channel)}: ${errorCodeText(r.error_code)}`;
    merged.set(k, (merged.get(k) ?? 0) + Number(r.n || 0));
  }
  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar"))
    .slice(0, max)
    .map(([k, n]) => (n > 1 ? `${k} (×${n})` : k));
}

export interface DeadRow { event_type: string; last_error: string | null; n: number }
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export function summarizeDead(rows: readonly DeadRow[], max = 5): string[] {
  return [...rows]
    .sort((a, b) => Number(b.n) - Number(a.n) || a.event_type.localeCompare(b.event_type))
    .slice(0, max)
    .map((r) => `${r.event_type}: ${clip((r.last_error ?? "").replace(/\s+/g, " ").trim() || "من غير رسالة خطأ")}${Number(r.n) > 1 ? ` (×${r.n})` : ""}`);
}

/** أكتر مشاكل الإعداد شيوعًا: لو القنوات كلها مش متضبطة بنقول كده بدل «فشل». */
export function configHint(configured: { sms: boolean; email: boolean }): string | null {
  if (!configured.sms && !configured.email) return "لا الرسائل النصية ولا الإيميل متضبطين على السيرفر، فكود التفعيل مابيتبعتش بأي قناة.";
  return null;
}
