import { useEffect, useState } from "preact/hooks";
import type { ComponentType } from "preact";
import { t } from "../copy";
import { EmptyState, Spinner } from "../design/components";
import type { RouteDef } from "../app/router";
import { ADMIN_ROLES, goStaffLogin, staffUser } from "./session";
import "./admin.css";

/** حارس الصفحة: لازم جلسة موظف ودور مسموح. */
function Guard({ children }: { children: preact.ComponentChildren }) {
  const u = staffUser();
  useEffect(() => {
    if (!u) goStaffLogin();
  }, [u]);
  if (!u) return <Spinner />;
  if (!(ADMIN_ROLES as readonly string[]).includes(u.role)) {
    return <div class="ad-page"><EmptyState title={t("a.forbidden.title")} description={t("a.forbidden.body")} /></div>;
  }
  return <>{children}</>;
}

/** بنحمّل شاشات الإدارة عند الطلب عشان حجم تطبيق العميل ما يزيدش. */
function Lazy<P extends object>({ load, props }: { load: () => Promise<ComponentType<P>>; props: P }) {
  const [C, setC] = useState<ComponentType<P> | null>(null);
  // لما الشاشة تتبدّل (مثلًا من قايمة الشركات للإعدادات) لازم نحمّل الشاشة الجديدة، مش نفضل على القديمة.
  useEffect(() => {
    let alive = true;
    setC(null);
    void load().then((c) => alive && setC(() => c));
    return () => {
      alive = false;
    };
  }, [load]);
  return C ? <C {...props} /> : <Spinner />;
}

const companies = () => import("./screens/Companies").then((m) => m.CompaniesPage as ComponentType<{ openId?: number; tab?: string }>);
const settings = () => import("./screens/PortalSettings").then((m) => m.PortalSettingsPage as ComponentType<Record<string, never>>);

const applications = () => import("./screens/Applications").then((m) => m.ApplicationsPage as ComponentType<{ openId?: number }>);

export const adminRoutes: RouteDef[] = [
  { path: "/admin/portal-customers", render: () => <Guard><Lazy load={companies} props={{}} /></Guard> },
  { path: "/admin/portal-customers/settings", render: () => <Guard><Lazy load={settings} props={{} as Record<string, never>} /></Guard> },
  { path: "/admin/portal-customers/:id", render: (p) => <Guard><Lazy load={companies} props={{ openId: Number(p.id) }} /></Guard> },
  { path: "/admin/portal-customers/:id/:tab", render: (p) => <Guard><Lazy load={companies} props={{ openId: Number(p.id), tab: p.tab }} /></Guard> },
  { path: "/admin/portal-applications", render: () => <Guard><Lazy load={applications} props={{}} /></Guard> },
  { path: "/admin/portal-applications/:id", render: (p) => <Guard><Lazy load={applications} props={{ openId: Number(p.id) }} /></Guard> },
];
