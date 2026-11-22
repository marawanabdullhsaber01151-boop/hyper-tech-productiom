import "../copy/guide";
import "../copy/guide2";
import "../copy/guide3";
import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { navigate } from "../app/router";
import { t, type CopyKey } from "../copy";
import { Button, EmptyState, Field, Input, InlineAlert, Select, Spinner, Tabs, useMediaQuery } from "../design/components";
import {
  ACC_TOPICS, AUTO_RULES, FLOWS, FLOW_STEP_H, FLOW_STEP_W, flowPos, flowViewBox, type FlowId, ORDER_H, ORDER_W,
  APPROVAL_FLOW, MAP_EDGES, NH, NW, edgeGeom, edgeLabelRoom, wrapEdgeLabel, nodeLabelLines, MAP_NODES, ORDER_EDGES, ORDER_POS, ORDER_STATES, RESOURCES,
  levelOf, pagesForRole, resourceReach, roleAbilities, slaHours, tierFor, tierViews,
  type GuideLive, type GuidePolicyGroup, type Level,
} from "./guideModel";
import { GLOSSARY, SCENARIOS, SCREENS, type ScreenDef } from "./guideScreens";
import "./Guide.css";

const k = (key: string) => key as CopyKey;
const val = (e: Event) => (e.target as HTMLInputElement).value;
const amountFmt = (v: string) => Number(v).toLocaleString("en-US");

/** دليل النظام: خرائط حية بتشرح الأقسام والصلاحيات والاعتمادات ورحلة أمر البيع. */
export function Guide() {
  const q = useQuery((signal) => api.get<GuideLive>("/guide/live", { signal }), []);
  const [tab, setTab] = useState("map");
  if (q.loading && !q.data) return <Spinner />;
  if (q.error || !q.data) {
    return (
      <div class="gd">
        <InlineAlert tone="danger">{t("guide.err")}</InlineAlert>
        <Button onClick={() => q.refetch()}>{t("guide.retry")}</Button>
      </div>
    );
  }
  const live = q.data;
  return (
    <div class="gd">
      <div class="gd-head">
        <h1 class="gd-title">{t("guide.title")}</h1>
        <p class="gd-sub">{t("guide.subtitle")}</p>
      </div>
      <Tabs
        label={t("guide.title")}
        wrap
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "map", label: t("guide.tab.map"), panel: <SystemMap live={live} /> },
          { id: "roles", label: t("guide.tab.roles"), panel: <Roles live={live} /> },
          { id: "approvals", label: t("guide.tab.approvals"), panel: <Approvals live={live} /> },
          { id: "order", label: t("guide.tab.order"), panel: <OrderJourney /> },
          { id: "production", label: t("guide.tab.production"), panel: <FlowChapter title="guide.prod.title" intro="guide.prod.intro" flows={["preq", "porder"]} /> },
          { id: "purchasing", label: t("guide.tab.purchasing"), panel: <FlowChapter title="guide.pur.title" intro="guide.pur.intro" flows={["po"]} /> },
          { id: "accounting", label: t("guide.tab.accounting"), panel: <Accounting /> },
          { id: "portal", label: t("guide.tab.portal"), panel: <FlowChapter title="guide.por.title" intro="guide.por.intro" flows={["portal"]} /> },
          { id: "screens", label: t("guide.tab.screens"), panel: <Screens live={live} /> },
          { id: "help", label: t("guide.tab.help"), panel: <Help /> },
        ]}
      />
    </div>
  );
}

/* ---------------- رسمة عامة: خريطة على الشاشات الكبيرة، وقايمة مريحة على الموبايل ---------------- */
export interface DNode { id: string; x: number; y: number; label: string; neg?: boolean }
export interface DEdge { from: string; to: string; label: string; neg?: boolean }

function EdgeText({ label, x, y, room }: { label: string; x: number; y: number; room: number }) {
  const lines = wrapEdgeLabel(label, room);
  return (
    <text class="gd-edge-t" x={x} y={y - (lines.length - 1) * 13} text-anchor="middle">
      {lines.map((ln, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : 13}>{ln}</tspan>)}
    </text>
  );
}

function NodeText({ label, x, y, w }: { label: string; x: number; y: number; w: number }) {
  const lines = nodeLabelLines(label, w);
  return (
    <text x={x} y={y + 5 - (lines.length - 1) * 9} text-anchor="middle">
      {lines.map((ln, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : 18}>{ln}</tspan>)}
    </text>
  );
}

