import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Checkbox, ConfirmDialog, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, Textarea, type Column, type Tone } from "../design/components";
import { Plus } from "../design/icons";
import { formatNumber } from "../lib/format";
import {
  COMPONENT_TYPES, VERSION_FLOW, approveBlocked, canEditEngineering, componentError, componentPayload, decisionReasonOk, isEditableStatus, isSubAssembly, machinesFor, nextLineNo, nextOperationNo,
  operationError, operationPayload, productError, productPayload, routingRunTotal, versionActions, versionError, versionPayload, type VersionAction,
} from "./engineeringCore";

export interface Product { id: number; code: string; name: string; productType: string; baseUnit: string; status: string }
export interface Version { id: number; productId: number; version: string; status: string; validationStatus: string; effectiveFrom: string | null; changeReason: string | null }
interface ProductDetail extends Product { versions: Version[] }
export interface Lookups {
  items: { id: number; code: string; name: string; baseUnit: string }[];
  workCenters: { id: number; code: string; name: string }[];
  machines: { id: number; code: string; name: string; workCenterId: number | null }[];
  products: { id: number; code: string; name: string }[];
}
interface Component { id: number; lineNo: number; componentType: string; foundationItemId: number | null; subAssemblyProductId: number | null; qty: string; unit: string; scrapFactorPct: string }
interface Operation { id: number; operationNo: number; name: string; workCenterId: number | null; machineId: number | null; setupMinutes: number; runMinutesPerUnit: string; workersRequired: number; qualityPoint: boolean }
interface Issue { severity: "error" | "warning"; code: string; message: string }
interface ValidationResult { passed: boolean; errorCount: number; warningCount: number; issues: Issue[] }

const val = (e: Event) => (e.target as HTMLInputElement).value;
const chk = (e: Event) => (e.target as HTMLInputElement).checked;
const statusTone = (s: string): Tone => (s === "released" ? "success" : s === "approved" ? "info" : s === "in_review" ? "warn" : "neutral");
const valTone = (s: string): Tone => (s === "passed" ? "success" : s === "failed" ? "danger" : "neutral");
const lbl = (prefix: string, key: string) => t(`${prefix}${key}` as CopyKey);
const known = (list: readonly string[], k: string) => (list.includes(k) ? k : null);

export function useLookups() {
  const q = useQuery((signal) => api.get<Lookups>("/engineering/lookups", { signal }), []);
  const d = q.data;
  const lookups: Lookups = { items: d?.items ?? [], workCenters: d?.workCenters ?? [], machines: d?.machines ?? [], products: d?.products ?? [] };
  return lookups;
}

/** المنتجات الهندسية وإصداراتها: اختار منتج، شوف إصداراته، وافتح إصدار لمكوّناته ومساره وإجراءاته. */
export function EngineeringVersions() {
  const products = useQuery((signal) => api.get<Product[]>("/engineering/products", { signal }), []);
  const lookups = useLookups();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const all = Array.isArray(products.data) ? products.data : [];
  const q = search.trim().toLowerCase();
  const rows = q ? all.filter((p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) : all;
  const role = staffUser()?.role ?? "";
  const open = all.find((p) => p.id === openId) ?? null;

  const columns: Column<Product>[] = [
    { key: "code", header: t("eng.p.col.code"), cell: (p) => <strong>{p.code}</strong>, mobile: "title" },
    { key: "name", header: t("eng.p.col.name"), cell: (p) => p.name },
    { key: "type", header: t("eng.p.col.type"), cell: (p) => (known(["finished", "semi_finished", "raw_material"], p.productType) ? lbl("eng.p.type.", p.productType) : p.productType), mobile: "hide" },
    { key: "unit", header: t("eng.p.col.unit"), cell: (p) => p.baseUnit, mobile: "hide" },
    { key: "status", header: t("eng.p.col.status"), cell: (p) => <StatusPill tone={p.status === "active" ? "success" : "neutral"}>{p.status === "active" ? t("eng.p.status.active") : p.status}</StatusPill> },
    { key: "act", header: t("eng.c.col.action"), cell: (p) => <Button size="sm" variant={p.id === openId ? "primary" : "secondary"} onClick={() => setOpenId(p.id === openId ? null : p.id)}>{t("eng.p.open")}</Button> },
  ];

  return (
    <>
      <div class="eng-stats">
        <Stat label={t("eng.p.caption")} value={formatNumber(all.length)} />
      </div>
      <div class="eng-toolbar">
        <Input aria-label={t("eng.p.search")} placeholder={t("eng.p.search")} value={search} onInput={(e) => setSearch(val(e))} />
        {canEditEngineering(role) ? <Button icon={Plus} onClick={() => setCreating(true)}>{t("eng.p.new")}</Button> : null}
      </div>
      {products.error ? <InlineAlert tone="danger" title={t("eng.err")} action={<Button size="sm" variant="secondary" onClick={() => void products.refetch()}>{t("common.retry")}</Button>}>{products.error.message}</InlineAlert> : null}
      <DataTable columns={columns} rows={rows} rowKey={(p) => p.id} caption={t("eng.p.caption")} loading={products.loading} empty={<EmptyState title={t("eng.p.empty")} compact />} />
      {open ? <ProductVersions key={open.id} product={open} lookups={lookups} /> : null}
      {creating ? <NewProductDialog onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await products.refetch(); }} /> : null}
    </>
  );
}

function NewProductDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const [f, setF] = useState({ code: "", name: "", productType: "finished", baseUnit: t("eng.p.defaultUnit"), description: "" });
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: val(e) });
  const err = productError(f);
  const save = async () => {
    const ok = await act.run(async () => { await api.post<unknown>("/engineering/products", productPayload(f)); return true; }, t("eng.p.done"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("eng.p.new")} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={err !== null} onClick={() => void save()}>{t("eng.p.save")}</Button></>}>
      <div class="eng-form">
        <Field label={t("eng.p.f.code")} required error={f.code && err === "code" ? t("eng.p.err.code") : undefined}><Input value={f.code} maxLength={80} onInput={set("code")} /></Field>
        <Field label={t("eng.p.f.name")} required error={f.name === " " ? t("eng.p.err.name") : undefined}><Input value={f.name} maxLength={180} onInput={set("name")} /></Field>
        <Field label={t("eng.p.f.type")}><Select value={f.productType} options={["finished", "semi_finished", "raw_material"].map((x) => ({ value: x, label: lbl("eng.p.type.", x) }))} onChange={set("productType")} /></Field>
        <Field label={t("eng.p.f.unit")} required><Input value={f.baseUnit} maxLength={30} onInput={set("baseUnit")} /></Field>
        <Field label={t("eng.p.f.desc")}><Textarea value={f.description} maxLength={2000} onInput={set("description")} /></Field>
      </div>
    </Dialog>
  );
}

function ProductVersions({ product, lookups }: { product: Product; lookups: Lookups }) {
  const role = staffUser()?.role ?? "";
  const detail = useQuery((signal) => api.get<ProductDetail>(`/engineering/products/${product.id}`, { signal }), [product.id]);
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const versions = detail.data?.versions ?? [];
  const current = versions.find((v) => v.id === openVersion) ?? null;
  return (
    <section class="eng-stack" aria-label={t("eng.v.title", { name: product.name })}>
      <div class="eng-toolbar">
        <h2 class="eng-h">{t("eng.v.title", { name: product.name })}</h2>
        {canEditEngineering(role) ? <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>{t("eng.v.new")}</Button> : null}
      </div>
      {detail.error ? <InlineAlert tone="danger" title={t("eng.err")}>{detail.error.message}</InlineAlert> : null}
      {!detail.loading && !versions.length ? <EmptyState title={t("eng.v.none")} compact /> : null}
      {versions.map((v) => (
        <div key={v.id} class={`eng-ver${v.id === openVersion ? " is-open" : ""}`}>
          <strong>{v.version}</strong>
          <StatusPill tone={statusTone(v.status)}>{known(["draft", "in_review", "approved", "released", "superseded", "retired"], v.status) ? lbl("eng.v.status.", v.status) : v.status}</StatusPill>
          <StatusPill tone={valTone(v.validationStatus)}>{known(["not_validated", "passed", "failed"], v.validationStatus) ? lbl("eng.v.validation.", v.validationStatus) : v.validationStatus}</StatusPill>
          <Button size="sm" variant={v.id === openVersion ? "primary" : "secondary"} onClick={() => setOpenVersion(v.id === openVersion ? null : v.id)}>{t("eng.p.open")}</Button>
        </div>
      ))}
      {current ? <VersionDetail key={current.id} version={current} siblings={versions} lookups={lookups} onChanged={() => detail.refetch()} /> : null}
      {creating ? <NewVersionDialog productId={product.id} onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await detail.refetch(); }} /> : null}
    </section>
  );
}

