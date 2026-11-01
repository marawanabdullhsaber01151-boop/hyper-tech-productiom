import "../copy/engineering";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, Textarea, type Column, type Tone } from "../design/components";
import { Plus } from "../design/icons";
import { formatNumber, formatRelative } from "../lib/format";
import { canDecideChange, canEditEngineering, changeError, changePayload, decideBlockReason, decisionReasonOk } from "./engineeringCore";
import { useLookups, type Version } from "./EngineeringVersions";

interface Change { id: number; productId: number; productVersionId: number | null; requestNumber: string; title: string; reason: string; status: string; impactSummary: string | null; requestedBy: number | null; decisionReason: string | null; createdAt: string }
interface Impact { affectedEngineeringVersions: { product_version_id: number; product_id: number; version: string; status: string }[]; productionOrderImpact: string }

const val = (e: Event) => (e.target as HTMLInputElement).value;
const tone = (s: string): Tone => (s === "approved" ? "success" : s === "rejected" ? "danger" : "warn");
const statusLabel = (s: string) => (["open", "approved", "rejected"].includes(s) ? t(`eng.ch.status.${s}` as CopyKey) : s);

/** طلبات التغيير الهندسي: فتح طلب، شوف أثره على الإصدارات التانية، والبت فيه (اعتماد أو رفض بسبب). */
export function EngineeringChanges() {
  const user = staffUser();
  const role = user?.role ?? "";
  const lookups = useLookups();
  const list = useQuery((signal) => api.get<Change[]>("/engineering/change-requests", { signal }), []);
  const [filter, setFilter] = useState("open");
  const [dlg, setDlg] = useState<null | { kind: "new" } | { kind: "impact"; row: Change } | { kind: "decide"; row: Change; decision: "approved" | "rejected" }>(null);
  const all = Array.isArray(list.data) ? list.data : [];
  const rows = filter ? all.filter((c) => c.status === filter) : all;
  const open = all.filter((c) => c.status === "open").length;
  const productName = (id: number) => { const p = lookups.products.find((x) => x.id === id); return p ? `${p.code} | ${p.name}` : `#${id}`; };
  const done = async () => { setDlg(null); await list.refetch(); };

  const columns: Column<Change>[] = [
    { key: "no", header: t("eng.ch.col.no"), cell: (c) => <strong>{c.requestNumber}</strong>, mobile: "title" },
    { key: "title", header: t("eng.ch.col.title"), cell: (c) => <div><div>{c.title}</div><small class="eng-muted">{c.reason}</small></div> },
    { key: "product", header: t("eng.ch.col.product"), cell: (c) => productName(c.productId), mobile: "hide" },
    {
      key: "status",
      header: t("eng.ch.col.status"),
      cell: (c) => (
        <div>
          <StatusPill tone={tone(c.status)}>{statusLabel(c.status)}</StatusPill>
          {c.decisionReason ? <small class="eng-muted"> {c.decisionReason}</small> : null}
        </div>
      ),
    },
    { key: "when", header: t("eng.ch.col.when"), cell: (c) => formatRelative(c.createdAt), mobile: "hide" },
    {
      key: "act",
      header: t("eng.ch.col.action"),
      cell: (c) => {
        const canDecide = canDecideChange(role, user?.id, c);
        const block = decideBlockReason(role, user?.id, c);
        return (
          <div class="eng-actions">
            <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "impact", row: c })}>{t("eng.ch.impact")}</Button>
            {canDecide ? <Button size="sm" onClick={() => setDlg({ kind: "decide", row: c, decision: "approved" })}>{t("eng.ch.approve")}</Button> : null}
            {canDecide ? <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "decide", row: c, decision: "rejected" })}>{t("eng.ch.reject")}</Button> : null}
            {block === "own" ? <small class="eng-muted">{t("eng.ch.decide.own")}</small> : null}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <div class="eng-stats">
        <Stat label={t("eng.ch.stat.open")} value={formatNumber(open)} tone={open ? "warn" : "success"} />
        <Stat label={t("eng.ch.stat.decided")} value={formatNumber(all.length - open)} />
      </div>
      <div class="eng-toolbar">
        <Select aria-label={t("eng.ch.col.status")} value={filter} options={[{ value: "open", label: t("eng.ch.filter.open") }, { value: "", label: t("eng.ch.filter.all") }]} onChange={(e) => setFilter(val(e))} />
        {canEditEngineering(role) ? <Button icon={Plus} onClick={() => setDlg({ kind: "new" })}>{t("eng.ch.new")}</Button> : null}
      </div>
      {list.error ? <InlineAlert tone="danger" title={t("eng.err")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>}>{list.error.message}</InlineAlert> : null}
      <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} caption={t("eng.ch.caption")} loading={list.loading} empty={<EmptyState title={t("eng.ch.empty")} compact />} />
      {dlg?.kind === "new" ? <NewChangeDialog products={lookups.products} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.kind === "impact" ? <ImpactDialog row={dlg.row} productName={productName} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === "decide" ? <DecideDialog row={dlg.row} decision={dlg.decision} onClose={() => setDlg(null)} onDone={done} /> : null}
    </>
  );
}

