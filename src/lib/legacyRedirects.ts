/** @format */
// روابط الصفحات القديمة اللي اتشالت: الإشعارات والمفضلات القديمة لازم تفضل شغّالة.

/** `chat-staff.html?c=12` (إشعار قديم) → المحادثة نفسها في الواجهة الجديدة. */
export function chatStaffRedirectTarget(c: unknown): string {
  const raw = Array.isArray(c) ? c[0] : c;
  const id = typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : 0;
  return id > 0 ? `/v2/admin/portal-chat/${id}` : "/v2/admin/portal-chat";
}
