/** @format */
/**
 * أرشفة شركات البوابة — القواعد النقية (من غير قاعدة بيانات عشان تتختبر بسهولة).
 *
 * ثلاث مستويات:
 *   إيقاف  (is_active=false)           مؤقت، الشركة تفضل في القوايم.
 *   أرشفة  (archived_at مش NULL)       الشركة قررت ما تتعاملش معانا: موقوفة + مخفية، وكل بياناتها محفوظة وتترجع.
 *   حذف نهائي                          للحسابات اللي مالهاش أي طلبات أو فواتير بس (القاعدة الموجودة).
 */

export type PortalCompanyStatus = "archived" | "suspended" | "active" | "not_activated";

export function derivePortalCompanyStatus(row: {
  isActive: boolean;
  activatedAt: Date | string | null;
  archivedAt: Date | string | null;
}): PortalCompanyStatus {
  if (row.archivedAt) return "archived";
  if (!row.isActive) return "suspended";
  return row.activatedAt ? "active" : "not_activated";
}

export const ARCHIVE_REASON_MIN = 3;
export const ARCHIVE_REASON_MAX = 500;

/** يتحقق من سبب الأرشفة (إجباري عشان يفضل واضح ليه الشركة اتأرشفت). */
export function parseArchiveReason(
  input: unknown,
): { ok: true; reason: string } | { ok: false; message: string } {
  const reason = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  if (reason.length < ARCHIVE_REASON_MIN) {
    return { ok: false, message: "اكتب سبب الأرشفة (٣ حروف على الأقل)" };
  }
  if (reason.length > ARCHIVE_REASON_MAX) {
    return { ok: false, message: `سبب الأرشفة أطول من ${ARCHIVE_REASON_MAX} حرف` };
  }
  return { ok: true, reason };
}

/**
 * حالات الطلب اللي تتعتبر منتهية. أي حالة تانية = طلب شغّال.
 * (اتجمعت من القايمتين الموجودتين في cancellation.ts وdueDateSuggestion.ts عشان القايمتين مختلفين.)
 */
export const FINISHED_ORDER_STATUSES = [
  "completed",
  "closed",
  "shipped",
  "delivered",
  "delivered_customer",
  "delivered_warehouse",
  "cancelled",
] as const;

/** الأرشفة مع وجود طلبات شغّالة تحتاج تأكيد صريح من الموظف. */
export function archiveNeedsOpenOrdersConfirmation(
  openOrders: number,
  acknowledged: boolean,
): boolean {
  return openOrders > 0 && !acknowledged;
}

/** الاسترجاع بيرجّع الشركة مفعّلة، ويجبرها تغيّر كلمة السر (الحساب كان مقفول فترة). */
export function restoredCompanyFields(): { isActive: true; mustChangePassword: true } {
  return { isActive: true, mustChangePassword: true };
}

/** هل يُسمح بإعادة تفعيل (reactivate) عادي؟ المؤرشفة لازم ترجع بالاسترجاع الصريح. */
export function canPlainReactivate(archivedAt: Date | string | null): boolean {
  return !archivedAt;
}