function NewChangeDialog({ products, onClose, onDone }: { products: { id: number; code: string; name: string }[]; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const [f, setF] = useState({ productId: "", versionId: "", title: "", reason: "", impact: "" });
  const versions = useQuery((signal) => (f.productId ? api.get<{ versions: Version[] }>(`/engineering/products/${f.productId}`, { signal }) : Promise.resolve({ versions: [] as Version[] })), [f.productId]);
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: val(e) });
  const err = changeError(f);
  const save = async () => {
    const created = await act.run(() => api.post<{ requestNumber: string }>("/engineering/change-requests", changePayload(f)), undefined);
    if (created) {
      await onDone();
      return;
    }
  };
  return (
    <Dialog open onClose={onClose} title={t("eng.ch.new")} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={err !== null} onClick={() => void save()}>{t("eng.ch.save")}</Button></>}>
      <div class="eng-form">
        <Field label={t("eng.ch.f.product")} required><Select value={f.productId} options={[{ value: "", label: t("eng.ch.f.productPick") }, ...products.map((p) => ({ value: String(p.id), label: `${p.code} | ${p.name}` }))]} onChange={(e) => setF({ ...f, productId: val(e), versionId: "" })} /></Field>
        <Field label={t("eng.ch.f.version")}><Select value={f.versionId} options={[{ value: "", label: t("eng.ch.f.versionNone") }, ...(versions.data?.versions ?? []).map((v) => ({ value: String(v.id), label: v.version }))]} onChange={set("versionId")} /></Field>
        <Field label={t("eng.ch.f.title")} required error={f.title.length > 180 ? t("eng.ch.err.title") : undefined}><Input value={f.title} maxLength={180} onInput={set("title")} /></Field>
        <Field label={t("eng.ch.f.reason")} required><Textarea value={f.reason} maxLength={2000} onInput={set("reason")} /></Field>
        <Field label={t("eng.ch.f.impact")}><Textarea value={f.impact} maxLength={4000} onInput={set("impact")} /></Field>
      </div>
    </Dialog>
  );
}

function ImpactDialog({ row, productName, onClose }: { row: Change; productName: (id: number) => string; onClose: () => void }) {
  const q = useQuery((signal) => api.get<Impact>(`/engineering/change-requests/${row.id}/impact`, { signal }), [row.id]);
  const list = q.data?.affectedEngineeringVersions ?? [];
  return (
    <Dialog open onClose={onClose} title={t("eng.ch.impact.title", { no: row.requestNumber })} footer={<Button onClick={onClose}>{t("common.close")}</Button>}>
      <div class="eng-form">
        {q.error ? <InlineAlert tone="danger" title={t("eng.err")}>{q.error.message}</InlineAlert> : null}
        {row.impactSummary ? <p>{row.impactSummary}</p> : null}
        {q.loading ? null : list.length ? (
          <>
            <p class="eng-muted">{t("eng.ch.impact.versions")}</p>
            <ul class="eng-issues">{list.map((v) => <li key={v.product_version_id}>{t("eng.ch.impact.row", { product: productName(v.product_id), version: v.version, status: ["draft", "in_review", "approved", "released", "superseded", "retired"].includes(v.status) ? t(`eng.v.status.${v.status}` as CopyKey) : v.status })}</li>)}</ul>
          </>
        ) : q.data ? <p class="eng-muted">{t("eng.ch.impact.none")}</p> : null}
        <InlineAlert tone="info">{t("eng.ch.impact.orders")}</InlineAlert>
      </div>
    </Dialog>
  );
}

function DecideDialog({ row, decision, onClose, onDone }: { row: Change; decision: "approved" | "rejected"; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const [reason, setReason] = useState("");
  const save = async () => {
    const ok = await act.run(async () => { await api.patch<unknown>(`/engineering/change-requests/${row.id}/decide`, { decision, reason: reason.trim() }); return true; }, t(decision === "approved" ? "eng.ch.decide.approveDone" : "eng.ch.decide.rejectDone"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("eng.ch.decide.title", { no: row.requestNumber })} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={!decisionReasonOk(reason)} onClick={() => void save()}>{t(decision === "approved" ? "eng.ch.approve" : "eng.ch.reject")}</Button></>}>
      <div class="eng-form">
        <p>{row.title}</p>
        <Field label={t("eng.ch.decide.reason")} required error={reason && !decisionReasonOk(reason) ? t("eng.a.reasonBad") : undefined}><Textarea value={reason} maxLength={1000} onInput={(e) => setReason(val(e))} /></Field>
      </div>
    </Dialog>
  );
}
