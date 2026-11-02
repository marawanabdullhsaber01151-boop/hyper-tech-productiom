import "../copy/foundation";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Checkbox, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, Textarea, type Column } from "../design/components";
import { Plus } from "../design/icons";
import { formatDateTime, formatNumber } from "../lib/format";
import { confirmEnabled, impactBody, activeBlockers, type Impact } from "./foundationCore";
import {
  ITEM_STATUSES, ITEM_TYPES, canApproveItem, canEditItem, canReactivate, changedFields, conversionError, conversionPayload, criticalChanged, emptyItemForm, exportCsv, filterItems, hasChanges, itemError,
  itemPayload, itemStatusTone, itemStats, itemToForm, needsChangeRequest, parseImport, pendingDiff, type AliasRow, type ConversionForm, type ConversionRow, type DuplicateGroups, type ImportPreview, type ItemForm, type ItemRow,
  type ItemStatusFilter, type ItemVersion,
} from "./itemsCore";
import { joinNames } from "./recipesCore";
import "./Engineering.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const chk = (e: Event) => (e.target as HTMLInputElement).checked;
const list = <T,>(d: T[] | undefined): T[] => (Array.isArray(d) ? d : []);
const k = (key: string) => key as CopyKey;

function saveFile(name: string, text: string, mime: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function Modal({ title, onClose, footer, children }: { title: string; onClose: () => void; footer?: ComponentChildren; children: ComponentChildren }) {
  return (
    <Dialog open onClose={onClose} title={title} footer={footer ?? <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}>
      <div class="eng-form">{children}</div>
    </Dialog>
  );
}

/** تبويب الأصناف: قائمة + نموذج + طلب تغيير للحقول الحرجة + اعتماد/رفض + سجل + أسماء بديلة + تحويلات + مكررات + استيراد/تصدير. */
export function Items({ role }: { role: string }) {
  const q = useQuery((signal) => api.get<ItemRow[]>("/foundation/items", { signal }), []);
  const rows = list(q.data);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ItemStatusFilter>("all");
  const [type, setType] = useState("");
  const [dialog, setDialog] = useState<{ kind: "form"; row: ItemRow | null } | { kind: "review" | "history" | "aliases" | "conv" | "deactivate"; row: ItemRow } | { kind: "dups" | "import" } | null>(null);
  const act = useAct();
  const stats = itemStats(rows);
  const shown = filterItems(rows, search, status, type);
  const close = () => setDialog(null);
  const refetch = () => void q.refetch();
  const exportAll = async (as: "csv" | "json") => {
    await act.run(async () => {
      const all = await api.get<ItemRow[]>("/foundation/items/export");
      if (as === "csv") saveFile("items.csv", exportCsv(list(all)), "text/csv;charset=utf-8");
      else saveFile("items.json", JSON.stringify(all, null, 2), "application/json");
      return true;
    }, t("fnd.it.exported"));
  };
  const cols: Column<ItemRow>[] = [
    { key: "code", header: t("fnd.it.col.code"), cell: (r) => <strong>{r.code}</strong>, mobile: "title" },
    { key: "name", header: t("fnd.it.col.name"), cell: (r) => r.name },
    { key: "type", header: t("fnd.it.col.type"), cell: (r) => t(k(`fnd.it.type.${r.itemType}`)), mobile: "hide" },
    { key: "unit", header: t("fnd.it.col.unit"), cell: (r) => r.baseUnit, mobile: "hide" },
    { key: "min", header: t("fnd.it.col.min"), cell: (r) => formatNumber(Number(r.minStock)), mobile: "hide" },
    { key: "st", header: t("fnd.it.col.status"), cell: (r) => <StatusPill tone={itemStatusTone(r.status)}>{t(k(`fnd.it.status.${r.status}`))}</StatusPill> },
    {
      key: "act", header: t("fnd.col.action"),
      cell: (r) => (
        <div class="eng-actions">
          {r.status === "pending_approval"
            ? (canApproveItem(role) ? <Button size="sm" onClick={() => setDialog({ kind: "review", row: r })}>{t("fnd.it.review")}</Button> : <span class="eng-muted">{t("fnd.it.awaiting")}</span>)
            : null}
          {canEditItem(r) ? <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "form", row: r })}>{t("fnd.edit")}</Button> : null}
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "aliases", row: r })}>{t("fnd.it.aliases")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "conv", row: r })}>{t("fnd.it.conv")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "history", row: r })}>{t("fnd.it.history")}</Button>
          {r.active ? <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "deactivate", row: r })}>{t("fnd.deactivate")}</Button> : null}
          {canReactivate(r) && r.status === "retired"
            ? <Button size="sm" variant="ghost" disabled={act.busy} onClick={() => void act.run(async () => { await api.patch<unknown>(`/foundation/items/${r.id}`, { active: true }); refetch(); return true; }, t("fnd.activated"))}>{t("fnd.activate")}</Button>
            : null}
        </div>
      ),
    },
  ];
  return (
    <section class="eng-stack">
      <div class="eng-stats">
        <Stat label={t("fnd.it.stat.total")} value={formatNumber(stats.total)} />
        <Stat label={t("fnd.it.stat.active")} value={formatNumber(stats.active)} />
        <Stat label={t("fnd.it.stat.pending")} value={formatNumber(stats.pending)} />
        <Stat label={t("fnd.it.stat.draft")} value={formatNumber(stats.draft)} />
      </div>
      {stats.pending > 0 && canApproveItem(role) ? <InlineAlert tone="warn">{t("fnd.it.pendingBanner", { n: formatNumber(stats.pending) })}</InlineAlert> : null}
      <div class="eng-toolbar">
        <Input aria-label={t("fnd.it.search")} placeholder={t("fnd.it.search")} value={search} onInput={(e) => setSearch(val(e))} />
        <Select aria-label={t("fnd.it.col.status")} value={status} onChange={(e) => setStatus(val(e) as ItemStatusFilter)} options={[{ value: "all", label: t("fnd.it.statusAll") }, ...ITEM_STATUSES.map((s) => ({ value: s, label: t(k(`fnd.it.status.${s}`)) }))]} />
        <Select aria-label={t("fnd.it.col.type")} value={type} onChange={(e) => setType(val(e))} options={[{ value: "", label: t("fnd.it.typeAll") }, ...ITEM_TYPES.map((s) => ({ value: s, label: t(k(`fnd.it.type.${s}`)) }))]} />
        <Button icon={Plus} onClick={() => setDialog({ kind: "form", row: null })}>{t("fnd.it.new")}</Button>
        <Button variant="secondary" onClick={() => setDialog({ kind: "import" })}>{t("fnd.it.import")}</Button>
        <Button variant="secondary" onClick={() => setDialog({ kind: "dups" })}>{t("fnd.it.dups")}</Button>
        <Button variant="ghost" disabled={act.busy} onClick={() => void exportAll("csv")}>{`${t("fnd.it.export")} ${t("fnd.it.exportCsv")}`}</Button>
        <Button variant="ghost" disabled={act.busy} onClick={() => void exportAll("json")}>{`${t("fnd.it.export")} ${t("fnd.it.exportJson")}`}</Button>
      </div>
      {q.error ? <InlineAlert tone="danger" title={t("fnd.err")} action={<Button size="sm" variant="secondary" onClick={refetch}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert> : null}
      <DataTable columns={cols} rows={shown} rowKey={(r) => r.id} caption={t("fnd.tab.items")} loading={q.loading} empty={<EmptyState title={rows.length ? t("fnd.emptyFiltered") : t("fnd.it.empty")} compact />} />
      {dialog?.kind === "form" ? <ItemDialog row={dialog.row} onClose={close} onSaved={refetch} /> : null}
      {dialog?.kind === "review" ? <ReviewDialog row={dialog.row} onClose={close} onDone={() => { close(); refetch(); }} /> : null}
      {dialog?.kind === "history" ? <HistoryDialog row={dialog.row} onClose={close} /> : null}
      {dialog?.kind === "aliases" ? <AliasesDialog row={dialog.row} onClose={close} /> : null}
      {dialog?.kind === "conv" ? <ConversionsDialog row={dialog.row} onClose={close} /> : null}
      {dialog?.kind === "deactivate" ? <DeactivateDialog row={dialog.row} onClose={close} onDone={() => { close(); refetch(); }} /> : null}
      {dialog?.kind === "dups" ? <DuplicatesDialog onClose={close} /> : null}
      {dialog?.kind === "import" ? <ImportDialog onClose={close} onDone={() => { close(); refetch(); }} /> : null}
    </section>
  );
}