function Diagram({ nodes, edges, w, h, vw, vh, aria, markerId, selected, onSelect, detail, pick }: {
  nodes: DNode[]; edges: DEdge[]; w: number; h: number; vw: number; vh: number; aria: string; markerId: string;
  selected: string | null; onSelect: (id: string) => void; detail: (id: string) => ComponentChildren; pick: string;
}) {
  const narrow = useMediaQuery("(max-width: 767px)");
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (narrow) {
    return (
      <ul class="gd-glist" aria-label={aria}>
        {nodes.map((n) => {
          const out = edges.filter((e) => e.from === n.id);
          const inn = edges.filter((e) => e.to === n.id);
          const open = selected === n.id;
          return (
            <li key={n.id} class={`gd-glist__item${open ? " gd-glist__item--on" : ""}${n.neg ? " gd-glist__item--neg" : ""}`}>
              <button type="button" class="gd-glist__head" aria-expanded={open} onClick={() => onSelect(open ? "" : n.id)}>{n.label}</button>
              {open ? (
                <div class="gd-glist__body">
                  {out.map((e) => <p class="gd-glist__rel" key={`o${e.to}${e.label}`}><b>{e.label}</b> ← {byId.get(e.to)?.label}</p>)}
                  {inn.map((e) => <p class="gd-glist__rel gd-glist__rel--in" key={`i${e.from}${e.label}`}>{t("guide.list.in", { from: byId.get(e.from)?.label ?? "", what: e.label })}</p>)}
                  <div class="gd-glist__detail">{detail(n.id)}</div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }
  const reversed = (f: string, to: string) => edges.some((e) => e.from === to && e.to === f);
  return (
    <>
      <div class="gd-scroll">
        <svg class="gd-svg" viewBox={`0 0 ${vw} ${vh}`} role="group" aria-label={aria}>
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="gd-arrow" /></marker>
          </defs>
          {edges.map((e) => {
            const a = byId.get(e.from)!, b = byId.get(e.to)!;
            const g = edgeGeom(a, b, w, h, reversed(e.from, e.to) ? 9 : 0);
            return (
              <g key={`${e.from}-${e.to}-${e.label}`} class={e.neg ? "gd-edge--cancel" : ""}>
                <line class="gd-edge" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} marker-end={`url(#${markerId})`} />
                <EdgeText label={e.label} x={g.lx} y={g.ly} room={edgeLabelRoom(g)} />
              </g>
            );
          })}
          {nodes.map((n) => (
            <g
              key={n.id}
              class={`gd-node${n.neg ? " gd-node--cancelled" : ""}${selected === n.id ? " gd-node--on" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={selected === n.id}
              onClick={() => onSelect(n.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(n.id))}
            >
              <rect x={n.x - w / 2} y={n.y - h / 2} width={w} height={h} rx="12" />
              <NodeText label={n.label} x={n.x} y={n.y} w={w} />
            </g>
          ))}
        </svg>
      </div>
      <div class="gd-card" aria-live="polite">{selected ? detail(selected) : <p class="gd-muted">{pick}</p>}</div>
    </>
  );
}

/* ---------------- خريطة النظام ---------------- */
function SystemMap({ live }: { live: GuideLive }) {
  const [sel, setSel] = useState<string | null>(null);
  const detail = (id: string) => {
    const nd = MAP_NODES.find((n) => n.id === id);
    const dept = nd?.dept ? live.nav.find((d) => d.id === nd.dept) : undefined;
    const pages = dept ? dept.subFunctions.flatMap((s) => s.pages) : [];
    return (
      <>
        <h3 class="gd-h3">{t(k(`guide.node.${id}`))}</h3>
        <p class="gd-p">{t(k(`guide.dept.${id}`))}</p>
        <h4 class="gd-h4">{t("guide.map.pages")}</h4>
        {pages.length === 0 ? (
          <p class="gd-muted">{t("guide.map.noPages")}</p>
        ) : (
          <ul class="gd-links">
            {pages.map((p) => (
              <li key={p.id + p.href}>
                <Button size="sm" variant="ghost" onClick={() => (p.href.startsWith("/v2/") ? navigate(p.href.slice(3)) : (location.href = p.href))}>{p.label}</Button>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  };
  return (
    <section class="gd-sec">
      <h2 class="gd-h">{t("guide.map.title")}</h2>
      <p class="gd-p">{t("guide.map.intro")}</p>
      <Diagram
        nodes={MAP_NODES.map((n) => ({ id: n.id, x: n.x, y: n.y, label: t(k(`guide.node.${n.id}`)) }))}
        edges={MAP_EDGES.map((e) => ({ from: e.from, to: e.to, label: t(k(`guide.edge.${e.key}`)) }))}
        w={NW} h={NH} vw={880} vh={520} aria={t("guide.map.label")} markerId="gd-arr" selected={sel} onSelect={(id) => setSel(id || null)} detail={detail} pick={t("guide.map.pick")}
      />
    </section>
  );
}

/* ---------------- الأدوار والصلاحيات ---------------- */
const LEVEL_MARK: Record<Level, string> = { none: "·", view: "○", write: "●" };

function Roles({ live }: { live: GuideLive }) {
  const [role, setRole] = useState<string>(live.roles[0]?.id ?? "");
  const me = live.roles.find((r) => r.id === role);
  const abilities = useMemo(() => roleAbilities(live.permissions, role), [live.permissions, role]);
  const pages = useMemo(() => pagesForRole(live.nav, role), [live.nav, role]);
  return (
    <section class="gd-sec">
      <h2 class="gd-h">{t("guide.roles.title")}</h2>
      <p class="gd-p">{t("guide.roles.intro")}</p>
      <ul class="gd-legend" aria-hidden="true">
        {(["write", "view", "none"] as const).map((l) => (
          <li key={l}><span class={`gd-lv gd-lv--${l}`}>{LEVEL_MARK[l]}</span> {t(k(`guide.level.${l}`))}</li>
        ))}
      </ul>
      <div class="gd-scroll">
        <table class="gd-table">
          <caption class="gd-cap">{t("guide.roles.matrix")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("guide.roles.role")}</th>
              {RESOURCES.map((r) => <th scope="col" key={r}>{t(k(`guide.res.${r}`))}</th>)}
            </tr>
          </thead>
          <tbody>
            {live.roles.map((r) => (
              <tr key={r.id} class={r.id === role ? "gd-row--on" : ""}>
                <th scope="row"><button type="button" class="gd-link" onClick={() => setRole(r.id)}>{r.label}</button></th>
                {RESOURCES.map((res) => {
                  const l = levelOf(live.permissions, res, r.id);
                  return <td key={res}><span class={`gd-lv gd-lv--${l}`} role="img" aria-label={t(k(`guide.level.${l}`))}>{LEVEL_MARK[l]}</span></td>;
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t("guide.roles.reach")}</th>
              {RESOURCES.map((res) => {
                const r = resourceReach(live.permissions, live.roles, res);
                return <td key={res} class="gd-reach">{r.write}/{r.write + r.view}</td>;
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="gd-card">
        <Field label={t("guide.roles.pick")}>
          <Select value={role} onChange={(e) => setRole(val(e))} options={live.roles.map((r) => ({ value: r.id, label: r.label }))} />
        </Field>
        {me ? (
          <>
            <h3 class="gd-h3">{me.label}</h3>
            <p class="gd-p">{t(k(`guide.role.${me.id}`))}</p>
            <p class="gd-p">{me.approver ? t("guide.roles.approver") : t("guide.roles.notApprover")}</p>
            <p class="gd-p">{me.exempt ? t("guide.roles.exempt") : t("guide.roles.notExempt")}</p>
            <h4 class="gd-h4">{t("guide.roles.can")}</h4>
            <ul class="gd-chips">
              {abilities.filter((a) => a.level !== "none").map((a) => (
                <li key={a.resource} class={`gd-chip gd-chip--${a.level}`}>{t(k(`guide.res.${a.resource}`))} · {t(k(`guide.level.${a.level}`))}</li>
              ))}
            </ul>
            <h4 class="gd-h4">{t("guide.roles.sees")}</h4>
            {pages.length === 0 ? (
              <EmptyState title={t("guide.roles.noPages")} />
            ) : (
              pages.map((d) => (
                <p class="gd-p" key={d.dept}><strong>{d.deptLabel}:</strong> {d.pages.map((p) => p.label).join(" · ")}</p>
              ))
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

/* ---------------- الاعتمادات ---------------- */
function Approvals({ live }: { live: GuideLive }) {
  const actions = live.policies;
  const [action, setAction] = useState(actions[0]?.actionKey ?? "");
  const [amount, setAmount] = useState("120000");
  const group: GuidePolicyGroup | undefined = actions.find((g) => g.actionKey === action);
  const n = Number(amount);
  const hit = group && Number.isFinite(n) && n >= 0 ? tierFor(group, n) : null;
  const label = (key: string) => t(k(`guide.act.${key}`)) === `guide.act.${key}` ? key : t(k(`guide.act.${key}`));
  const roleName = (id: string) => live.roles.find((r) => r.id === id)?.label ?? id;
  return (
    <section class="gd-sec">
      <h2 class="gd-h">{t("guide.apv.title")}</h2>
      <p class="gd-p">{t("guide.apv.intro")}</p>
      <ol class="gd-flow" aria-label={t("guide.apv.flowLabel")}>
        {APPROVAL_FLOW.map((s) => (
          <li key={s} class="gd-flow__step">
            <strong>{t(k(`guide.flow.${s}.t`))}</strong>
            <span>{t(k(`guide.flow.${s}.d`))}</span>
          </li>
        ))}
      </ol>
      <InlineAlert tone="warn">{t("guide.apv.escalate")}</InlineAlert>
      <p class="gd-p">{t("guide.apv.sla", { h: slaHours(live.sla.minutes), start: live.sla.hours.start, end: live.sla.hours.end })}</p>

      <h3 class="gd-h3">{t("guide.apv.rules")}</h3>
      <ul class="gd-rules">
        {(["self", "exempt", "reject", "deputy", "audit", "impact"] as const).map((r) => <li key={r}>{t(k(`guide.apv.rule.${r}`))}</li>)}
      </ul>

      <h3 class="gd-h3">{t("guide.apv.live")}</h3>
      <p class="gd-muted">{t("guide.apv.liveHint")}</p>
      {actions.length === 0 ? (
        <EmptyState title={t("guide.apv.noPolicies")} />
      ) : (
        actions.map((g) => (
          <div class="gd-card" key={g.actionKey}>
            <h4 class="gd-h4">{label(g.actionKey)}</h4>
            {tierViews(g).map((tv) => (
              <div class="gd-tier" key={tv.from}>
                <span class="gd-tier__range">{tv.to === null ? t("guide.apv.rangeLast", { from: amountFmt(tv.from) }) : t("guide.apv.range", { from: amountFmt(tv.from), to: amountFmt(tv.to) })}</span>
                <span class="gd-tier__steps">
                  {tv.steps.map((s, i) => (
                    <span class="gd-step" key={s.sequence}>
                      {i > 0 ? <em>{t("guide.apv.then")}</em> : null}
                      <b>{t("guide.apv.step", { n: s.sequence })}</b> {s.roles.map(roleName).join(" / ")}
                      {s.required > 1 ? <small> ({t("guide.apv.needs", { n: s.required })})</small> : null}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))
      )}

      {actions.length > 0 ? (
        <div class="gd-card">
          <h3 class="gd-h3">{t("guide.apv.try")}</h3>
          <p class="gd-muted">{t("guide.apv.tryHint")}</p>
          <div class="gd-try">
            <Field label={t("guide.apv.action")}>
              <Select value={action} onChange={(e) => setAction(val(e))} options={actions.map((g) => ({ value: g.actionKey, label: label(g.actionKey) }))} />
            </Field>
            <Field label={t("guide.apv.amount")}>
              <Input inputMode="decimal" value={amount} onInput={(e) => setAmount(val(e))} />
            </Field>
          </div>
          <p class="gd-p"><strong>{t("guide.apv.result")}</strong></p>
          {hit ? (
            <ol class="gd-seq">
              {hit.steps.map((s) => <li key={s.sequence}>{s.roles.map(roleName).join(" / ")}{s.required > 1 ? ` (${t("guide.apv.needs", { n: s.required })})` : ""}</li>)}
            </ol>
          ) : (
            <p class="gd-muted">{t("guide.apv.noMatch")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

/* ---------------- رحلة أمر البيع ---------------- */
function OrderJourney() {
  const [sel, setSel] = useState<string | null>(null);
  const detail = (id: string) => (
    <>
      <h3 class="gd-h3">{t(k(`guide.st.${id}`))}</h3>
      <dl class="gd-dl">
        {(["who", "stock", "money", "note"] as const).map((f) => (
          <div key={f}>
            <dt>{t(k(`guide.ord.${f}`))}</dt>
            <dd>{t(k(`guide.st.${id}.${f}`))}</dd>
          </div>
        ))}
      </dl>
    </>
  );
  return (
    <section class="gd-sec">
      <h2 class="gd-h">{t("guide.ord.title")}</h2>
      <p class="gd-p">{t("guide.ord.intro")}</p>
      <Diagram
        nodes={ORDER_STATES.map((s) => ({ id: s, x: ORDER_POS[s].x, y: ORDER_POS[s].y, label: t(k(`guide.st.${s}`)), neg: s === "cancelled" }))}
        edges={ORDER_EDGES.map((e) => ({ from: e.from, to: e.to, label: t(k(`guide.oe.${e.key}`)), neg: e.to === "cancelled" }))}
        w={ORDER_W} h={ORDER_H} vw={800} vh={300} aria={t("guide.ord.label")} markerId="gd-arr2" selected={sel} onSelect={(id) => setSel(id || null)} detail={detail} pick={t("guide.ord.pick")}
      />
    </section>
  );
}

/* ---------------- خرائط العمليات (المرحلة 2) ---------------- */
function FlowChapter({ title, intro, flows }: { title: string; intro: string; flows: FlowId[] }) {
  return (
    <section class="gd-sec">
      <h2 class="gd-h">{t(k(title))}</h2>
      <p class="gd-p">{t(k(intro))}</p>
      {flows.map((f) => <FlowMap key={f} flow={f} />)}
    </section>
  );
}

function FlowMap({ flow }: { flow: FlowId }) {
  const def = FLOWS[flow];
  const [sel, setSel] = useState<string | null>(null);
  const size = flowViewBox(def);
  const detail = (id: string) => (
    <>
      <h4 class="gd-h3">{t(k(`guide.fl.${flow}.s.${id}.n`))}</h4>
      <dl class="gd-dl">
        {(["who", "does", "note"] as const).map((f) => (
          <div key={f}>
            <dt>{t(k(`guide.fl.${f}`))}</dt>
            <dd>{t(k(`guide.fl.${flow}.s.${id}.${f}`))}</dd>
          </div>
        ))}
      </dl>
    </>
  );
  const neg = (id: string) => id === "cancelled" || id === "rejected";
  return (
    <div class="gd-flowbox">
      <h3 class="gd-h3">{t(k(`guide.fl.${flow}.title`))}</h3>
      <p class="gd-muted">{t(k(`guide.fl.${flow}.intro`))}</p>
      <Diagram
        nodes={def.steps.map((s) => ({ id: s.id, ...flowPos(s), label: t(k(`guide.fl.${flow}.s.${s.id}.n`)), neg: neg(s.id) }))}
        edges={def.edges.map((e) => ({ from: e.from, to: e.to, label: t(k(`guide.fl.${flow}.e.${e.key}`)), neg: neg(e.to) }))}
        w={FLOW_STEP_W} h={FLOW_STEP_H} vw={size.w} vh={size.h} aria={t("guide.fl.label")} markerId={`gd-arr-${flow}`} selected={sel} onSelect={(id) => setSel(id || null)} detail={detail} pick={t("guide.fl.pick")}
      />
    </div>
  );
}

function Accounting() {
  return (
    <section class="gd-sec">
      <h2 class="gd-h">{t("guide.acc.title")}</h2>
      <p class="gd-p">{t("guide.acc.intro")}</p>
      <h3 class="gd-h3">{t("guide.acc.topics")}</h3>
      <div class="gd-grid">
        {ACC_TOPICS.map((id) => (
          <div class="gd-card" key={id}>
            <h4 class="gd-h3">{t(k(`guide.acc.${id}.t`))}</h4>
            <p class="gd-p">{t(k(`guide.acc.${id}.d`))}</p>
          </div>
        ))}
      </div>
      <h3 class="gd-h3">{t("guide.acc.autoTitle")}</h3>
      <p class="gd-muted">{t("guide.acc.autoHint")}</p>
      <div class="gd-scroll">
        <table class="gd-table gd-table--text">
          <thead>
            <tr><th scope="col">{t("guide.acc.ev")}</th><th scope="col">{t("guide.acc.dr")}</th><th scope="col">{t("guide.acc.cr")}</th></tr>
          </thead>
          <tbody>
            {AUTO_RULES.map((r) => (
              <tr key={r}>
                <th scope="row">{t(k(`guide.acc.rule.${r}.ev`))}</th>
                <td>{t(k(`guide.acc.rule.${r}.dr`))}</td>
                <td>{t(k(`guide.acc.rule.${r}.cr`))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- فهرس الشاشات والأزرار + السيناريوهات والقاموس (المرحلة 3) ---------------- */
/** نص الشاشة كله (الاسم والشرح وأسماء الأزرار وشرحها) للبحث. */
export function screenText(s: ScreenDef): string {
  return [t(k(`guide.sc.${s.id}.t`)), t(k(`guide.sc.${s.id}.d`)), ...s.buttons.flatMap((b) => [t(k(`guide.sc.${s.id}.b.${b.id}.l`)), t(k(`guide.sc.${s.id}.b.${b.id}.e`))])].join(" ");
}

function Screens({ live }: { live: GuideLive }) {
  const [q, setQ] = useState("");
  const needle = q.trim();
  const role = staffUser()?.role;
  const pageOf = (id: string) => {
    for (const d of live.nav) for (const sf of d.subFunctions) for (const p of sf.pages) if (p.id === id) return p;
    return undefined;
  };
  const shown = SCREENS.filter((s) => !needle || screenText(s).includes(needle));
  return (
    <section class="gd-sec">
      <h2 class="gd-h">{t("guide.sc.title")}</h2>
      <p class="gd-p">{t("guide.sc.intro")}</p>
      <Field label={t("guide.sc.search")}>
        <Input type="search" value={q} onInput={(e) => setQ(val(e))} />
      </Field>
      {shown.length === 0 ? <EmptyState title={t("guide.sc.empty")} /> : null}
      {(["staff", "portal"] as const).map((side) => {
        const list = shown.filter((s) => s.side === side);
        if (list.length === 0) return null;
        return (
          <div class="gd-sidebox" key={side}>
            <h3 class="gd-h3">{t(k(`guide.sc.side.${side}`))}</h3>
            {list.map((s) => {
              const opens = s.pages.map(pageOf).filter((p): p is NonNullable<ReturnType<typeof pageOf>> => Boolean(p) && (!role || p!.roles.includes(role)));
              const uniq = opens.filter((p, i) => opens.findIndex((o) => o.href === p.href) === i);
              return (
                <article class="gd-card" key={s.id}>
                  <h4 class="gd-h3">{t(k(`guide.sc.${s.id}.t`))} <small class="gd-muted">{t("guide.sc.count", { n: s.buttons.length })}</small></h4>
                  <p class="gd-p">{t(k(`guide.sc.${s.id}.d`))}</p>
                  {uniq.length > 0 ? (
                    <p class="gd-opens"><span class="gd-muted">{t("guide.sc.opens")}:</span>{" "}
                      {uniq.map((p) => <Button key={p.href} size="sm" variant="ghost" onClick={() => (p.href.startsWith("/v2/") ? navigate(p.href.slice(3)) : (location.href = p.href))}>{p.label}</Button>)}
                    </p>
                  ) : null}
                  <div class="gd-scroll">
                    <table class="gd-table gd-table--text">
                      <thead><tr><th scope="col">{t("guide.sc.button")}</th><th scope="col">{t("guide.sc.effect")}</th></tr></thead>
                      <tbody>
                        {s.buttons.map((b) => (
                          <tr key={b.id}>
                            <th scope="row"><span class="gd-btnlabel">{t(k(`guide.sc.${s.id}.b.${b.id}.l`))}</span></th>
                            <td>{t(k(`guide.sc.${s.id}.b.${b.id}.e`))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

function Help() {
  return (
    <section class="gd-sec">
      <h2 class="gd-h">{t("guide.sn.title")}</h2>
      <p class="gd-p">{t("guide.sn.intro")}</p>
      <div class="gd-grid">
        {SCENARIOS.map((sn) => (
          <div class="gd-card" key={sn.id}>
            <h3 class="gd-h3">{t(k(`guide.sn.${sn.id}.t`))}</h3>
            <ol class="gd-seq">
              {Array.from({ length: sn.steps }, (_, i) => <li key={i}>{t(k(`guide.sn.${sn.id}.s${i + 1}`))}</li>)}
            </ol>
          </div>
        ))}
      </div>
      <h2 class="gd-h">{t("guide.gl.title")}</h2>
      <p class="gd-p">{t("guide.gl.intro")}</p>
      <dl class="gd-card gd-dl">
        {GLOSSARY.map((g) => (
          <div key={g}>
            <dt>{t(k(`guide.gl.${g}.t`))}</dt>
            <dd>{t(k(`guide.gl.${g}.d`))}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
