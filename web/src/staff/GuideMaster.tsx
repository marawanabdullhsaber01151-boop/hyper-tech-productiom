import "../copy/guide6";
import "../copy/foundation";
import { staffUser } from "../admin/session";
import { navigate } from "../app/router";
import { t, type CopyKey } from "../copy";
import { Button, InlineAlert } from "../design/components";
import { COMPARE_ROWS, MASTER_TABS, canSeeMaster, type MasterTab } from "./masterCatalog";

const k = (key: string) => key as CopyKey;
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function TabCard({ tab }: { tab: MasterTab }) {
  const b = `guide.md.${tab.id}`;
  return (
    <article class="gd-card gd-man" id={`gd-md-${tab.id}`}>
      <h3 class="gd-h3">{t(k(`${b}.t`))}</h3>
      <p class="gd-opens"><Button size="sm" variant="ghost" onClick={() => navigate("/staff/foundation")}>{t("guide.md.open")}: {t(k(tab.src))}</Button></p>
      <p class="gd-p">{t(k(`${b}.what`))}</p>
      <h4 class="gd-h4">{t("guide.md.how")}</h4>
      <ol class="gd-olist">{range(tab.steps).map((i) => <li key={i}>{t(k(`${b}.s.${i}`))}</li>)}</ol>
      {tab.fields.length > 0 ? (
        <>
          <h4 class="gd-h4">{t("guide.md.fields")}</h4>
          {tab.fields.map((f) => (
            <div class="gd-card gd-field" key={f.id}>
              <p class="gd-p"><span class="gd-btnlabel">{t(k(`${b}.f.${f.id}.l`))}</span></p>
              <dl class="gd-gl">
                <div><dt>{t("guide.md.write")}</dt><dd>{t(k(`${b}.f.${f.id}.w`))}</dd></div>
                <div><dt>{t("guide.md.example")}</dt><dd>{t(k(`${b}.f.${f.id}.x`))}</dd></div>
                <div><dt>{t("guide.md.suggest")}</dt><dd>{t(k(`${b}.f.${f.id}.s`))}</dd></div>
                <div><dt>{t("guide.md.effect")}</dt><dd>{t(k(`${b}.f.${f.id}.e`))}</dd></div>
              </dl>
            </div>
          ))}
        </>
      ) : null}
      <h4 class="gd-h4">{t("guide.md.where")}</h4>
      <ul class="gd-ulist">{range(tab.effects).map((i) => <li key={i}>{t(k(`${b}.e.${i}`))}</li>)}</ul>
      <h4 class="gd-h4">{t("guide.md.tips")}</h4>
      <ul class="gd-ulist">{range(tab.tips).map((i) => <li key={i}>{t(k(`${b}.tip.${i}`))}</li>)}</ul>
    </article>
  );
}

/** تبويب «البيانات الأساسية»: شرح كل تبويب وكل خانة في الصفحة (لأصحاب الصفحة بس). */
export function GuideMaster() {
  const role = staffUser()?.role ?? "";
  if (!canSeeMaster(role)) {
    return <section class="gd-sec"><h2 class="gd-h">{t("guide.md.title")}</h2><InlineAlert tone="info">{t("guide.md.noAccess")}</InlineAlert></section>;
  }
  return (
    <section class="gd-sec">
      <h2 class="gd-h">{t("guide.md.title")}</h2>
      <p class="gd-p">{t("guide.md.intro")}</p>
      <InlineAlert tone="info">{t("guide.md.order")}</InlineAlert>
      <InlineAlert tone="warn">{t("guide.md.honest")}</InlineAlert>
      <div class="gd-card">
        <h3 class="gd-h3">{t("guide.md.cmpTitle")}</h3>
        <p class="gd-p">{t("guide.md.cmpIntro")}</p>
        <div class="gd-scroll">
          <table class="gd-table gd-table--text">
            <thead><tr><th scope="col">{t("guide.md.cmpAspect")}</th><th scope="col">{t("guide.md.cmpLoc")}</th><th scope="col">{t("guide.md.cmpCen")}</th></tr></thead>
            <tbody>
              {range(COMPARE_ROWS).map((i) => (
                <tr key={i}>
                  <th scope="row">{t(k(`guide.md.cmp.${i}.a`))}</th>
                  <td>{t(k(`guide.md.cmp.${i}.l`))}</td>
                  <td>{t(k(`guide.md.cmp.${i}.c`))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {MASTER_TABS.map((tab) => <TabCard key={tab.id} tab={tab} />)}
    </section>
  );
}