/* ───────────── نموذج الصنف + طلب التغيير ───────────── */

function ItemDialog({ row, onClose, onSaved }: { row: ItemRow | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<ItemForm>(() => (row ? itemToForm(row) : emptyItemForm()));
  const [reason, setReason] = useState("");
  const act = useAct();
  const set = (key: keyof ItemForm) => (e: Event) => setF({ ...f, [key]: val(e) });
  const err = itemError(f);
  const payload = itemPayload(f);
  const changes = row ? changedFields(row, payload) : {};
  const request = row ? needsChangeRequest(row, changes) : false;
  const crit = criticalChanged(changes);
  const reasonOk = reason.trim().length >= 3;
  const disabled = err !== null || (row !== null && !hasChanges(changes)) || (request && !reasonOk);
  const save = async () => {
    const ok = await act.run(async () => {
      if (!row) await api.post<unknown>("/foundation/items", payload);
      else if (request) await api.post<unknown>(`/foundation/items/${row.id}/request-change`, { changes, reason: reason.trim() });
      else await api.patch<unknown>(`/foundation/items/${row.id}`, changes);
      return true;
    }, request ? t("fnd.it.requested") : t("fnd.saved"));
    if (ok) { onSaved(); onClose(); }
  };
  const errText: Record<string, string> = { code: t("fnd.it.err.code"), name: t("fnd.it.err.name"), unit: t("fnd.it.err.unit"), minStock: t("fnd.it.err.minStock"), shelf: t("fnd.it.err.shelf") };
  return (
    <Dialog open onClose={onClose} title={row ? t("fnd.it.editTitle", { code: row.code }) : t("fnd.it.newTitle")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={disabled} onClick={() => void save()}>{request ? t("fnd.it.sendRequest") : t("common.save")}</Button></>}>
      <div class="eng-form">
        <Field label={t("fnd.it.f.code")} required error={err === "code" ? errText.code : undefined}><Input value={f.code} maxLength={80} onInput={set("code")} /></Field>
        <Field label={t("fnd.it.f.name")} required error={err === "name" ? errText.name : undefined}><Input value={f.name} maxLength={160} onInput={set("name")} /></Field>
        <Field label={t("fnd.it.f.type")}><Select value={f.itemType} onChange={set("itemType")} options={ITEM_TYPES.map((x) => ({ value: x, label: t(k(`fnd.it.type.${x}`)) }))} /></Field>
        <Field label={t("fnd.it.f.unit")} required error={err === "unit" ? errText.unit : undefined}><Input value={f.baseUnit} maxLength={20} onInput={set("baseUnit")} /></Field>
        <Field label={t("fnd.it.f.min")} error={err === "minStock" ? errText.minStock : undefined}><Input inputMode="decimal" value={f.minStock} onInput={set("minStock")} /></Field>
        <Field label={t("fnd.it.f.shelf")} error={err === "shelf" ? errText.shelf : undefined}><Input inputMode="numeric" value={f.shelfLifeDays} onInput={set("shelfLifeDays")} /></Field>
        <Checkbox label={t("fnd.it.f.lot")} checked={f.lotTracked} onChange={(e) => setF({ ...f, lotTracked: chk(e) })} />
        <Checkbox label={t("fnd.it.f.serial")} checked={f.serialTracked} onChange={(e) => setF({ ...f, serialTracked: chk(e) })} />
        <Field label={t("fnd.it.f.notes")}><Textarea value={f.notes} maxLength={1000} onInput={set("notes")} /></Field>
        {request ? (
          <>
            <InlineAlert tone="warn">{t("fnd.it.criticalNote", { fields: joinNames(crit.map((c) => t(k(`fnd.it.field.${c}`)))) })}</InlineAlert>
            <Field label={t("fnd.it.f.reason")} hint={t("fnd.it.f.reasonHint")} required><Textarea value={reason} maxLength={500} onInput={(e) => setReason(val(e))} /></Field>
          </>
        ) : null}
        {row && !hasChanges(changes) ? <p class="eng-muted">{t("fnd.it.noChange")}</p> : null}
      </div>
    </Dialog>
  );
}

/* ───────────── اعتماد/رفض ───────────── */

function ReviewDialog({ row, onClose, onDone }: { row: ItemRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const act = useAct();
  const diff = pendingDiff(row);
  const reasonBad = reason.trim().length > 0 && reason.trim().length < 3;
  const decide = async (kind: "approve" | "reject") => {
    const body = reason.trim() ? { reason: reason.trim() } : {};
    const ok = await act.run(async () => {
      if (kind === "approve") await api.post<unknown>(`/foundation/items/${row.id}/approve`, body);
      else await api.post<unknown>(`/foundation/items/${row.id}/reject`, body);
      return true;
    }, kind === "approve" ? t("fnd.it.approved") : t("fnd.it.rejected"));
    if (ok) onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("fnd.it.reviewTitle", { code: row.code })}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button variant="danger" disabled={act.busy || reasonBad} onClick={() => void decide("reject")}>{t("fnd.it.reject")}</Button><Button loading={act.busy} disabled={reasonBad} onClick={() => void decide("approve")}>{t("fnd.it.approve")}</Button></>}>
      <div class="eng-form">
        {row.pendingChangeRequestedByName ? <p>{t("fnd.it.reviewBy", { name: row.pendingChangeRequestedByName })}</p> : null}
        {row.pendingChangeReason ? <p>{t("fnd.it.reviewReason", { reason: row.pendingChangeReason })}</p> : null}
        <ul class="eng-issues">
          {diff.map((d) => <li key={d.field}><strong>{t(k(`fnd.it.field.${d.field}`))}</strong>: {t("fnd.it.diffFrom")} {d.from || "-"} {"←"} {t("fnd.it.diffTo")} {d.to || "-"}</li>)}
        </ul>
        <Field label={t("fnd.it.decisionReason")} error={reasonBad ? t("fnd.i.reasonHint") : undefined}><Textarea value={reason} maxLength={500} onInput={(e) => setReason(val(e))} /></Field>
      </div>
    </Dialog>
  );
}

