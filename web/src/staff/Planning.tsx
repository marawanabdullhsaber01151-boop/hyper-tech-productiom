import "../copy/planning";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t } from "../copy";
import { Button, ConfirmDialog, DataTable, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, Tabs, type Column } from "../design/components";
import { Plus } from "../design/icons";
import { formatDate, formatNumber } from "../lib/format";
import {
  addDaysISO, canPlan, duplicateRecipes, emptyLine, explodePayload, formulaParts, lineError, linesValid, pendingShortages, requisitionByRequirement, runActions, runPayload, todayISO, canSavePreview,
  type LineDraft, type Preview, type PreviewDemand, type RunDetail, type RunRow, type RunShortage,
} from "./planningCore";
import "./Engineering.css";
import "./Planning.css";

interface RecipeOption { id: number; productName: string; productCode: string | null; outputQty: string }

const val = (e: Event) => (e.target as HTMLInputElement).value;
const n3 = (s: string) => formatNumber(Number(s));
const RECIPES_HREF = "/v2/staff/engineering?tab=recipes";

/** تخطيط الخامات: سيناريو جديد (فرد الوصفات + معاينة + حفظ) وسيناريوهات محفوظة (اعتماد/تسليم/طلبات شراء). */
export function Planning() {
  const role = staffUser()?.role ?? "";
  const [tab, setTab] = useState<"new" | "runs">("new");
  const [openId, setOpenId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  if (!canPlan(role)) return <div class="ad-page"><InlineAlert tone="warn">{t("pln.noAccess")}</InlineAlert></div>;
  const goRun = (id: number) => { setOpenId(id); setVersion((v) => v + 1); setTab("runs"); };
  return (
    <div class="ad-page">
      <div>
        <h1 class="ad-title">{t("pln.title")}</h1>
        <p class="st-login__sub">{t("pln.subtitle")}</p>
      </div>
      <Tabs value={tab} onChange={(v) => setTab(v as "new" | "runs")} tabs={[
        { id: "new", label: t("pln.tab.new"), panel: <NewScenario onSaved={goRun} /> },
        { id: "runs", label: t("pln.tab.runs"), panel: <Runs key={version} role={role} openId={openId} setOpenId={setOpenId} /> },
      ]} />
    </div>
  );
}

function NewScenario({ onSaved }: { onSaved: (id: number) => void }) {
  const today = todayISO();
  const lookups = useQuery((signal) => api.get<{ recipes: RecipeOption[] }>("/planning/lookups", { signal }), []);
  const recipes = lookups.data?.recipes ?? [];
  const act = useAct();
  const [seq, setSeq] = useState(1);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(0, today)]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [code, setCode] = useState("baseline");
  const stale = () => setPreview(null);
  const setLine = (key: number, patch: Partial<LineDraft>) => { setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l))); stale(); };
  const dups = duplicateRecipes(lines);
  const valid = linesValid(lines, today);

  const calc = async () => {
    const res = await act.run(() => api.post<Preview>("/planning/explode", explodePayload(lines)));
    if (res) setPreview(res);
  };
  const save = async () => {
    if (!preview) return;
    const run = await act.run(() => api.post<{ id: number }>("/planning/runs", runPayload(preview, { scenarioCode: code, sourceType: "manual", today })), t("pln.saved"));
    if (run) onSaved(run.id);
  };

  return (
    <section class="eng-stack">
      <h2 class="eng-h">{t("pln.l.title")}</h2>
      {lookups.error ? <InlineAlert tone="danger" title={t("pln.err")}>{lookups.error.message}</InlineAlert> : null}
      {!lookups.loading && !recipes.length && !lookups.error ? <InlineAlert tone="warn">{t("pln.l.noRecipes")}</InlineAlert> : null}
      <div class="pln-lines">
        {lines.map((l) => {
          const err = l.recipeId || l.qty ? lineError(l, today) : null;
          return (
            <div class="pln-line" key={l.key}>
              <Field label={t("pln.l.recipe")} error={err === "recipe" ? t("pln.l.err.recipe") : undefined}>
                <Select value={l.recipeId} onChange={(e) => setLine(l.key, { recipeId: val(e) })} options={[{ value: "", label: t("pln.l.recipePick") }, ...recipes.map((r) => ({ value: String(r.id), label: `${r.productCode ? `${r.productCode} | ` : ""}${r.productName}` }))]} />
              </Field>
              <Field label={t("pln.l.qty")} error={err === "qty" ? t("pln.l.err.qty") : undefined}><Input inputMode="decimal" value={l.qty} onInput={(e) => setLine(l.key, { qty: val(e) })} /></Field>
              <Field label={t("pln.l.date")} error={err === "date" ? t("pln.l.err.date") : undefined}><Input type="date" min={today} value={l.requiredBy} onInput={(e) => setLine(l.key, { requiredBy: val(e) })} /></Field>
              {lines.length > 1 ? <Button size="sm" variant="ghost" onClick={() => { setLines(lines.filter((x) => x.key !== l.key)); stale(); }}>{t("pln.l.remove")}</Button> : null}
            </div>
          );
        })}
      </div>
      {dups.length ? <p class="eng-muted">{t("pln.l.dup")}</p> : null}
      <div class="eng-toolbar">
        <Button size="sm" variant="secondary" icon={Plus} disabled={lines.length >= 50} onClick={() => { setLines([...lines, { ...emptyLine(seq, today), requiredBy: addDaysISO(today, 14) }]); setSeq(seq + 1); stale(); }}>{t("pln.l.add")}</Button>
        <Button loading={act.busy && !preview} disabled={!valid} onClick={() => void calc()}>{t("pln.calc")}</Button>
      </div>
      {preview ? <PreviewPanel preview={preview} code={code} setCode={setCode} busy={act.busy} onSave={() => void save()} /> : null}
    </section>
  );
}

