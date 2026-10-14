import { useEffect, useState } from "preact/hooks";
import type { ComponentType } from "preact";
import { t } from "../copy";
import { EmptyState, Spinner } from "../design/components";
import type { RouteDef } from "../app/router";
import { ADMIN_ROLES, CHAT_ROLES, SALES_ROLES, goStaffLogin, staffUser } from "./session";
import "./admin.css";

/** حارس الصفحة: لازم جلسة موظف ودور مسموح. */
function Guard({ children, roles = ADMIN_ROLES }: { children: preact.ComponentChildren; roles?: readonly string[] }) {
  const u = staffUser();
  useEffect(() => {
    if (!u) goStaffLogin();
  }, [u]);
  if (!u) return <Spinner />;
  if (!roles.includes(u.role)) {
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

const chatConsole = () => import("./screens/ChatConsole").then((m) => m.ChatConsolePage as ComponentType<{ openId?: number }>);
const activation = () => import("./screens/ActivationRequests").then((m) => m.ActivationRequestsPage as ComponentType<{ openId?: number }>);
const orders = () => import("./screens/PortalOrders").then((m) => m.PortalOrdersPage as ComponentType<{ openRef?: string }>);

export const adminRoutes: RouteDef[] = [
  { path: "/admin/portal-customers", render: () => <Guard><Lazy load={companies} props={{}} /></Guard> },
  { path: "/admin/portal-customers/settings", render: () => <Guard><Lazy load={settings} props={{} as Record<string, never>} /></Guard> },
  { path: "/admin/portal-customers/:id", render: (p) => <Guard><Lazy load={companies} props={{ openId: Number(p.id) }} /></Guard> },
  { path: "/admin/portal-customers/:id/:tab", render: (p) => <Guard><Lazy load={companies} props={{ openId: Number(p.id), tab: p.tab }} /></Guard> },
  { path: "/admin/portal-applications", render: () => <Guard><Lazy load={applications} props={{}} /></Guard> },
  { path: "/admin/portal-applications/:id", render: (p) => <Guard><Lazy load={applications} props={{ openId: Number(p.id) }} /></Guard> },
  { path: "/admin/portal-activation-requests", render: () => <Guard><Lazy load={activation} props={{}} /></Guard> },
  { path: "/admin/portal-activation-requests/:id", render: (p) => <Guard><Lazy load={activation} props={{ openId: Number(p.id) }} /></Guard> },
  { path: "/admin/portal-chat", render: () => <Guard roles={CHAT_ROLES}><Lazy load={chatConsole} props={{}} /></Guard> },
  { path: "/admin/portal-chat/:id", render: (p) => <Guard roles={CHAT_ROLES}><Lazy load={chatConsole} props={{ openId: Number(p.id) }} /></Guard> },
  { path: "/admin/portal-orders", render: () => <Guard roles={SALES_ROLES}><Lazy load={orders} props={{}} /></Guard> },
  { path: "/admin/portal-orders/:ref", render: (p) => <Guard roles={SALES_ROLES}><Lazy load={orders} props={{ openRef: decodeURIComponent(p.ref ?? "") }} /></Guard> },
];
