import { useEffect } from "preact/hooks";
import "../../copy/portalGuide";
import "../../copy/portal";
import { t, type CopyKey } from "../../copy";
import { Card, InlineAlert } from "../../design/components";
import { Link } from "../../app/router";
import { markGuideSeen } from "../guideSeen";
import { grantedAbilities, missingAbilities, portalCatalog, type PCatalogSection, type PViewer } from "../portalGuideModel";
import { useAuth } from "../session";

const k = (key: string) => key as CopyKey;
const FIRST = [1, 2, 3, 4, 5];
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function Section({ entry }: { entry: PCatalogSection }) {
  const { section, steps, parts } = entry;
  const b = `pg.${section.id}`;
  return (
    <Card class="pt-stack pg-sec" pad id={`pg-${section.id}`}>
      <h2 class="pg-h">{t(k(`${b}.t`))}</h2>
      <p>{t(k(`${b}.what`))}</p>
      <p>
        <Link to={section.to}>{t("pg.open")}: {t(k(section.nav))}</Link>
      </p>
      <h3 class="pg-h3">{t("pg.how")}</h3>
      <ol class="pg-list">
        {steps.map((s) => (
          <li key={s.id}>{t(k(`${b}.s.${s.id}`))}</li>
        ))}
      </ol>
      {parts.length > 0 ? (
        <>
          <h3 class="pg-h3">{t("pg.buttons")}</h3>
          <dl class="pg-parts">
            {parts.map((p) => (
              <div key={p.id}>
                <dt>{t(k(`${b}.p.${p.id}.l`))}</dt>
                <dd>{t(k(`${b}.p.${p.id}.d`))}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      <h3 class="pg-h3">{t("pg.tips")}</h3>
      <ul class="pg-list">
        {range(section.tips).map((i) => (
          <li key={i}>{t(k(`${b}.tip.${i}`))}</li>
        ))}
      </ul>
    </Card>
  );
}

/** دليل البوابة: كل عضو بيشوف شرح الصفحات والأزرار اللي تحت صلاحياته بس. */
export function PortalGuide() {
  const auth = useAuth();
  const member = auth.member;
  const viewer: PViewer = { isOwner: !!member?.isOwner, permissions: member?.permissions ?? [] };
  const catalog = portalCatalog(viewer);
  const can = grantedAbilities(viewer);
  const cannot = missingAbilities(viewer);

  useEffect(() => {
    markGuideSeen(member?.id);
  }, [member?.id]);

  return (
    <div class="pt-stack">
      <h1 class="pt-page-title">{t("pg.title")}</h1>
      <p class="pt-muted">{t("pg.sub")}</p>
      <Card class="pt-stack" pad>
        <h2 class="pg-h">{t("pg.who")}</h2>
        <p>{viewer.isOwner ? t("pg.who.owner") : member?.roleName ? t("pg.who.member", { role: member.roleName }) : t("pg.who.noRole")}</p>
        <h3 class="pg-h3">{t("pg.can")}</h3>
        <ul class="pg-list">
          {can.map((key) => (
            <li key={key}>
              <strong>{t(k(`pg.ab.${key}.l`))}</strong>
              {": "}
              {t(k(`pg.ab.${key}.d`))}
            </li>
          ))}
        </ul>
        <h3 class="pg-h3">{t("pg.cannot")}</h3>
        {cannot.length === 0 ? (
          <p class="pt-muted">{t("pg.cannotNone")}</p>
        ) : (
          <>
            <ul class="pg-list">
              {cannot.map((key) => (
                <li key={key}>{t(k(`pg.ab.${key}.l`))}</li>
              ))}
            </ul>
            <InlineAlert tone="info">{t("pg.cannotHint")}</InlineAlert>
          </>
        )}
      </Card>
      <Card class="pt-stack" pad>
        <h2 class="pg-h">{t("pg.first")}</h2>
        <ol class="pg-list">
          {FIRST.map((i) => (
            <li key={i}>{t(k(`pg.first.${i}`))}</li>
          ))}
        </ol>
      </Card>
      {catalog.length === 0 ? (
        <InlineAlert tone="info">{t("pg.empty")}</InlineAlert>
      ) : (
        <>
          <nav aria-label={t("pg.sections")}>
            <ul class="pg-index">
              {catalog.map((e) => (
                <li key={e.section.id}>
                  <a href={`#pg-${e.section.id}`}>{t(k(`pg.${e.section.id}.t`))}</a>
                </li>
              ))}
            </ul>
          </nav>
          {catalog.map((e) => (
            <Section key={e.section.id} entry={e} />
          ))}
        </>
      )}
      <InlineAlert tone="info">{t("pg.honest")}</InlineAlert>
    </div>
  );
}