function PreviewPanel({ preview, code, setCode, busy, onSave }: { preview: Preview; code: string; setCode: (s: string) => void; busy: boolean; onSave: () => void }) {
  const [why, setWhy] = useState<number | null>(null);
  const ok = canSavePreview(preview);
  const cols: Column<PreviewDemand>[] = [
    { key: "item", header: t("pln.p.col.item"), cell: (d) => <strong>{d.name}</strong>, mobile: "title" },
    { key: "need", header: t("pln.p.col.need"), cell: (d) => `${n3(d.grossQty)} ${d.unit}` },
    { key: "free", header: t("pln.p.col.free"), cell: (d) => n3(d.result.freeAvailableQty), mobile: "hide" },
    { key: "open", header: t("pln.p.col.open"), cell: (d) => n3(d.openSupply.total), mobile: "hide" },
    { key: "net", header: t("pln.p.col.net"), cell: (d) => n3(d.result.netQty) },
    { key: "by", header: t("pln.p.col.by"), cell: (d) => formatDate(d.requiredBy), mobile: "hide" },
    { key: "st", header: t("pln.p.col.status"), cell: (d) => <StatusPill tone={d.result.status === "shortage" ? "danger" : "success"}>{d.result.status === "shortage" ? t("pln.p.shortage") : t("pln.p.covered")}</StatusPill> },
    { key: "why", header: "", cell: (d) => <Button size="sm" variant="ghost" onClick={() => setWhy(why === d.inventoryItemId ? null : d.inventoryItemId)}>{why === d.inventoryItemId ? t("pln.p.whyHide") : t("pln.p.why")}</Button> },
  ];
  const open = preview.demands.find((d) => d.inventoryItemId === why);
  return (
    <section class="eng-stack" aria-label={t("pln.p.title")}>
      <h2 class="eng-h">{t("pln.p.title")}</h2>
      <div class="eng-stats">
        <Stat label={t("pln.p.stat.items")} value={formatNumber(preview.summary.demandCount)} />
        <Stat label={t("pln.p.stat.short")} value={formatNumber(preview.summary.shortageCount)} />
        <Stat label={t("pln.p.stat.blocked")} value={formatNumber(preview.summary.blockerCount)} />
      </div>
      {preview.blockers.length ? (
        <InlineAlert tone="warn" title={t("pln.b.title")} action={<a class="ht-btn ht-btn--secondary ht-btn--sm" href={RECIPES_HREF}>{t("pln.b.link")}</a>}>
          <ul class="eng-issues">{preview.blockers.map((b, i) => <li key={i} class="is-error">{b.message}</li>)}</ul>
          <p class="eng-muted">{t("pln.b.hint")}</p>
        </InlineAlert>
      ) : null}
      <DataTable columns={cols} rows={preview.demands} rowKey={(d) => d.inventoryItemId} caption={t("pln.p.title")} empty={<EmptyState title={t("pln.p.empty")} compact />} />
      {open ? (
        <div class="pln-why" role="region" aria-label={t("pln.p.why")}>
          <ul class="eng-issues">
            {open.sources.map((s, i) => { const f = formulaParts(s); return <li key={i}>{t("pln.p.whySource", { product: f.product, produced: n3(f.produced), perBatch: n3(f.perBatch), output: n3(f.output), result: n3(f.result) })}</li>; })}
            <li>{t("pln.p.whyStock", { onHand: n3(open.stock.onHand), reserved: n3(open.stock.reserved), quarantine: n3(open.stock.quarantine) })}</li>
            <li>{t("pln.p.whyOpen", { po: n3(open.openSupply.purchaseOrders), req: n3(open.openSupply.requisitions) })}</li>
            <li>{open.result.explanation}</li>
          </ul>
        </div>
      ) : null}
      <div class="eng-toolbar">
        <Field label={t("pln.save.code")} hint={t("pln.save.codeHint")}><Input value={code} maxLength={60} onInput={(e) => setCode(val(e))} /></Field>
        <Button loading={busy} disabled={!ok} onClick={onSave}>{t("pln.save")}</Button>
      </div>
      {!ok && preview.blockers.length ? <p class="eng-warn">{t("pln.save.blocked")}</p> : null}
    </section>
  );
}

