import "../copy/guide";
import "../copy/guide2";
import { useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { navigate } from "../app/router";
import { t, type CopyKey } from "../copy";
import { Button, EmptyState, Field, Input, InlineAlert, Select, Spinner, Tabs } from "../design/components";
import {
  ACC_TOPICS, AUTO_RULES, FLOWS, FLOW_STEP_H, FLOW_STEP_W, flowPos, flowViewBox, type FlowId,
  APPROVAL_FLOW, MAP_EDGES, NH, NW, edgeEnds, MAP_NODES, ORDER_EDGES, ORDER_POS, ORDER_STATES, RESOURCES,
  levelOf, pagesForRole, resourceReach, roleAbilities, slaHours, tierFor, tierViews,
  type GuideLive, type GuidePolicyGroup, type Level, type MapNode, type OrderState,
} from "./guideModel";
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
        ]}
      />
    </div>
  );
}

/* ---------------- خريطة النظام ---------------- */
const nodeById = (id: string) => MAP_NODES.find((n) => n.id === id)!;

function SystemMap({ live }: { live: GuideLive }) {
  const [sel, setSel] = useState<MapNode | null>(null);
  const reversed = (f: string, to: string) => MAP_EDGES.some((e) => e.from === to && e.to === f);
  const dept = sel?.dept ? live.nav.find((d) => d.id === sel.dept) : undefined;
  const pages = dept ? dept.subFunctions.flatMap((s) => s.pages) : [];
  return (
    <section class="gd-sec">
      <h2 class="gd-h">{t("guide.map.title")}</h2>
      <p class="gd-p">{t("guide.map.intro")}</p>
      <div class="gd-scroll">
        <svg class="gd-svg" viewBox="0 0 880 500" role="group" aria-label={t("guide.map.label")}>
          <defs>
            <marker id="gd-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="gd-arrow" /></marker>
          </defs>
          {MAP_EDGES.map((e) => {
            const a = nodeById(e.from), b = nodeById(e.to);
            const p = edgeEnds(a, b, reversed(e.from, e.to) ? 9 : 0);
            return (
              <g key={`${e.from}-${e.to}`}>
                <line class="gd-edge" x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} marker-end="url(#gd-arr)" />
                <text class="gd-edge-t" x={(p.x1 + p.x2) / 2} y={(p.y1 + p.y2) / 2 - 5} text-anchor="middle">{t(k(`guide.edge.${e.key}`))}</text>
              </g>
            );
          })}
          {MAP_NODES.map((n) => (
            <g
              key={n.id}
              class={`gd-node${sel?.id === n.id ? " gd-node--on" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={sel?.id === n.id}
              onClick={() => setSel(n)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(n))}
            >
              <rect x={n.x - NW / 2} y={n.y - NH / 2} width={NW} height={NH} rx="12" />
              <text x={n.x} y={n.y + 5} text-anchor="middle">{t(k(`guide.node.${n.id}`))}</text>
            </g>
          ))}
        </svg>
      </div>
      <div class="gd-card" aria-live="polite">
        {!sel ? (
          <p class="gd-muted">{t("guide.map.pick")}</p>
        ) : (
          <>
            <h3 class="gd-h3">{t(k(`guide.node.${sel.id}`))}</h3>
            <p class="gd-p">{t(k(`guide.dept.${sel.id}`))}</p>
            <h4 class="gd-h4">{t("guide.map.pages")}</h4>
            {pages.length === 0 ? (
              <p class="gd-muted">{t("guide.map.noPages")}</p>
            ) : (
              <ul class="gd-links">
                {pages.map((p) => (
                  <li key={p.id}>
                    <Button size="sm" variant="ghost" onClick={() => (p.href.startsWith("/v2/") ? navigate(p.href.slice(3)) : (location.href = p.href))}>{p.label}</Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
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
const OW = 130, OH = 50;
function OrderJourney() {
  const [sel, setSel] = useState<OrderState | null>(null);
  return (
    <section class="gd-sec">
      <h2 class="gd-h">{t("guide.ord.title")}</h2>
      <p class="gd-p">{t("guide.ord.intro")}</p>
      <div class="gd-scroll">
        <svg class="gd-svg" viewBox="0 0 800 300" role="group" aria-label={t("guide.ord.label")}>
          <defs>
            <marker id="gd-arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="gd-arrow" /></marker>
          </defs>
          {ORDER_EDGES.map((e) => {
            const a = ORDER_POS[e.from], b = ORDER_POS[e.to];
            const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
            const tt = Math.min(dx === 0 ? Infinity : OW / 2 / Math.abs(dx), dy === 0 ? Infinity : OH / 2 / Math.abs(dy)) * len;
            const x1 = a.x + (dx / len) * tt, y1 = a.y + (dy / len) * tt, x2 = b.x - (dx / len) * tt, y2 = b.y - (dy / len) * tt;
            return (
              <g key={`${e.from}-${e.to}`} class={e.to === "cancelled" ? "gd-edge--cancel" : ""}>
                <line class="gd-edge" x1={x1} y1={y1} x2={x2} y2={y2} marker-end="url(#gd-arr2)" />
                <text class="gd-edge-t" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5} text-anchor="middle">{t(k(`guide.oe.${e.key}`))}</text>
              </g>
            );
          })}
          {ORDER_STATES.map((s) => {
            const p = ORDER_POS[s];
            return (
              <g
                key={s}
                class={`gd-node gd-node--${s}${sel === s ? " gd-node--on" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={sel === s}
                onClick={() => setSel(s)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(s))}
              >
                <rect x={p.x - OW / 2} y={p.y - OH / 2} width={OW} height={OH} rx="12" />
                <text x={p.x} y={p.y + 5} text-anchor="middle">{t(k(`guide.st.${s}`))}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div class="gd-card" aria-live="polite">
        {!sel ? (
          <p class="gd-muted">{t("guide.ord.pick")}</p>
        ) : (
          <>
            <h3 class="gd-h3">{t(k(`guide.st.${sel}`))}</h3>
            <dl class="gd-dl">
              {(["who", "stock", "money", "note"] as const).map((f) => (
                <div key={f}>
                  <dt>{t(k(`guide.ord.${f}`))}</dt>
                  <dd>{t(k(`guide.st.${sel}.${f}`))}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
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
  const pos = (id: string) => flowPos(def.steps.find((s) => s.id === id)!);
  const reversed = (a: string, b: string) => def.edges.some((e) => e.from === b && e.to === a);
  return (
    <div class="gd-flowbox">
      <h3 class="gd-h3">{t(k(`guide.fl.${flow}.title`))}</h3>
      <p class="gd-muted">{t(k(`guide.fl.${flow}.intro`))}</p>
      <div class="gd-scroll">
        <svg class="gd-svg" viewBox={`0 0 ${size.w} ${size.h}`} role="group" aria-label={t("guide.fl.label")} style={{ minInlineSize: `${Math.min(size.w, 620)}px` }}>
          <defs>
            <marker id={`gd-arr-${flow}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="gd-arrow" /></marker>
          </defs>
          {def.edges.map((e) => {
            const a = pos(e.from), b = pos(e.to);
            const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
            const ux = dx / len, uy = dy / len;
            const tt = Math.min(dx === 0 ? Infinity : FLOW_STEP_W / 2 / Math.abs(dx), dy === 0 ? Infinity : FLOW_STEP_H / 2 / Math.abs(dy)) * len;
            const off = reversed(e.from, e.to) ? 8 : 0;
            const x1 = a.x + ux * tt - uy * off, y1 = a.y + uy * tt + ux * off, x2 = b.x - ux * tt - uy * off, y2 = b.y - uy * tt + ux * off;
            const neg = e.to === "cancelled" || e.to === "rejected";
            return (
              <g key={`${e.from}-${e.to}-${e.key}`} class={neg ? "gd-edge--cancel" : ""}>
                <line class="gd-edge" x1={x1} y1={y1} x2={x2} y2={y2} marker-end={`url(#gd-arr-${flow})`} />
                <text class="gd-edge-t" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5} text-anchor="middle">{t(k(`guide.fl.${flow}.e.${e.key}`))}</text>
              </g>
            );
          })}
          {def.steps.map((s) => {
            const p = flowPos(s);
            return (
              <g
                key={s.id}
                class={`gd-node${s.id === "cancelled" || s.id === "rejected" ? " gd-node--cancelled" : ""}${sel === s.id ? " gd-node--on" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={sel === s.id}
                onClick={() => setSel(s.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(s.id))}
              >
                <rect x={p.x - FLOW_STEP_W / 2} y={p.y - FLOW_STEP_H / 2} width={FLOW_STEP_W} height={FLOW_STEP_H} rx="12" />
                <text x={p.x} y={p.y + 5} text-anchor="middle">{t(k(`guide.fl.${flow}.s.${s.id}.n`))}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div class="gd-card" aria-live="polite">
        {!sel ? (
          <p class="gd-muted">{t("guide.fl.pick")}</p>
        ) : (
          <>
            <h4 class="gd-h3">{t(k(`guide.fl.${flow}.s.${sel}.n`))}</h4>
            <dl class="gd-dl">
              {(["who", "does", "note"] as const).map((f) => (
                <div key={f}>
                  <dt>{t(k(`guide.fl.${f}`))}</dt>
                  <dd>{t(k(`guide.fl.${flow}.s.${sel}.${f}`))}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
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
