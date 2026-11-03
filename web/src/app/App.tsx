import type { ComponentType } from "preact";
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
import { PURCHASE_ROLES } from "../staff/purchasingCore";
import { ACTIVITY_PAGE_ROLES, CONTACT_ROLES, ENGINEERING_PAGE_ROLES, FOUNDATION_PAGE_ROLES, HEALTH_ROLES, OPERATIONS_ROLES, PLANNING_PAGE_ROLES, PRODUCTION_PAGE_ROLES, RECEIVING_PAGE_ROLES, SALES_PAGE_ROLES, STOCK_ROLES } from "../staff/staffRoles";
import { LazyPage } from "./lazyPage";

const loadSales = () => import("../staff/Sales").then((m) => m.Sales as ComponentType<{ key?: string }>);
const loadPurchases = () => import("../staff/Purchases").then((m) => m.Purchases as ComponentType<{ key?: string }>);
const loadContacts = () => import("../staff/Contacts").then((m) => m.Contacts as ComponentType<{ key?: string }>);
const loadOperations = () => import("../staff/Operations").then((m) => m.Operations as ComponentType<{ key?: string }>);
const loadProduction = () => import("../staff/Production").then((m) => m.Production as ComponentType<{ key?: string }>);
const loadFoundation = () => import("../staff/Foundation").then((m) => m.Foundation as ComponentType<{ key?: string }>);
const loadActivity = () => import("../staff/Activity").then((m) => m.Activity as ComponentType<Record<string, never>>);
const loadReceiving = () => import("../staff/Receiving").then((m) => m.Receiving as ComponentType<{ key?: string }>);
const loadPlanning = () => import("../staff/Planning").then((m) => m.Planning as ComponentType<{ key?: string }>);
const loadEngineering = () => import("../staff/Engineering").then((m) => m.Engineering as ComponentType<{ key?: string }>);
const loadStock = () => import("../staff/Stock").then((m) => m.Stock as ComponentType<{ key?: string }>);
const loadTasks = () => import("../staff/Tasks").then((m) => m.Tasks as ComponentType<{ key?: string }>);
const loadHealth = () => import("../staff/SystemHealth").then((m) => m.SystemHealth as ComponentType<Record<string, never>>);

/** صفحات الموظفين: كلها بتتعرض جوّه غلاف واحد (سايدبار + هيدر). أي صفحة جديدة بتتحط هنا. */
export const staffRoutes: RouteDef[] = [
  { path: "/staff", render: () => <Home /> },
  { path: "/staff/sales", render: () => <RoleGuard roles={SALES_PAGE_ROLES}><LazyPage key={location.search} load={loadSales} props={{}} /></RoleGuard> },
  { path: "/staff/purchases", render: () => <RoleGuard roles={PURCHASE_ROLES}><LazyPage key={location.search} load={loadPurchases} props={{}} /></RoleGuard> },
  { path: "/staff/contacts", render: () => <RoleGuard roles={CONTACT_ROLES}><LazyPage key={location.search} load={loadContacts} props={{}} /></RoleGuard> },
  { path: "/staff/operations", render: () => <RoleGuard roles={OPERATIONS_ROLES}><LazyPage key={location.search} load={loadOperations} props={{}} /></RoleGuard> },
  { path: "/staff/production", render: () => <RoleGuard roles={PRODUCTION_PAGE_ROLES}><LazyPage key={location.search} load={loadProduction} props={{}} /></RoleGuard> },
  { path: "/staff/activity", render: () => <RoleGuard roles={ACTIVITY_PAGE_ROLES}><LazyPage load={loadActivity} props={{}} /></RoleGuard> },
  { path: "/staff/receiving", render: () => <RoleGuard roles={RECEIVING_PAGE_ROLES}><LazyPage key={location.search} load={loadReceiving} props={{}} /></RoleGuard> },
  { path: "/staff/foundation", render: () => <RoleGuard roles={FOUNDATION_PAGE_ROLES}><LazyPage key={location.search} load={loadFoundation} props={{}} /></RoleGuard> },
  { path: "/staff/planning", render: () => <RoleGuard roles={PLANNING_PAGE_ROLES}><LazyPage load={loadPlanning} props={{}} /></RoleGuard> },
  { path: "/staff/engineering", render: () => <RoleGuard roles={ENGINEERING_PAGE_ROLES}><LazyPage key={location.search} load={loadEngineering} props={{}} /></RoleGuard> },
  { path: "/staff/stock", render: () => <RoleGuard roles={STOCK_ROLES}><LazyPage key={location.search} load={loadStock} props={{}} /></RoleGuard> },
  { path: "/staff/tasks", render: () => <LazyPage key={location.search} load={loadTasks} props={{}} /> },
  { path: "/staff/system-health", render: () => <RoleGuard roles={HEALTH_ROLES}><LazyPage load={loadHealth} props={{}} /></RoleGuard> },
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