/* ───────────── سجل ───────────── */

function HistoryDialog({ row, onClose }: { row: ItemRow; onClose: () => void }) {
  const q = useQuery((signal) => api.get<ItemVersion[]>(`/foundation/items/${row.id}/history`, { signal }), [row.id]);
  const rows = list(q.data);
  const cols: Column<ItemVersion>[] = [
    { key: "v", header: t("fnd.it.hist.version"), cell: (r) => r.version, mobile: "title" },
    { key: "by", header: t("fnd.it.hist.by"), cell: (r) => r.changedByName ?? "-" },
    { key: "why", header: t("fnd.it.hist.reason"), cell: (r) => r.changeReason ?? "-", mobile: "hide" },
    { key: "at", header: t("fnd.it.hist.at"), cell: (r) => formatDateTime(r.createdAt) },
  ];
  return (
    <Modal title={t("fnd.it.historyTitle", { code: row.code })} onClose={onClose}>
      {q.error ? <InlineAlert tone="danger">{q.error.message}</InlineAlert> : null}
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} caption={t("fnd.it.history")} loading={q.loading} empty={<EmptyState title={t("fnd.it.historyEmpty")} compact />} />
    </Modal>
  );
}

/* ───────────── أسماء بديلة ───────────── */

function AliasesDialog({ row, onClose }: { row: ItemRow; onClose: () => void }) {
  const q = useQuery((signal) => api.get<AliasRow[]>(`/foundation/items/${row.id}/aliases`, { signal }), [row.id]);
  const act = useAct();
  const [alias, setAlias] = useState("");
  const rows = list(q.data);
  const add = async () => {
    const ok = await act.run(async () => { await api.post<unknown>(`/foundation/items/${row.id}/aliases`, { alias: alias.trim() }); return true; }, t("fnd.it.aliasAdded"));
    if (ok) { setAlias(""); void q.refetch(); }
  };
  const remove = async (a: AliasRow) => {
    const ok = await act.run(async () => { await api.delete<unknown>(`/foundation/items/${row.id}/aliases/${a.id}`); return true; }, t("fnd.it.aliasRemoved"));
    if (ok) void q.refetch();
  };
  return (
    <Modal title={t("fnd.it.aliasesTitle", { code: row.code })} onClose={onClose}>
      {q.error ? <InlineAlert tone="danger">{q.error.message}</InlineAlert> : null}
      {rows.length ? <ul class="eng-issues">{rows.map((a) => <li key={a.id}>{a.alias} <Button size="sm" variant="ghost" disabled={act.busy} onClick={() => void remove(a)}>{t("fnd.it.remove")}</Button></li>)}</ul> : <p class="eng-muted">{t("fnd.it.aliasEmpty")}</p>}
      <Field label={t("fnd.it.aliasAdd")}><Input aria-label={t("fnd.it.aliasAdd")} placeholder={t("fnd.it.aliasPlaceholder")} maxLength={160} value={alias} onInput={(e) => setAlias(val(e))} /></Field>
      <div><Button size="sm" loading={act.busy} disabled={alias.trim().length === 0} onClick={() => void add()}>{t("fnd.it.aliasAdd")}</Button></div>
    </Modal>
  );
}

