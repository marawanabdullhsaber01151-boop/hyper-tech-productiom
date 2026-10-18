import { staffSession } from "../auth/staffSession";

/** الأدوار اللي مسموحلها تفتح الصفحة (السيرفر بيتحقق برضه). */
export const ADMIN_ROLES = ["chairman", "executive_manager", "sales_manager"] as const;

/** اللي ممكن يفتح محادثات العملاء (السيرفر بيحدد الوضع الفعلي لكل واحد). */
export const CHAT_ROLES = [...ADMIN_ROLES, "online_seller", "offline_seller", "hr", "hr_manager"] as const;

/** اللي ممكن يفتح طلبات البوابة (السيرفر بيتحقق برضه). */
export const SALES_ROLES = [...ADMIN_ROLES, "online_seller", "offline_seller", "hr", "hr_manager"] as const;

export interface StaffUser {
  id: number;
  username: string;
  fullName: string;
  role: string;
}

export function staffUser(): StaffUser | null {
  const s = staffSession.get() as { user?: StaffUser } | null;
  return s?.user ?? null;
}

/** صفحة الدخول الموحّدة للموظفين. */
export const STAFF_LOGIN_URL = "/v2/login";
export function goStaffLogin() {
  const here = location.pathname + location.search;
  // لو إحنا أصلًا في صفحة الدخول ما نضيفش next (بيمنع لفّة تحويل).
  location.replace(here.startsWith(STAFF_LOGIN_URL) ? STAFF_LOGIN_URL : `${STAFF_LOGIN_URL}?next=${encodeURIComponent(here)}`);
}
