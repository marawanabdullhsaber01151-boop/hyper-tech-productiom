import { t } from "../copy";
import { ToastProvider } from "../design/components";
import { ErrorBoundary } from "./ErrorBoundary";
import { Router, usePath, type RouteDef } from "./router";
import { NotFound, portalRoutes } from "../portal/routes";
import { adminRoutes } from "../admin/routes";
import { Login } from "../staff/Login";
import { Home } from "../staff/Home";
import { StaffShell } from "../staff/StaffShell";
import { StaffNotFound } from "../staff/SystemPages";
import { RoleGuard } from "../staff/RoleGuard";
import { STOCK_ROLES, Stock } from "../staff/Stock";
import { SALES_PAGE_ROLES, Sales } from "../staff/Sales";
import { HEALTH_ROLES, SystemHealth } from "../staff/SystemHealth";

/** صفحات الموظفين: كلها بتتعرض جوّه غلاف واحد (سايدبار + هيدر). أي صفحة جديدة بتتحط هنا. */
export const staffRoutes: RouteDef[] = [
  { path: "/staff", render: () => <Home /> },
  { path: "/staff/sales", render: () => <RoleGuard roles={SALES_PAGE_ROLES}><Sales key={location.search} /></RoleGuard> },
  { path: "/staff/stock", render: () => <RoleGuard roles={STOCK_ROLES}><Stock key={location.search} /></RoleGuard> },
  { path: "/staff/system-health", render: () => <RoleGuard roles={HEALTH_ROLES}><SystemHealth /></RoleGuard> },
  ...adminRoutes,
];

/** الدخول والبوابة بره الغلاف. */
export const routes: RouteDef[] = [{ path: "/login", render: () => <Login /> }, ...portalRoutes, ...staffRoutes];

const isStaffPath = (p: string) => p === "/staff" || p.startsWith("/staff/") || p === "/admin" || p.startsWith("/admin/");

export function App() {
  const path = usePath();
  return (
    <ErrorBoundary resetKey={path}>
      <ToastProvider>
        <a class="sr-only" href="#main">
          {t("a11y.skip")}
        </a>
        {isStaffPath(path) ? (
          <StaffShell path={path}>
            <Router routes={staffRoutes} notFound={() => <StaffNotFound />} />
          </StaffShell>
        ) : (
          <main id="main">
            <Router routes={routes} notFound={() => <NotFound />} />
          </main>
        )}
      </ToastProvider>
    </ErrorBoundary>
  );
}
