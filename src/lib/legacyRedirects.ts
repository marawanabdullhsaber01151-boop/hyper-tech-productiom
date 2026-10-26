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

/** لوحة التحكم القديمة (`/` و`/index.html`) اتشالت: الرئيسية بقت `/v2/staff` (بتوجّه لتسجيل الدخول لو مفيش جلسة). */
export const LEGACY_HOME_PATHS = ["/", "/index.html"];
export const STAFF_HOME_PATH = "/v2/staff";

/** صفحتا المخزن وحركات المخزون القديمتان ← صفحة المخزون الموحدة (الحركات تبويب جواها). */
export const LEGACY_INVENTORY_PATH = "/inventory.html";
export const LEGACY_MOVEMENTS_PATH = "/movements.html";
export function inventoryRedirectTarget(rawQuery: string, movements = false): string {
  const from = new URLSearchParams(rawQuery);
  const out = new URLSearchParams();
  if (movements) {
    out.set("tab", "movements");
    const item = from.get("item") ?? from.get("item_id");
    if (item && /^\d{1,9}$/.test(item)) out.set("item", item);
  } else {
    const q = from.get("q");
    if (q && q.length <= 100) out.set("q", q);
  }
  const qs = out.toString();
  return qs ? `/v2/staff/stock?${qs}` : "/v2/staff/stock";
}

/** صفحة المواد الخام القديمة ← المخزون مفلتر على المواد الخام (الصفحتان كانتا نسخة واحدة من نفس البيانات). */
export const LEGACY_MATERIAL_PATH = "/material.html";
export const MATERIAL_REDIRECT_TARGET = "/v2/staff/stock?cat=raw_material";

/** صفحة الموردين والعملاء القديمة ← `/v2/staff/contacts`. بننقل `tab` (من قايمة معروفة) و`q` بس. */
export const LEGACY_CONTACTS_PATH = "/contacts.html";
export function contactsRedirectTarget(rawQuery: string): string {
  const from = new URLSearchParams(rawQuery);
  const out = new URLSearchParams();
  const tab = from.get("tab") ?? from.get("type");
  if (tab === "supplier" || tab === "customer") out.set("tab", tab);
  const q = from.get("q")?.trim();
  if (q && q.length <= 100) out.set("q", q);
  const qs = out.toString();
  return qs ? `/v2/staff/contacts?${qs}` : "/v2/staff/contacts";
}

/** صفحتا التشغيل القديمتان (كانتا نسختين من نفس الواجهة) ← مركز قيادة التشغيل. */
export const LEGACY_OPERATIONS_PATHS = ["/operations.html", "/operations-manager.html"];
export const OPERATIONS_REDIRECT_TARGET = "/v2/staff/operations";

/** صفحة المبيعات القديمة (`/sales.html?channel=website`) ← `/v2/staff/sales`. بننقل `channel` و`status` بس من قايمة معروفة. */
export const LEGACY_SALES_PATH = "/sales.html";
const SALES_STATUS_PARAMS = ["draft", "pending_approval", "confirmed", "shipped", "paid", "cancelled"];
export function salesRedirectTarget(rawQuery: string): string {
  const from = new URLSearchParams(rawQuery);
  const out = new URLSearchParams();
  const channel = from.get("channel");
  if (channel === "website" || channel === "direct") out.set("channel", channel);
  const status = from.get("status");
  if (status && SALES_STATUS_PARAMS.includes(status)) out.set("status", status);
  const qs = out.toString();
  return qs ? `/v2/staff/sales?${qs}` : "/v2/staff/sales";
}
