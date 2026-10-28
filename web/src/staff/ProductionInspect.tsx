import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, StatusPill, Textarea, type Column } from "../design/components";
import { Check, X } from "../design/icons";
import { formatDateTime, formatNumber } from "../lib/format";
import {
  QUALITY_PASS_RATE,
  addTag,
  autoFailed,
  canDecideQuality,
  checklistScore,
  inspectable,
  inspectionBody,
  inspectionError,
  predictedVerdict,
  sampleRate,
  topTags,
  type InspectionError,
} from "./qualityRules";

interface OrderRow {
  id: number;
  orderNumber: string;
  productName: string;
  qty: string;
  unit: string;
  workflowStatus: string;
  qualityControllerUserId?: number | null;
  supervisorName?: string | null;
  productionLine?: string | null;
}
interface RecordRow {
  id: number;
  orderNumber: string;
  qualityStatus: string;
  qualityNotes: string | null;
  sampleSize: number | null;
  samplePassedCount: number | null;
  defectTags: unknown;
  recordedByName: string;
  createdAt: string;
}
interface CheckItem { label: string; ok: boolean }

const val = (e: Event) => (e.target as HTMLInputElement).value;
const CHECKLIST_KEY = "hyper_qc_last_checklist";
const readChecklist = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(CHECKLIST_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 30) : [];
  } catch { return []; }
};

/** فحص الجودة: أوامر بانتظار قرارك، نموذج الفحص (عينة، عيوب، قايمة فحص، تقييم)، وسجل الفحوصات السابقة. */
export function ProductionInspect() {
  const user = staffUser();
  const role = user?.role ?? "";
  const [open, setOpen] = useState<OrderRow | null>(null);
  const orders = useQuery((signal) => api.get<OrderRow[]>("/production-workflow", { signal }), []);
  const records = useQuery((signal) => api.get<RecordRow[]>("/production-workflow/quality-records", { signal }).catch(() => [] as RecordRow[]), []);
  const all = Array.isArray(orders.data) ? orders.data : [];
  const pending = inspectable(all, role, user?.id);
  const history = Array.isArray(records.data) ? records.data : [];
  const decide = canDecideQuality(role);

  const cols: Column<OrderRow>[] = [
    { key: "no", header: t("prd.insp.col.no"), cell: (r) => <strong>{r.orderNumber}</strong>, mobile: "title" },
    { key: "product", header: t("prd.insp.col.product"), cell: (r) => `${r.productName} | ${formatNumber(Number(r.qty))} ${r.unit}` },
    { key: "sup", header: t("prd.insp.col.supervisor"), cell: (r) => r.supervisorName ?? "—", mobile: "hide" },
    { key: "line", header: t("prd.insp.col.line"), cell: (r) => r.productionLine ?? "—", mobile: "hide" },
    { key: "act", header: t("prd.insp.col.action"), cell: (r) => (decide ? <Button size="sm" onClick={() => setOpen(r)}>{t("prd.insp.start")}</Button> : null) },
  ];
  const hcols: Column<RecordRow>[] = [
    { key: "no", header: t("prd.insp.col.no"), cell: (r) => <strong>{r.orderNumber}</strong>, mobile: "title" },
    { key: "res", header: t("prd.insp.col.result"), cell: (r) => <StatusPill tone={r.qualityStatus === "passed" ? "success" : "danger"}>{t(r.qualityStatus === "passed" ? "prd.insp.passed" : "prd.insp.failed")}</StatusPill> },
    { key: "rate", header: t("prd.insp.col.rate"), cell: (r) => { const p = r.sampleSize ? sampleRate(String(r.sampleSize), String(r.samplePassedCount ?? "")) : null; return p === null ? "—" : `${formatNumber(p)}%`; }, numeric: true, mobile: "hide" },
    { key: "defects", header: t("prd.insp.col.defects"), cell: (r) => (Array.isArray(r.defectTags) && r.defectTags.length ? r.defectTags.join(t("prd.insp.sep")) : "—"), mobile: "hide" },
    { key: "by", header: t("prd.insp.col.by"), cell: (r) => r.recordedByName, mobile: "hide" },
    { key: "when", header: t("prd.insp.col.when"), cell: (r) => formatDateTime(r.createdAt) },
  ];

  return (
    <>
      <p class="prd-muted">{t("prd.insp.flow")}</p>
      {orders.error ? <InlineAlert tone="danger" title={t("prd.err")} action={<Button size="sm" variant="secondary" onClick={() => void orders.refetch()}>{t("common.retry")}</Button>}>{orders.error.message}</InlineAlert> : null}
      <h3 class="prd-h">{t("prd.insp.pending", { n: formatNumber(pending.length) })}</h3>
      <DataTable columns={cols} rows={pending} rowKey={(r) => r.id} caption={t("prd.insp.caption")} loading={orders.loading} empty={<EmptyState title={t("prd.insp.empty")} compact />} />
      <h3 class="prd-h">{t("prd.insp.history")}</h3>
      <DataTable columns={hcols} rows={history.slice(0, 30)} rowKey={(r) => r.id} caption={t("prd.insp.historyCaption")} loading={records.loading} empty={<EmptyState title={t("prd.insp.historyEmpty")} compact />} />
      {open ? <InspectDialog row={open} suggestions={topTags(history)} onClose={() => setOpen(null)} onDone={async () => { setOpen(null); await Promise.all([orders.refetch(), records.refetch()]); }} /> : null}
    </>
  );
}

