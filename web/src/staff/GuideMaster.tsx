import "../copy/guide6";
import "../copy/guide7";
import "../copy/foundation";
import { staffUser } from "../admin/session";
import { navigate } from "../app/router";
import { t, type CopyKey } from "../copy";
import { Button, InlineAlert } from "../design/components";
import { Fold, FoldTools, JumpBar } from "./GuideFold";
import { COMPARE_ROWS, MASTER_TABS, canSeeMaster, type MasterTab } from "./masterCatalog";

const k = (key: string) => key as CopyKey;
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function TabCard({ tab }: { tab: MasterTab }) {
  const b = `guide.md.${tab.id}`;
  return (
    <Fold id={`gd-md-${tab.id}`} title={t(k(`${b}.t`))} sub={t(k(`${b}.what`))} meta={tab.fields.length > 0 ? t("guide.fold.fields", { n: tab.fields.length }) : undefined}>
      <p class="gd-opens"><Button size="sm" variant="ghost" onClick={() => navigate("/staff/foundation")}>{t("guide.md.open")}: {t(k(tab.src))}</Button></p>
      <h4 class="gd-h4">{t("guide.md.how")}</h4>
      <ol class="gd-olist">{range(tab.steps).map((i) => <li key={i}>{t(k(`${b}.s.${i}`))}</li>)}</ol>
      {tab.fields.length > 0 ? (
        <>
          <h4 class="gd-h4">{t("guide.md.fields")}</h4>
          {tab.fields.map((f) => (
            <Fold level={2} key={f.id} id={`gd-md-${tab.id}-${f.id}`} title={t(k(`${b}.f.${f.id}.l`))}>
              <dl class="gd-gl">
                <div><dt>{t("guide.md.write")}</dt><dd>{t(k(`${b}.f.${f.id}.w`))}</dd></div>
                <div><dt>{t("guide.md.example")}</dt><dd>{t(k(`${b}.f.${f.id}.x`))}</dd></div>
                <div><dt>{t("guide.md.suggest")}</dt><dd>{t(k(`${b}.f.${f.id}.s`))}</dd></div>
                <div><dt>{t("guide.md.effect")}</dt><dd>{t(k(`${b}.f.${f.id}.e`))}</dd></div>
              </dl>
            </Fold>
          ))}
        </>
      ) : null}
      <h4 class="gd-h4">{t("guide.md.where")}</h4>
      <ul class="gd-ulist">{range(tab.effects).map((i) => <li key={i}>{t(k(`${b}.e.${i}`))}</li>)}</ul>
      <h4 class="gd-h4">{t("guide.md.tips")}</h4>
      <ul class="gd-ulist">{range(tab.tips).map((i) => <li key={i}>{t(k(`${b}.tip.${i}`))}</li>)}</ul>
    </Fold>
  );
}

/** تبويب «البيانات الأساسية»: شرح كل تبويب وكل خانة في الصفحة (لأصحاب الصفحة بس). */
export function GuideMaster() {
  const role = staffUser()?.role ?? "";
  if (!canSeeMaster(role)) {
    return <section class="gd-sec"><h2 class="gd-h">{t("guide.md.title")}</h2><InlineAlert tone="info">{t("guide.md.noAccess")}</InlineAlert></section>;
  }
  return (
    <section class="gd-sec" id="gd-master">
      <h2 class="gd-h">{t("guide.md.title")}</h2>
      <p class="gd-p">{t("guide.md.intro")}</p>
      <InlineAlert tone="info">{t("guide.md.order")}</InlineAlert>
      <InlineAlert tone="warn">{t("guide.md.honest")}</InlineAlert>
      <FoldTools scope="gd-master" />
      <JumpBar items={[{ id: "gd-md-cmp", label: t("guide.md.cmpTitle") }, ...MASTER_TABS.map((x) => ({ id: `gd-md-${x.id}`, label: t(k(`guide.md.${x.id}.t`)) }))]} />
      <Fold id="gd-md-cmp" open title={t("guide.md.cmpTitle")} sub={t("guide.md.cmpIntro")}>
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
      </Fold>
      {MASTER_TABS.map((tab) => <TabCard key={tab.id} tab={tab} />)}
    </section>
  );
}
