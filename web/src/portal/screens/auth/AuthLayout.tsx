import type { ComponentChildren } from "preact";
import { t } from "../../../copy";
import { Card } from "../../../design/components";

export function AuthLayout({ title, sub, children, footer }: { title: string; sub?: string; children: ComponentChildren; footer?: ComponentChildren }) {
  return (
    <div class="pt-auth">
      <div class="pt-auth__box">
        <div class="pt-brand">
          <span class="pt-brand__mark" aria-hidden="true">
            HT
          </span>
          <div>
            <div class="pt-brand__name">{t("p.brand")}</div>
            <div class="pt-brand__tag">{t("p.tagline")}</div>
          </div>
        </div>
        <Card class="pt-auth__card" as="section">
          <div>
            <h1 class="pt-auth__title">{title}</h1>
            {sub ? <p class="pt-auth__sub">{sub}</p> : null}
          </div>
          {children}
        </Card>
        {footer ? <div class="pt-links">{footer}</div> : null}
      </div>
    </div>
  );
}