function NewVersionDialog({ productId, onClose, onDone }: { productId: number; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const [version, setVersion] = useState("");
  const [from, setFrom] = useState("");
  const [reason, setReason] = useState("");
  const err = versionError(version);
  const save = async () => {
    const ok = await act.run(async () => { await api.post<unknown>(`/engineering/products/${productId}/versions`, versionPayload(version, from, reason)); return true; }, t("eng.v.done"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("eng.v.new")} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={err !== null} onClick={() => void save()}>{t("eng.v.save")}</Button></>}>
      <div class="eng-form">
        <Field label={t("eng.v.f.version")} required error={version.length > 40 ? t("eng.v.err.version") : undefined}><Input value={version} maxLength={40} onInput={(e) => setVersion(val(e))} /></Field>
        <Field label={t("eng.v.f.from")}><Input type="date" value={from} onInput={(e) => setFrom(val(e))} /></Field>
        <Field label={t("eng.v.f.reason")}><Textarea value={reason} maxLength={2000} onInput={(e) => setReason(val(e))} /></Field>
      </div>
    </Dialog>
  );
}

type Pending = null | { kind: "approve" | "release" } | { kind: "supersede" } | { kind: "retire" } | { kind: "component" } | { kind: "operation" } | { kind: "removeComponent"; row: Component };

function VersionDetail({ version, siblings, lookups, onChanged }: { version: Version; siblings: Version[]; lookups: Lookups; onChanged: () => Promise<void> }) {
  const role = staffUser()?.role ?? "";
  const act = useAct();
  const comps = useQuery((signal) => api.get<Component[]>(`/engineering/product-versions/${version.id}/components`, { signal }), [version.id]);
  const ops = useQuery((signal) => api.get<Operation[]>(`/engineering/routings/${version.id}/operations`, { signal }), [version.id]);
  const [pending, setPending] = useState<Pending>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const compRows = Array.isArray(comps.data) ? comps.data : [];
  const opRows = Array.isArray(ops.data) ? ops.data : [];
  const actions = versionActions(role, version);
  const editable = isEditableStatus(version.status) && canEditEngineering(role);
  const itemLabel = (c: Component) => {
    if (c.foundationItemId) { const it = lookups.items.find((i) => i.id === c.foundationItemId); return it ? `${it.code} | ${it.name}` : `#${c.foundationItemId}`; }
    const p = lookups.products.find((x) => x.id === c.subAssemblyProductId);
    return p ? `${p.code} | ${p.name}` : `#${c.subAssemblyProductId ?? ""}`;
  };

  const refresh = async () => { setPending(null); await Promise.all([onChanged(), comps.refetch(), ops.refetch()]); };
  const call = async (path: string, ok: string, body?: unknown) => {
    const done = await act.run(async () => { await api.post<unknown>(path, body); return true; }, ok);
    if (done) await refresh();
    return done;
  };
  const validate = async () => {
    const r = await act.run(() => api.post<ValidationResult>(`/engineering/product-versions/${version.id}/validate`), undefined);
    if (r) { setResult(r); await onChanged(); }
  };
  const run = (a: VersionAction) => {
    if (a === "validate") void validate();
    else if (a === "submitReview") void call(`/engineering/product-versions/${version.id}/submit-review`, t("eng.a.submitDone"));
    else if (a === "approve" || a === "release" || a === "supersede" || a === "retire") setPending({ kind: a });
  };

  const compCols: Column<Component>[] = [
    { key: "line", header: t("eng.c.col.line"), cell: (c) => c.lineNo, numeric: true },
    { key: "type", header: t("eng.c.col.type"), cell: (c) => (known([...COMPONENT_TYPES], c.componentType) ? lbl("eng.c.type.", c.componentType) : c.componentType), mobile: "hide" },
    { key: "item", header: t("eng.c.col.item"), cell: (c) => <strong>{itemLabel(c)}</strong>, mobile: "title" },
    { key: "qty", header: t("eng.c.col.qty"), cell: (c) => formatNumber(Number(c.qty)), numeric: true },
    { key: "unit", header: t("eng.c.col.unit"), cell: (c) => c.unit },
    { key: "scrap", header: t("eng.c.col.scrap"), cell: (c) => formatNumber(Number(c.scrapFactorPct)), numeric: true, mobile: "hide" },
    ...(editable ? [{ key: "act", header: t("eng.c.col.action"), cell: (c: Component) => <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "removeComponent", row: c })}>{t("eng.c.remove")}</Button> }] : []),
  ];
  const opCols: Column<Operation>[] = [
    { key: "no", header: t("eng.r.col.no"), cell: (o) => o.operationNo, numeric: true },
    { key: "name", header: t("eng.r.col.name"), cell: (o) => <strong>{o.name}</strong>, mobile: "title" },
    { key: "center", header: t("eng.r.col.center"), cell: (o) => lookups.workCenters.find((w) => w.id === o.workCenterId)?.name ?? "—", mobile: "hide" },
    { key: "machine", header: t("eng.r.col.machine"), cell: (o) => lookups.machines.find((m) => m.id === o.machineId)?.name ?? "—", mobile: "hide" },
    { key: "setup", header: t("eng.r.col.setup"), cell: (o) => formatNumber(o.setupMinutes), numeric: true, mobile: "hide" },
    { key: "run", header: t("eng.r.col.run"), cell: (o) => formatNumber(Number(o.runMinutesPerUnit)), numeric: true },
    { key: "workers", header: t("eng.r.col.workers"), cell: (o) => o.workersRequired, numeric: true, mobile: "hide" },
    { key: "quality", header: t("eng.r.col.quality"), cell: (o) => (o.qualityPoint ? t("eng.r.yes") : "—"), mobile: "hide" },
  ];

  const flowIdx = (VERSION_FLOW as readonly string[]).indexOf(version.status);
  const whyKey = known(["draft", "in_review", "approved", "released", "superseded", "retired"], version.status);
  return (
    <section class="eng-stack" aria-label={version.version}>
      <h3 class="eng-h">{version.version}</h3>
      <ol class="eng-flow" aria-label={t("eng.v.flow")}>
        {VERSION_FLOW.map((s, i) => <li key={s} class={i < flowIdx ? "is-done" : i === flowIdx ? "is-current" : ""}>{lbl("eng.v.status.", s)}</li>)}
      </ol>
      {whyKey ? <p class="eng-muted">{lbl("eng.v.why.", whyKey)}</p> : null}
      <p class="eng-muted">{t("eng.v.validation.stale")}</p>
      <div class="eng-actions">
        {actions.map((a) => <Button key={a} size="sm" variant={a === "approve" || a === "release" ? "primary" : "secondary"} loading={act.busy && a === "validate"} disabled={a === "approve" && approveBlocked(version)} onClick={() => run(a)}>{lbl("eng.a.", a)}</Button>)}
      </div>
      {actions.includes("approve") && approveBlocked(version) ? <p class="eng-warn">{t("eng.a.approveBlocked")}</p> : null}

      <div class="eng-toolbar">
        <h3 class="eng-h">{t("eng.c.title")}</h3>
        {editable ? <Button size="sm" icon={Plus} onClick={() => setPending({ kind: "component" })}>{t("eng.c.add")}</Button> : null}
      </div>
      {!editable && isEditableStatus(version.status) === false ? <p class="eng-muted">{t("eng.c.locked")}</p> : null}
      <DataTable columns={compCols} rows={compRows} rowKey={(c) => c.id} caption={t("eng.c.title")} loading={comps.loading} empty={<EmptyState title={t("eng.c.none")} compact />} />

      <div class="eng-toolbar">
        <h3 class="eng-h">{t("eng.r.title")}</h3>
        {editable ? <Button size="sm" icon={Plus} onClick={() => setPending({ kind: "operation" })}>{t("eng.r.add")}</Button> : null}
      </div>
      <DataTable columns={opCols} rows={opRows} rowKey={(o) => o.id} caption={t("eng.r.title")} loading={ops.loading} empty={<EmptyState title={t("eng.r.none")} compact />} />
      {opRows.length ? <p class="eng-muted">{t("eng.r.total", { min: formatNumber(routingRunTotal(opRows)) })}</p> : null}

      <ConfirmDialog open={pending?.kind === "approve"} onClose={() => setPending(null)} title={t("eng.a.approve")} description={t("eng.a.confirm.approve", { version: version.version })} confirmLabel={t("eng.a.confirm.go")} loading={act.busy} onConfirm={() => void call(`/engineering/bom-versions/${version.id}/approve`, t("eng.a.approveDone"))} />
      <ConfirmDialog open={pending?.kind === "release"} onClose={() => setPending(null)} title={t("eng.a.release")} description={t("eng.a.confirm.release")} confirmLabel={t("eng.a.confirm.go")} loading={act.busy} onConfirm={() => void call(`/engineering/product-versions/${version.id}/release`, t("eng.a.releaseDone"))} />
      <ConfirmDialog open={pending?.kind === "removeComponent"} onClose={() => setPending(null)} title={t("eng.c.remove")} description={pending?.kind === "removeComponent" ? t("eng.c.confirmRemove", { line: pending.row.lineNo }) : undefined} danger confirmLabel={t("eng.c.remove")} loading={act.busy} onConfirm={async () => {
        if (pending?.kind !== "removeComponent") return;
        const row = pending.row;
        const done = await act.run(async () => { await api.delete<unknown>(`/engineering/product-versions/${version.id}/components/${row.id}`); return true; }, t("eng.c.removeDone"));
        if (done) await refresh();
      }} />
      {pending?.kind === "supersede" ? <ReasonDialog title={t("eng.a.supersede")} confirm={t("eng.a.supersede")} busy={act.busy} onClose={() => setPending(null)}
        pick={{ label: t("eng.a.supersedeBy"), placeholder: t("eng.a.supersedePick"), empty: t("eng.a.supersedeNone"), options: siblings.filter((s) => s.id !== version.id && s.status !== "retired").map((s) => ({ value: String(s.id), label: s.version })) }}
        onSubmit={(reason, pick) => void call(`/engineering/product-versions/${version.id}/supersede`, t("eng.a.supersedeDone"), { supersededByVersionId: Number(pick), reason })} /> : null}
      {pending?.kind === "retire" ? <ReasonDialog title={t("eng.a.retire")} confirm={t("eng.a.retire")} busy={act.busy} onClose={() => setPending(null)} onSubmit={(reason) => void call(`/engineering/product-versions/${version.id}/retire`, t("eng.a.retireDone"), { reason })} /> : null}
      {pending?.kind === "component" ? <ComponentDialog versionId={version.id} lineNo={nextLineNo(compRows)} lookups={lookups} onClose={() => setPending(null)} onDone={refresh} /> : null}
      {pending?.kind === "operation" ? <OperationDialog versionId={version.id} operationNo={nextOperationNo(opRows)} taken={opRows.map((o) => o.operationNo)} lookups={lookups} onClose={() => setPending(null)} onDone={refresh} /> : null}
      {result ? <ValidationDialog result={result} onClose={() => setResult(null)} /> : null}
    </section>
  );
}