/* ───────────── تحويلات الوحدات ───────────── */

function ConversionsDialog({ row, onClose }: { row: ItemRow; onClose: () => void }) {
  const q = useQuery((signal) => api.get<ConversionRow[]>(`/foundation/items/${row.id}/conversions`, { signal }), [row.id]);
  const act = useAct();
  const [f, setF] = useState<ConversionForm>({ fromUnit: "", toUnit: row.baseUnit, factor: "" });
  const rows = list(q.data);
  const err = conversionError(f);
  const touched = f.fromUnit.trim() !== "" || f.factor.trim() !== "";
  const msg: Record<string, string> = { from: t("fnd.it.err.convFrom"), to: t("fnd.it.err.convTo"), same: t("fnd.it.err.convSame"), factor: t("fnd.it.err.convFactor") };
  const add = async () => {
    const ok = await act.run(async () => { await api.post<unknown>(`/foundation/items/${row.id}/conversions`, conversionPayload(f)); return true; }, t("fnd.it.convAdded"));
    if (ok) { setF({ fromUnit: "", toUnit: row.baseUnit, factor: "" }); void q.refetch(); }
  };
  return (
    <Modal title={t("fnd.it.convTitle", { code: row.code })} onClose={onClose}>
      {q.error ? <InlineAlert tone="danger">{q.error.message}</InlineAlert> : null}
      {rows.length ? <ul class="eng-issues">{rows.map((c) => <li key={c.id}>{t("fnd.it.convLine", { from: c.fromUnit, factor: String(Number(c.factor)), to: c.toUnit })}</li>)}</ul> : <p class="eng-muted">{t("fnd.it.convEmpty")}</p>}
      <Field label={t("fnd.it.convFrom")}><Input value={f.fromUnit} maxLength={20} onInput={(e) => setF({ ...f, fromUnit: val(e) })} /></Field>
      <Field label={t("fnd.it.convTo")}><Input value={f.toUnit} maxLength={20} onInput={(e) => setF({ ...f, toUnit: val(e) })} /></Field>
      <Field label={t("fnd.it.convFactor")} error={touched && err ? msg[err] : undefined}><Input inputMode="decimal" value={f.factor} onInput={(e) => setF({ ...f, factor: val(e) })} /></Field>
      <div><Button size="sm" loading={act.busy} disabled={err !== null} onClick={() => void add()}>{t("fnd.it.convAdd")}</Button></div>
    </Modal>
  );
}