function InspectDialog({ row, suggestions, onClose, onDone }: { row: OrderRow; suggestions: string[]; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const [size, setSize] = useState("");
  const [passed, setPassed] = useState("");
  const [failedManual, setFailedManual] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagText, setTagText] = useState("");
  const [items, setItems] = useState<CheckItem[]>([]);
  const [itemText, setItemText] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const failed = failedManual ?? autoFailed(size, passed);
  const rate = sampleRate(size, passed);
  const verdict = predictedVerdict(rate);
  const last = readChecklist();
  const score = checklistScore(items);

  const input = (status: "passed" | "failed") => ({ status, notes, size, passed, failed });
  const errPass = inspectionError(input("passed"));
  const errFail = inspectionError(input("failed"));

  const send = async (status: "passed" | "failed") => {
    const ok = await act.run(async () => {
      await api.patch<unknown>(`/production-workflow/${row.id}/quality-done`, inspectionBody(input(status), rating, tags, items));
      return true;
    }, t(status === "passed" ? "prd.insp.donePassed" : "prd.insp.doneFailed"));
    if (ok) {
      if (items.length) { try { localStorage.setItem(CHECKLIST_KEY, JSON.stringify(items.map((i) => i.label))); } catch { /* التخزين اختياري */ } }
      await onDone();
    }
  };
  const addItem = () => { const l = itemText.trim(); if (l && !items.some((i) => i.label === l)) setItems([...items, { label: l, ok: false }]); setItemText(""); };
  const msg = (e: InspectionError | null) => (e ? t(`prd.insp.err.${e}` as CopyKey, { rate: QUALITY_PASS_RATE }) : "");

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("prd.insp.title", { no: row.orderNumber })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="secondary" icon={X} loading={act.busy} disabled={errFail !== null} onClick={() => void send("failed")}>{t("prd.insp.fail")}</Button>
          <Button icon={Check} loading={act.busy} disabled={errPass !== null} onClick={() => void send("passed")}>{t("prd.insp.pass")}</Button>
        </>
      }
    >
      <div class="prd-form">
        <p><strong>{row.productName}</strong> | {formatNumber(Number(row.qty))} {row.unit}</p>
        <h3 class="prd-h">{t("prd.insp.sample")}</h3>
        <Field label={t("prd.insp.size")}><Input inputMode="numeric" value={size} onInput={(e) => setSize(val(e))} /></Field>
        <Field label={t("prd.insp.samplePassed")}><Input inputMode="numeric" value={passed} onInput={(e) => setPassed(val(e))} /></Field>
        <Field label={t("prd.insp.sampleFailed")} hint={failedManual === null && failed ? t("prd.insp.autoFailed") : undefined}><Input inputMode="numeric" value={failed} onInput={(e) => setFailedManual(val(e))} /></Field>
        {rate !== null ? <p role="status" class="prd-muted">{t("prd.insp.rate", { rate: formatNumber(rate), verdict: t(verdict === "pass" ? "prd.insp.verdict.pass" : "prd.insp.verdict.fail") })}</p> : <p class="prd-muted">{t("prd.insp.rateHint")}</p>}

        <h3 class="prd-h">{t("prd.insp.defects")}</h3>
        <div class="prd-actions">
          {tags.map((x) => <Button key={x} size="sm" variant="secondary" icon={X} onClick={() => setTags(tags.filter((y) => y !== x))}>{x}</Button>)}
        </div>
        <Field label={t("prd.insp.defectAdd")}>
          <Input value={tagText} onInput={(e) => setTagText(val(e))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setTags(addTag(tags, tagText)); setTagText(""); } }} />
        </Field>
        <div class="prd-actions">
          <Button size="sm" variant="ghost" onClick={() => { setTags(addTag(tags, tagText)); setTagText(""); }}>{t("prd.insp.add")}</Button>
          {suggestions.filter((x) => !tags.includes(x)).map((x) => <Button key={x} size="sm" variant="ghost" onClick={() => setTags(addTag(tags, x))}>{x}</Button>)}
        </div>

        <h3 class="prd-h">{t("prd.insp.checklist")}{score.total ? ` (${formatNumber(score.ok)}/${formatNumber(score.total)})` : ""}</h3>
        {items.map((it, i) => (
          <label key={it.label} class="prd-kv">
            <span>{it.label}</span>
            <input type="checkbox" checked={it.ok} aria-label={it.label} onChange={() => setItems(items.map((x, j) => (j === i ? { ...x, ok: !x.ok } : x)))} />
          </label>
        ))}
        <Field label={t("prd.insp.itemAdd")}>
          <Input value={itemText} onInput={(e) => setItemText(val(e))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} />
        </Field>
        <div class="prd-actions">
          <Button size="sm" variant="ghost" onClick={addItem}>{t("prd.insp.add")}</Button>
          {last.length && !items.length ? <Button size="sm" variant="ghost" onClick={() => setItems(last.map((label) => ({ label, ok: false })))}>{t("prd.insp.useLast", { n: formatNumber(last.length) })}</Button> : null}
        </div>

        <h3 class="prd-h">{t("prd.insp.rating")}</h3>
        <div class="prd-actions" role="group" aria-label={t("prd.insp.rating")}>
          {[1, 2, 3, 4, 5].map((n) => <Button key={n} size="sm" variant={rating === n ? "primary" : "secondary"} aria-pressed={rating === n} aria-label={t("prd.insp.star", { n })} onClick={() => setRating(rating === n ? null : n)}>{n}</Button>)}
        </div>

        <Field label={t("prd.insp.notes")} error={notes.trim().length < 3 && (errPass === "lowRateNeedsNotes") ? msg(errPass) : undefined}>
          <Textarea rows={2} maxLength={500} value={notes} onInput={(e) => setNotes(val(e))} />
        </Field>
        {errPass === "sampleOver" || errPass === "sampleIncomplete" || errPass === "badNumber" ? <InlineAlert tone="warn">{msg(errPass)}</InlineAlert> : null}
        {errFail === "notesOnFail" && !errPass ? <p class="prd-muted">{t("prd.insp.err.notesOnFail")}</p> : null}
      </div>
    </Dialog>
  );
}