function ValidationDialog({ result, onClose }: { result: ValidationResult; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title={t("eng.val.title")} footer={<Button onClick={onClose}>{t("common.close")}</Button>}>
      <div class="eng-form">
        {result.passed ? <p class="eng-ok">{t("eng.val.pass", { n: formatNumber(result.warningCount) })}</p> : <p class="eng-warn">{t("eng.val.fail", { n: formatNumber(result.errorCount) })}</p>}
        {result.issues.length ? (
          <ul class="eng-issues">{result.issues.map((i, k) => <li key={k} class={i.severity === "error" ? "is-error" : ""}>{i.severity === "error" ? t("eng.val.error") : t("eng.val.warning")}: {i.message}</li>)}</ul>
        ) : <p class="eng-muted">{t("eng.val.none")}</p>}
      </div>
    </Dialog>
  );
}

/** حوار بسبب مكتوب (استبدال أو إيقاف)، ومعاه اختيار اختياري (الإصدار البديل). */
function ReasonDialog({ title, confirm, busy, onClose, onSubmit, pick }: { title: string; confirm: string; busy: boolean; onClose: () => void; onSubmit: (reason: string, pick: string) => void; pick?: { label: string; placeholder: string; empty: string; options: { value: string; label: string }[] } }) {
  const [reason, setReason] = useState("");
  const [choice, setChoice] = useState("");
  const ok = decisionReasonOk(reason) && (!pick || Boolean(choice));
  return (
    <Dialog open onClose={onClose} title={title} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={busy} disabled={!ok} onClick={() => onSubmit(reason.trim(), choice)}>{confirm}</Button></>}>
      <div class="eng-form">
        {pick ? (pick.options.length ? <Field label={pick.label} required><Select value={choice} options={[{ value: "", label: pick.placeholder }, ...pick.options]} onChange={(e) => setChoice(val(e))} /></Field> : <InlineAlert tone="warn">{pick.empty}</InlineAlert>) : null}
        <Field label={t("eng.a.reason")} required error={reason && !decisionReasonOk(reason) ? t("eng.a.reasonBad") : undefined}><Textarea value={reason} maxLength={1000} onInput={(e) => setReason(val(e))} /></Field>
      </div>
    </Dialog>
  );
}

