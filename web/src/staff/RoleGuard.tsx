import type { ComponentChildren } from "preact";
import { staffUser } from "../admin/session";
import { Forbidden } from "./SystemPages";

/** بيعرض الصفحة للأدوار المسموحة بس. الغلاف أصلًا بيحوّل غير المسجّلين لصفحة الدخول. */
export function RoleGuard({ roles, children }: { roles: readonly string[]; children: ComponentChildren }) {
  const u = staffUser();
  if (!u) return null;
  return roles.includes(u.role) ? <>{children}</> : <Forbidden />;
}
