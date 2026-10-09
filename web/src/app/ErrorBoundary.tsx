import type { ComponentChildren } from "preact";
import { useErrorBoundary } from "preact/hooks";
import { t } from "../copy";
import { Button } from "../design/components";

/** أي خطأ في الرسم بيظهر كشاشة مفهومة بدل صفحة بيضا. */
export function ErrorBoundary({ children }: { children: ComponentChildren }) {
  const [error, reset] = useErrorBoundary((e) => {
    // eslint-disable-next-line no-console
    console.error("[ui]", e);
  });
  if (!error) return <>{children}</>;
  return (
    <div class="ht-empty" role="alert">
      <h1 class="ht-empty__title">{t("error.boundary.title")}</h1>
      <p class="ht-empty__desc">{t("error.boundary.body")}</p>
      <Button
        onClick={() => {
          reset();
          location.reload();
        }}
      >
        {t("error.boundary.reload")}
      </Button>
    </div>
  );
}