function ComponentDialog({ versionId, lineNo, lookups, onClose, onDone }: { versionId: number; lineNo: number; lookups: Lookups; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const [f, setF] = useState({ lineNo, componentType: "raw_material", itemId: "", subProductId: "", qty: "", unit: "", scrap: "", alternateGroup: "", notes: "" });
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: val(e) });
  const err = componentError(f);
  const sub = isSubAssembly(f.componentType);
  const pickItem = (e: Event) => { const id = val(e); const it = lookups.items.find((i) => String(i.id) === id); setF({ ...f, itemId: id, unit: it && !f.unit ? it.baseUnit : f.unit }); };
  const save = async () => {
    const ok = await act.run(async () => { await api.post<unknown>(`/engineering/product-versions/${versionId}/components`, componentPayload(f)); return true; }, t("eng.c.done"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("eng.c.add")} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={err !== null} onClick={() => void save()}>{t("eng.c.save")}</Button></>}>
      <div class="eng-form">
        <Field label={t("eng.c.f.type")}><Select value={f.componentType} options={COMPONENT_TYPES.map((x) => ({ value: x, label: lbl("eng.c.type.", x) }))} onChange={(e) => setF({ ...f, componentType: val(e), itemId: "", subProductId: "" })} /></Field>
        {sub ? (
          <Field label={t("eng.c.f.sub")} required><Select value={f.subProductId} options={[{ value: "", label: t("eng.c.f.subPick") }, ...lookups.products.map((p) => ({ value: String(p.id), label: `${p.code} | ${p.name}` }))]} onChange={set("subProductId")} /></Field>
        ) : (
          <Field label={t("eng.c.f.item")} required><Select value={f.itemId} options={[{ value: "", label: t("eng.c.f.itemPick") }, ...lookups.items.map((i) => ({ value: String(i.id), label: `${i.code} | ${i.name}` }))]} onChange={pickItem} /></Field>
        )}
        <Field label={t("eng.c.f.qty")} required error={f.qty && err === "qty" ? t("eng.c.err.qty") : undefined}><Input inputMode="decimal" value={f.qty} onInput={set("qty")} /></Field>
        <Field label={t("eng.c.f.unit")} required error={f.unit.length > 20 ? t("eng.c.err.unit") : undefined}><Input value={f.unit} maxLength={20} onInput={set("unit")} /></Field>
        <Field label={t("eng.c.f.scrap")} error={err === "scrap" ? t("eng.c.err.scrap") : undefined}><Input inputMode="decimal" value={f.scrap} onInput={set("scrap")} /></Field>
        {f.componentType === "substitute" ? <Field label={t("eng.c.f.group")}><Input value={f.alternateGroup} maxLength={80} onInput={set("alternateGroup")} /></Field> : null}
        <Field label={t("eng.c.f.notes")}><Textarea value={f.notes} maxLength={1000} onInput={set("notes")} /></Field>
      </div>
    </Dialog>
  );
}

