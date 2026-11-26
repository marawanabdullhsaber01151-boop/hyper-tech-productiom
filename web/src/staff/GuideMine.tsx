import "../copy/guide";
import "../copy/guide3";
import "../copy/guide5";
import "../copy/guide7";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { navigate } from "../app/router";
import { t, type CopyKey } from "../copy";
import { Button, EmptyState, InlineAlert, Spinner } from "../design/components";
import type { GuideLive, GuideMine as Mine } from "./guideModel";
import { Fold, FoldTools, JumpBar, jumpTo } from "./GuideFold";
import { gateOpen, manualCatalog, MANUALS, type CatalogEntry, type Viewer } from "./guideManual";

const k = (key: string) => key as CopyKey;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB");
const untilText = (iso: string | null) => (iso ? t("guide.mine.until", { d: day(iso) }) : t("guide.mine.perm"));

function ManualCard({ e, viewer, shown, open }: { e: CatalogEntry; viewer: Viewer; shown: ReadonlySet<string>; open: boolean }) {
  const m = e.manual;
  const steps = m.steps.filter((x) => gateOpen(x, viewer));
  const parts = m.parts.filter((x) => gateOpen(x, viewer));
  const viaGrant = (g: { only?: readonly string[]; grant?: readonly string[] }) => Boolean(g.grant) && !g.only?.some((r) => viewer.roles.includes(r));
  const go = (id: string) => jumpTo(`gd-man-${id}`);
  return (
    <Fold id={`gd-man-${m.id}`} open={open} title={t(k(`guide.man.${m.id}.t`))} sub={t(k(`guide.man.${m.id}.what`))} meta={t("guide.fold.steps", { n: steps.length })}>
      {e.via === "grant" ? <InlineAlert tone="info">{t("guide.mine.viaGrant")}</InlineAlert> : null}
      {e.opens.length > 0 ? (
        <p class="gd-opens">
          {e.opens.map((p) => <Button key={p.href} size="sm" variant="ghost" onClick={() => (p.href.startsWith("/v2/") ? navigate(p.href.slice(3)) : (location.href = p.href))}>{t("guide.mine.opens")}: {p.label}</Button>)}
        </p>
      ) : null}
      <h4 class="gd-h4">{t("guide.mine.steps")}</h4>
      <ol class="gd-olist">
        {steps.map((x) => (
          <li key={x.id}>
            {t(k(`guide.man.${m.id}.s.${x.id}`))}
            {viaGrant(x) ? <small class="gd-tag">{t("guide.mine.gated")}</small> : null}
          </li>
        ))}
      </ol>
      {parts.length > 0 ? (
        <>
          <h4 class="gd-h4">{t("guide.mine.parts")}</h4>
          <div class="gd-scroll">
            <table class="gd-table gd-table--text">
              <thead><tr><th scope="col">{t("guide.mine.part")}</th><th scope="col">{t("guide.mine.partWhat")}</th></tr></thead>
              <tbody>
                {parts.map((x) => (
                  <tr key={x.id}>
                    <th scope="row"><span class="gd-btnlabel">{t(k(`guide.man.${m.id}.p.${x.id}.l`))}</span></th>
                    <td>{t(k(`guide.man.${m.id}.p.${x.id}.e`))}{viaGrant(x) ? <small class="gd-tag">{t("guide.mine.gated")}</small> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {m.links.length > 0 ? (
        <>
          <h4 class="gd-h4">{t("guide.mine.links")}</h4>
          <ul class="gd-ulist">
            {m.links.map((to) => {
              const name = MANUALS.some((x) => x.id === to) ? t(k(`guide.man.${to}.t`)) : t(k(`guide.sc.${to}.t`));
              return (
                <li key={to}>
                  {t(k(`guide.man.${m.id}.k.${to}`))}{" "}
                  {shown.has(to) ? <Button size="sm" variant="ghost" onClick={() => go(to)}>{t("guide.mine.linkTo", { name })}</Button> : <span class="gd-muted">({name})</span>}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {m.tips > 0 ? (
        <>
          <h4 class="gd-h4">{t("guide.mine.tips")}</h4>
          <ul class="gd-ulist">
            {Array.from({ length: m.tips }, (_, i) => <li key={i}>{t(k(`guide.man.${m.id}.tip.${i + 1}`))}</li>)}
          </ul>
        </>
      ) : null}
    </Fold>
  );
}

/** تبويب «كتالوجي»: شرح تفصيلي للصفحات اللي تخص دوري وصلاحياتي الفعلية (الممنوحة مؤقتًا أو دائمًا) بس. */
export function GuideMine({ live }: { live: GuideLive }) {
  const q = useQuery((signal) => api.get<Mine>("/guide/mine", { signal }), []);
  const role = staffUser()?.role ?? "";
  if (q.loading && !q.data) return <Spinner />;
  const mine = q.data;
  const grants = Array.isArray(mine?.grants) ? mine!.grants : [];
  const blocked = Array.isArray(mine?.blocked) ? mine!.blocked : [];
  const extraRoles = Array.isArray(mine?.extraRoles) ? mine!.extraRoles : [];
  const viewer: Viewer = { roles: [role, ...extraRoles], grants: grants.map((g) => g.key) };
  const entries = manualCatalog(live.nav, viewer);
  const shown = new Set(entries.map((e) => e.manual.id));
  const roleLabel = (id: string) => live.roles.find((r) => r.id === id)?.label ?? id;
  return (
    <section class="gd-sec" id="gd-mine">
      <h2 class="gd-h">{t("guide.mine.title")}</h2>
      <p class="gd-p">{t("guide.mine.intro")}</p>
      {q.error ? <InlineAlert tone="warn">{t("guide.mine.loadFail")}</InlineAlert> : null}
      <div class="gd-card">
        <p class="gd-p"><strong>{t("guide.mine.role", { role: roleLabel(role) })}</strong></p>
        {extraRoles.length > 0 ? <p class="gd-p">{t("guide.mine.extraRoles", { roles: extraRoles.map(roleLabel).join(", ") })}</p> : null}
        <h3 class="gd-h3">{t("guide.mine.grantsTitle")}</h3>
        {grants.length > 0 ? (
          <ul class="gd-ulist">
            {grants.map((g) => (
              <li key={g.key}><strong>{g.label}</strong> <span class="gd-muted">({t(k(`guide.mine.src.${g.source}`))}, {untilText(g.until)})</span></li>
            ))}
          </ul>
        ) : <p class="gd-muted">{t("guide.mine.grantsNone")}</p>}
        {blocked.length > 0 ? (
          <>
            <h3 class="gd-h3">{t("guide.mine.blockedTitle")}</h3>
            <ul class="gd-ulist">
              {blocked.map((g) => <li key={g.key}><strong>{g.label}</strong> <span class="gd-muted">({untilText(g.until)})</span></li>)}
            </ul>
            <p class="gd-muted">{t("guide.mine.blockedNote")}</p>
          </>
        ) : null}
      </div>
      {entries.length > 0 ? <FoldTools scope="gd-mine" /> : null}
      <JumpBar items={entries.map((e) => ({ id: `gd-man-${e.manual.id}`, label: t(k(`guide.man.${e.manual.id}.t`)) }))} />
      {entries.length === 0 ? <EmptyState title={t("guide.mine.empty")} /> : entries.map((e) => <ManualCard key={e.manual.id} e={e} viewer={viewer} shown={shown} open={entries.length <= 2} />)}
    </section>
  );
}
