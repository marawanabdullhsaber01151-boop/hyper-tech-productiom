import { t } from "../copy";
import { EmptyState, ToastProvider } from "../design/components";
import { ErrorBoundary } from "./ErrorBoundary";
import { Router, type RouteDef } from "./router";
import { NotFound, portalRoutes } from "../portal/routes";

/** الصفحات بتتسجّل هنا لما نبنيها (خطة 04 وما بعدها). */
export const routes: RouteDef[] = [...portalRoutes];

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <a class="sr-only" href="#main">
          {t("a11y.skip")}
        </a>
        <main id="main">
          <Router routes={routes} notFound={() => <NotFound />} />
        </main>
      </ToastProvider>
    </ErrorBoundary>
  );
}
