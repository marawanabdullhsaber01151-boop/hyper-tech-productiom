/** @format */
// روابط الصفحات القديمة اللي اتشالت: الإشعارات والمفضلات القديمة لازم تفضل شغّالة.

/** `chat-staff.html?c=12` (إشعار قديم) → المحادثة نفسها في الواجهة الجديدة. */
export function chatStaffRedirectTarget(c: unknown): string {
  const raw = Array.isArray(c) ? c[0] : c;
  const id = typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : 0;
  return id > 0 ? `/v2/admin/portal-chat/${id}` : "/v2/admin/portal-chat";
}

/** صفحات بوابة العميل القديمة (اتشالت) ← مكانها في الواجهة الجديدة. */
const PORTAL_PAGES: Record<string, string> = {
  "/portal.html": "/v2/portal/home",
  "/portal-login.html": "/v2/portal/login",
  "/portal-activate.html": "/v2/portal/activate",
  "/portal-recover.html": "/v2/portal/recover",
  "/portal-chat.html": "/v2/portal/chat",
};
export const LEGACY_PORTAL_PATHS = Object.keys(PORTAL_PAGES);

/**
 * روابط التفعيل/الاستعادة اللي اتبعتت للعملاء قبل كده لازم تفضل شغّالة: بننقل `token` و`mode` بس
 * (وإشارة الشات `ctx`←`context`). أي باراميتر تاني بيتشال، والمسار ثابت من قايمة معروفة (مفيش open-redirect).
 */
export function portalRedirectTarget(pathname: string, rawQuery: string): string | null {
  const base = PORTAL_PAGES[pathname.toLowerCase()];
  if (!base) return null;
  const from = new URLSearchParams(rawQuery);
  const out = new URLSearchParams();
  const token = from.get("token");
  if (token && /^[A-Za-z0-9_.~-]{8,512}$/.test(token)) out.set("token", token);
  if (from.get("mode") === "reset") out.set("mode", "reset");
  const ctx = from.get("context") ?? from.get("ctx");
  if (ctx && /^(order|product|price_inquiry):\d{1,9}$/.test(ctx)) out.set("context", ctx);
  const qs = out.toString();
  return qs ? `${base}?${qs}` : base;
}
