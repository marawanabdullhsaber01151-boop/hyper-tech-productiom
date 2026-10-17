/** @format */
/**
 * إعداد `trust proxy` لـExpress من البيئة.
 *
 * ليه ضروري: على Vercel كل طلب بييجي من بروكسي. من غير الإعداد ده `req.ip` بيبقى عنوان البروكسي،
 * فكل المستخدمين بيتشاركوا نفس عدّاد الـrate-limit (٣٠٠ طلب/دقيقة للنظام كله، و١٠ محاولات دخول
 * لكل الناس)، وسجل التدقيق بيسجّل IP غلط. وممنوع `true` لأنه بيصدّق أي X-Forwarded-For من العميل
 * فيسهّل تخطي الحد.
 */
export type TrustProxySetting = false | number | string;

export function resolveTrustProxy(env: {
  TRUST_PROXY?: string;
  NODE_ENV?: string;
  VERCEL?: string;
}): TrustProxySetting {
  const raw = env.TRUST_PROXY?.trim();
  if (raw === undefined || raw === "") {
    return env.VERCEL || env.NODE_ENV === "production" ? 1 : false;
  }
  const lower = raw.toLowerCase();
  if (["false", "0", "off", "no"].includes(lower)) return false;
  if (["true", "on", "yes"].includes(lower)) {
    throw new Error(
      "TRUST_PROXY=true غير مسموح (بيصدّق أي X-Forwarded-For). اكتب عدد البروكسيات (مثلًا 1) أو قايمة عناوين موثوقة.",
    );
  }
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    if (hops > 10) throw new Error("TRUST_PROXY عدد بروكسيات غير منطقي");
    return hops;
  }
  return raw;
}
