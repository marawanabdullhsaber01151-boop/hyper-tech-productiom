import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useErrorBoundary } from "preact/hooks";
import { t } from "../copy";
import { Button } from "../design/components";

/** أي خطأ في الرسم بيظهر كشاشة مفهومة بدل صفحة بيضا. */
export function ErrorBoundary({ children, resetKey }: { children: ComponentChildren; resetKey?: string }) {
  const [error, reset] = useErrorBoundary((e) => {
    // eslint-disable-next-line no-console
    console.error("[ui]", e);
  });
  // لما المستخدم ينتقل لصفحة تانية، الخطأ القديم يتشال (من غير ما يحتاج ريفريش).
  const last = useRef(resetKey);
  useEffect(() => {
    if (last.current !== resetKey) {
      last.current = resetKey;
      if (error) reset();
    }
  }, [resetKey, error, reset]);
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