function OperationDialog({ versionId, operationNo, taken, lookups, onClose, onDone }: { versionId: number; operationNo: number; taken: number[]; lookups: Lookups; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const [f, setF] = useState({ operationNo: String(operationNo), name: "", workCenterId: "", machineId: "", setupMinutes: "", runMinutes: "", workers: "", qualityPoint: false, safety: "" });
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: val(e) });
  const err = operationError(f, taken);
  const save = async () => {
    const ok = await act.run(async () => { await api.post<unknown>(`/engineering/routings/${versionId}/operations`, operationPayload(f)); return true; }, t("eng.r.done"));
    if (ok) await onDone();
  };
  const machines = machinesFor(lookups.machines, f.workCenterId);
  const none = { value: "", label: t("eng.r.f.none") };
  return (
    <Dialog open onClose={onClose} title={t("eng.r.add")} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={err !== null} onClick={() => void save()}>{t("eng.r.save")}</Button></>}>
      <div class="eng-form">
        <Field label={t("eng.r.f.no")} required error={err === "operationNo" ? t("eng.r.err.no") : undefined}><Input inputMode="numeric" value={f.operationNo} onInput={set("operationNo")} /></Field>
        <Field label={t("eng.r.f.name")} required error={f.name.length > 180 ? t("eng.r.err.name") : undefined}><Input value={f.name} maxLength={180} onInput={set("name")} /></Field>
        <Field label={t("eng.r.f.center")}><Select value={f.workCenterId} options={[none, ...lookups.workCenters.map((w) => ({ value: String(w.id), label: `${w.code} | ${w.name}` }))]} onChange={(e) => setF({ ...f, workCenterId: val(e), machineId: "" })} /></Field>
        <Field label={t("eng.r.f.machine")}><Select value={f.machineId} options={[none, ...machines.map((m) => ({ value: String(m.id), label: `${m.code} | ${m.name}` }))]} onChange={set("machineId")} /></Field>
        <Field label={t("eng.r.f.setup")} error={err === "setup" ? t("eng.r.err.setup") : undefined}><Input inputMode="numeric" value={f.setupMinutes} onInput={set("setupMinutes")} /></Field>
        <Field label={t("eng.r.f.run")} error={err === "run" ? t("eng.r.err.run") : undefined}><Input inputMode="decimal" value={f.runMinutes} onInput={set("runMinutes")} /></Field>
        <Field label={t("eng.r.f.workers")} error={err === "workers" ? t("eng.r.err.workers") : undefined}><Input inputMode="numeric" value={f.workers} onInput={set("workers")} /></Field>
        <Checkbox label={t("eng.r.f.quality")} checked={f.qualityPoint} onChange={(e) => setF({ ...f, qualityPoint: chk(e) })} />
        <Field label={t("eng.r.f.safety")}><Textarea value={f.safety} maxLength={2000} onInput={set("safety")} /></Field>
      </div>
    </Dialog>
  );
}