function Runs({ role, openId, setOpenId }: { role: string; openId: number | null; setOpenId: (id: number | null) => void }) {
  const q = useQuery((signal) => api.get<RunRow[]>("/planning/runs", { signal }), []);
  const rows = Array.isArray(q.data) ? q.data : [];
  const cols: Column<RunRow>[] = [
    { key: "code", header: t("pln.r.col.code"), cell: (r) => <strong>{r.scenarioCode}</strong>, mobile: "title" },
    { key: "st", header: t("pln.r.col.status"), cell: (r) => <StatusPill tone={r.status === "released" ? "success" : r.status === "approved" ? "info" : "neutral"}>{t(`pln.r.status.${r.status}` as "pln.r.status.draft")}</StatusPill> },
    { key: "range", header: t("pln.r.col.range"), cell: (r) => `${formatDate(r.horizonStart)} - ${formatDate(r.horizonEnd)}`, mobile: "hide" },
    { key: "d", header: t("pln.r.col.demand"), cell: (r) => formatNumber(r.summary.demandCount), mobile: "hide" },
    { key: "s", header: t("pln.r.col.short"), cell: (r) => formatNumber(r.summary.shortageCount) },
    { key: "a", header: t("pln.r.col.action"), cell: (r) => <Button size="sm" variant={r.id === openId ? "primary" : "secondary"} onClick={() => setOpenId(r.id === openId ? null : r.id)}>{t("pln.r.open")}</Button> },
  ];
  return (
    <section class="eng-stack">
      <h2 class="eng-h">{t("pln.r.title")}</h2>
      {q.error ? <InlineAlert tone="danger" title={t("pln.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert> : null}
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} caption={t("pln.r.title")} loading={q.loading} empty={<EmptyState title={t("pln.r.empty")} compact />} />
      {openId !== null ? <RunPanel key={openId} id={openId} role={role} onChanged={() => void q.refetch()} /> : null}
    </section>
  );
}

function RunPanel({ id, role, onChanged }: { id: number; role: string; onChanged: () => void }) {
  const q = useQuery((signal) => api.get<RunDetail>(`/planning/runs/${id}`, { signal }), [id]);
  const act = useAct();
  const [pending, setPending] = useState<"approve" | "release" | null>(null);
  const [impact, setImpact] = useState<string>("");
  const run = q.data;
  if (q.error) return <InlineAlert tone="danger" title={t("pln.err")}>{q.error.message}</InlineAlert>;
  if (!run) return <p class="eng-muted">{t("common.loading")}</p>;
  const actions = runActions(role, run);
  const byReq = requisitionByRequirement(run);
  const todo = pendingShortages(run);
  const refresh = async () => { await q.refetch(); onChanged(); };

  const approve = async () => { if (await act.run(() => api.post<unknown>(`/planning/runs/${id}/approve`, {}), t("pln.d.approved"))) { setPending(null); await refresh(); } };
  const release = async () => { if (await act.run(() => api.post<unknown>(`/planning/runs/${id}/release`, {}), t("pln.d.released"))) { setPending(null); await refresh(); } };
  const startRelease = async () => {
    const i = await act.run(() => api.post<{ requirementCount: number; shortageCount: number; overloadedCount: number; warning: string }>(`/planning/runs/${id}/release/preview`, {}));
    if (i) { setImpact(`${t("pln.d.releaseImpact", { n: i.requirementCount, s: i.shortageCount, o: i.overloadedCount })} ${i.warning}`); setPending("release"); }
  };
  const reqAll = async () => {
    const r = await act.run(() => api.post<{ created: unknown[] }>(`/planning/runs/${id}/requisitions`, {}));
    if (r) { await act.run(async () => true, r.created.length ? t("pln.d.reqCreated", { n: r.created.length }) : t("pln.d.reqNone")); await refresh(); }
  };
  const reqOne = async (s: RunShortage) => { if (await act.run(() => api.post<unknown>("/planning/requisitions", { materialRequirementId: s.materialRequirementId }), t("pln.d.reqCreated", { n: 1 }))) await refresh(); };

  const inputCols: Column<RunDetail["inputs"][number]>[] = [
    { key: "i", header: t("pln.d.col.item"), cell: (i) => i.snapshot.item?.name ?? t("pln.d.item", { id: i.inventoryItemId }), mobile: "title" },
    { key: "q", header: t("pln.d.col.qty"), cell: (i) => n3(i.grossQty) },
    { key: "b", header: t("pln.d.col.by"), cell: (i) => formatDate(i.requiredBy), mobile: "hide" },
  ];
  const shortCols: Column<RunShortage>[] = [
    { key: "m", header: t("pln.d.col.msg"), cell: (s) => <>{s.message}<p class="eng-muted">{s.explanation}</p></>, mobile: "title" },
    { key: "r", header: t("pln.d.col.rec"), cell: (s) => s.recommendedAction },
    { key: "a", header: t("pln.r.col.action"), cell: (s) => (byReq.get(s.materialRequirementId) ? <StatusPill tone="success">{t("pln.d.reqDone", { number: byReq.get(s.materialRequirementId)!.number })}</StatusPill> : run.status === "draft" ? <span class="eng-muted">{t("pln.d.draftHint")}</span> : <Button size="sm" variant="secondary" disabled={act.busy} onClick={() => void reqOne(s)}>{t("pln.d.reqOne")}</Button>) },
  ];
  return (
    <section class="eng-stack" aria-label={t("pln.d.title", { name: run.scenarioCode })}>
      <div class="eng-toolbar">
        <h2 class="eng-h">{t("pln.d.title", { name: run.scenarioCode })}</h2>
        <StatusPill tone={run.status === "released" ? "success" : run.status === "approved" ? "info" : "neutral"}>{t(`pln.r.status.${run.status}` as "pln.r.status.draft")}</StatusPill>
        <div class="eng-actions">
          {actions.includes("approve") ? <Button size="sm" onClick={() => setPending("approve")}>{t("pln.d.approve")}</Button> : null}
          {actions.includes("release") ? <Button size="sm" onClick={() => void startRelease()}>{t("pln.d.release")}</Button> : null}
          {actions.includes("requisitions") ? <Button size="sm" variant="secondary" disabled={act.busy} onClick={() => void reqAll()}>{t("pln.d.reqAll")}</Button> : null}
        </div>
      </div>
      {run.status === "draft" && todo.length ? <InlineAlert tone="info">{t("pln.d.reqNeedApproval")}</InlineAlert> : null}
      <h3 class="eng-h">{t("pln.d.inputs")}</h3>
      <DataTable columns={inputCols} rows={run.inputs} rowKey={(i) => i.id} caption={t("pln.d.inputs")} empty={<EmptyState title={t("pln.p.empty")} compact />} />
      <h3 class="eng-h">{t("pln.d.shortages")}</h3>
      <DataTable columns={shortCols} rows={run.shortageMessages} rowKey={(s) => s.id} caption={t("pln.d.shortages")} empty={<EmptyState title={t("pln.d.noShort")} compact />} />
      <h3 class="eng-h">{t("pln.d.reqs")}</h3>
      {run.requisitions.length ? <ul class="eng-issues">{run.requisitions.map((r) => <li key={r.id}>{r.number} - {n3(r.requestedQty)}</li>)}</ul> : <p class="eng-muted">{t("pln.d.noReqs")}</p>}
      <ConfirmDialog open={pending === "approve"} onClose={() => setPending(null)} title={t("pln.d.approve")} description={t("pln.d.approveBody")} confirmLabel={t("pln.d.approve")} loading={act.busy} onConfirm={() => void approve()} />
      <ConfirmDialog open={pending === "release"} onClose={() => setPending(null)} title={t("pln.d.release")} description={`${t("pln.d.releaseBody")} ${impact}`} confirmLabel={t("pln.d.release")} loading={act.busy} onConfirm={() => void release()} />
    </section>
  );
}