/* ───────────── مكررات ───────────── */

function DuplicatesDialog({ onClose }: { onClose: () => void }) {
  const q = useQuery((signal) => api.get<DuplicateGroups>("/foundation/items/duplicates", { signal }), []);
  const d = q.data;
  const byName = list(d?.byName);
  const byCode = list(d?.byCode);
  return (
    <Modal title={t("fnd.it.dupsTitle")} onClose={onClose}>
      {q.error ? <InlineAlert tone="danger">{q.error.message}</InlineAlert> : null}
      {d && !byName.length && !byCode.length ? <InlineAlert tone="success">{t("fnd.it.dupsNone")}</InlineAlert> : null}
      {byName.length ? <div><h3 class="eng-h">{t("fnd.it.dupsByName")}</h3><ul class="eng-issues">{byName.map((g, i) => <li key={i}>{joinNames(g.codes)}</li>)}</ul></div> : null}
      {byCode.length ? <div><h3 class="eng-h">{t("fnd.it.dupsByCode")}</h3><ul class="eng-issues">{byCode.map((g, i) => <li key={i}>{joinNames(g.item_ids.map(String))}</li>)}</ul></div> : null}
    </Modal>
  );
}

/* ───────────── استيراد ───────────── */

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const act = useAct();
  const run = async (dryRun: boolean) => {
    const parsed = parseImport(text);
    if (parsed.error) { setParseErr(t(k(`fnd.it.err.import.${parsed.error}`))); setPreview(null); return; }
    setParseErr(null);
    const res = await act.run(async () => api.post<ImportPreview>("/foundation/items/import", { rows: parsed.rows, dryRun }), dryRun ? undefined : t("fnd.it.importDone"));
    if (!res) return;
    if (dryRun) setPreview(res);
    else onDone();
  };
  const bad = preview ? preview.results.filter((r) => !r.ok) : [];
  return (
    <Dialog open onClose={onClose} title={t("fnd.it.importTitle")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button variant="secondary" disabled={act.busy || !text.trim()} onClick={() => void run(true)}>{t("fnd.it.importPreview")}</Button><Button loading={act.busy} disabled={!preview || !preview.canApply} onClick={() => void run(false)}>{t("fnd.it.importApply")}</Button></>}>
      <div class="eng-form">
        <p class="eng-muted">{t("fnd.it.importHint")}</p>
        <Field label={t("fnd.it.importTitle")}><Textarea rows={8} value={text} onInput={(e) => { setText(val(e)); setPreview(null); }} /></Field>
        {parseErr ? <InlineAlert tone="danger">{parseErr}</InlineAlert> : null}
        {preview ? (
          <>
            <InlineAlert tone={preview.canApply ? "success" : "warn"}>{`${t("fnd.it.importSummary", { total: formatNumber(preview.totalRows), ok: formatNumber(preview.okCount), bad: formatNumber(preview.errorCount) })} ${preview.canApply ? t("fnd.it.importAllOk") : t("fnd.it.importBlocked")}`}</InlineAlert>
            {bad.length ? <ul class="eng-issues">{bad.map((r) => <li key={r.row}><strong>{t("fnd.it.importRow", { row: formatNumber(r.row) })}</strong> {r.code ?? ""}: {joinNames(r.errors ?? [])}</li>)}</ul> : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ───────────── إيقاف الصنف ───────────── */

function DeactivateDialog({ row, onClose, onDone }: { row: ItemRow; onClose: () => void; onDone: () => void }) {
  const q = useQuery((signal) => api.get<Impact>(`/foundation/items/${row.id}/impact`, { signal }), [row.id]);
  const act = useAct();
  const [reason, setReason] = useState("");
  const impact = q.data ?? null;
  const blockers = impact ? activeBlockers(impact) : [];
  const confirm = async () => {
    const body = impactBody(reason, blockers.length > 0);
    const ok = await act.run(async () => { await api.patch<unknown>(`/foundation/items/${row.id}`, body); return true; }, t("fnd.deactivated"));
    if (ok) onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("fnd.it.deactivateTitle", { name: row.name })}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button variant={blockers.length ? "danger" : "primary"} loading={act.busy} disabled={!confirmEnabled(impact, reason)} onClick={() => void confirm()}>{blockers.length ? t("fnd.i.confirmAnyway") : t("fnd.i.confirm")}</Button></>}>
      <div class="eng-form">
        {q.error ? <InlineAlert tone="danger">{q.error.message}</InlineAlert> : null}
        {!impact && !q.error ? <p class="eng-muted">{t("fnd.i.loading")}</p> : null}
        {impact && !blockers.length ? <InlineAlert tone="success">{t("fnd.i.clean")}</InlineAlert> : null}
        {blockers.length ? <InlineAlert tone="warn" title={t("fnd.i.blockers")}><ul class="eng-issues">{blockers.map((b) => <li key={b.type}><strong>{formatNumber(b.count)}</strong> {b.label}</li>)}</ul></InlineAlert> : null}
        {blockers.length ? <Field label={t("fnd.i.reason")} hint={t("fnd.i.reasonHint")} required><Textarea value={reason} maxLength={500} onInput={(e) => setReason(val(e))} /></Field> : null}
      </div>
    </Dialog>
  );
}

