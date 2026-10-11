import { staffSession } from "../auth/staffSession";

/** الأدوار اللي مسموحلها تفتح الصفحة (السيرفر بيتحقق برضه). */
export const ADMIN_ROLES = ["chairman", "executive_manager", "sales_manager"] as const;

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

/** صفحة الدخول بتاعت الموظفين (القديمة). */
export const STAFF_LOGIN_URL = "/index.html";
export function goStaffLogin() {
  location.replace(STAFF_LOGIN_URL);
}
