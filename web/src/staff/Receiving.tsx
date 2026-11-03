import "../copy/receiving";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, Textarea, type Column } from "../design/components";
import { formatDateTime, formatNumber } from "../lib/format";
import { RECEIVING_PAGE_ROLES } from "./staffRoles";
import { canInspect, checkDecisions, defaultDecisions, receiptStats, receiptTone, rejectedOf, setAll, type DecisionInput, type Receipt } from "./receivingCore";
import "./Engineering.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const k = (key: string) => key as CopyKey;
const n3 = (v: string | number) => formatNumber(Math.round(Number(v) * 1000) / 1000);

/** فحص الخامات الواردة: إيصالات الاستلام بتستنى هنا، والمقبول بس بيدخل المخزون. */
export function Receiving() {
  const role = staffUser()?.role ?? "";
  const allowed = (RECEIVING_PAGE_ROLES as readonly string[]).includes(role);
  const [filter, setFilter] = useState<"pending_inspection" | "all">("pending_inspection");
  const q = useQuery((signal) => (allowed ? api.get<Receipt[]>("/purchases/receipts", { signal }) : Promise.resolve([] as Receipt[])), [allowed]);
  const [open, setOpen] = useState<{ receipt: Receipt; mode: "inspect" | "view" } | null>(null);
  if (!allowed) return <div class="ad-page"><InlineAlert tone="warn">{t("rcv.noAccess")}</InlineAlert></div>;
  const all = Array.isArray(q.data) ? q.data : [];
  const stats = receiptStats(all);
  const shown = filter === "all" ? all : all.filter((r) => r.status === "pending_inspection");
  const cols: Column<Receipt>[] = [
    { key: "no", header: t("rcv.col.number"), cell: (r) => <strong>{r.receiptNumber}</strong>, mobile: "title" },
    { key: "po", header: t("rcv.col.po"), cell: (r) => r.poNumber },
    { key: "sup", header: t("rcv.col.supplier"), cell: (r) => r.supplierName ?? "-", mobile: "hide" },
    { key: "by", header: t("rcv.col.receivedBy"), cell: (r) => r.receivedByName ?? "-", mobile: "hide" },
    { key: "at", header: t("rcv.col.receivedAt"), cell: (r) => formatDateTime(r.receivedAt), mobile: "hide" },
    { key: "st", header: t("rcv.col.status"), cell: (r) => <StatusPill tone={receiptTone(r.status)}>{t(k(`rcv.status.${r.status}`))}</StatusPill> },
    {
      key: "act", header: t("rcv.col.action"),
      cell: (r) => r.status === "pending_inspection"
        ? (canInspect(role) ? <Button size="sm" onClick={() => setOpen({ receipt: r, mode: "inspect" })}>{t("rcv.inspect")}</Button> : <span class="eng-muted">{t("rcv.waiting")}</span>)
        : <Button size="sm" variant="secondary" onClick={() => setOpen({ receipt: r, mode: "view" })}>{t("rcv.view")}</Button>,
    },
  ];
  return (
    <div class="ad-page">
      <div>
        <h1 class="ad-title">{t("rcv.title")}</h1>
        <p class="st-login__sub">{t("rcv.subtitle")}</p>
      </div>
      <div class="eng-stats">
        <Stat label={t("rcv.stat.pending")} value={formatNumber(stats.pending)} />
        <Stat label={t("rcv.stat.accepted")} value={formatNumber(stats.accepted)} />
        <Stat label={t("rcv.stat.partial")} value={formatNumber(stats.partial)} />
        <Stat label={t("rcv.stat.rejected")} value={formatNumber(stats.rejected)} />
      </div>
      <div class="eng-toolbar">
        <Select aria-label={t("rcv.col.status")} value={filter} onChange={(e) => setFilter(val(e) as "pending_inspection" | "all")} options={[{ value: "pending_inspection", label: t("rcv.filter.pending") }, { value: "all", label: t("rcv.filter.all") }]} />
      </div>
      {q.error ? <InlineAlert tone="danger" title={t("rcv.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert> : null}
      <DataTable columns={cols} rows={shown} rowKey={(r) => r.id} caption={t("rcv.title")} loading={q.loading} empty={<EmptyState title={filter === "all" ? t("rcv.empty") : t("rcv.emptyPending")} compact />} />
      {open?.mode === "inspect" ? <InspectDialog receipt={open.receipt} onClose={() => setOpen(null)} onDone={() => { setOpen(null); void q.refetch(); }} /> : null}
      {open?.mode === "view" ? <ViewDialog receipt={open.receipt} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function InspectDialog({ receipt, onClose, onDone }: { receipt: Receipt; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [input, setInput] = useState<Record<number, DecisionInput>>(() => defaultDecisions(receipt.lines));
  const [notes, setNotes] = useState("");
  const [tried, setTried] = useState(false);
  const chk = checkDecisions(receipt.lines, input);
  const set = (id: number, patch: Partial<DecisionInput>) => setInput((x) => ({ ...x, [id]: { ...(x[id] ?? { accepted: "", reason: "" }), ...patch } }));
  const save = async () => {
    setTried(true);
    if (!chk.ok) return;
    const r = await act.run(() => api.post<Receipt>(`/purchases/receipts/${receipt.id}/inspect`, { decisions: chk.payload, notes: notes.trim() || undefined }), t("rcv.done"));
    if (r) onDone();
  };
  const errText = { qty: t("rcv.err.qty"), over: t("rcv.err.over"), reason: t("rcv.err.reason") };
  return (
    <Dialog open onClose={onClose} title={t("rcv.dlg.title", { n: receipt.receiptNumber })} description={t("rcv.dlg.desc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} onClick={() => void save()}>{t("rcv.dlg.save")}</Button></>}>
      <div class="eng-form">
        <div class="eng-actions">
          <Button size="sm" variant="secondary" onClick={() => setInput((x) => setAll(receipt.lines, "accept", x))}>{t("rcv.dlg.acceptAll")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setInput((x) => setAll(receipt.lines, "reject", x))}>{t("rcv.dlg.rejectAll")}</Button>
        </div>
        {receipt.lines.map((l) => {
          const d = input[l.id];
          const rej = rejectedOf(l, d);
          const err = tried ? chk.errors[l.id] : undefined;
          return (
            <div key={l.id} class="eng-form">
              <strong>{l.description}</strong>
              <span class="eng-muted">{t("rcv.dlg.received", { q: n3(l.qtyReceived), unit: l.unit ?? "" })}</span>
              <Field label={t("rcv.dlg.accepted")} error={err && err !== "reason" ? errText[err] : undefined}>
                <Input inputMode="decimal" value={d?.accepted ?? ""} onInput={(e) => set(l.id, { accepted: val(e) })} />
              </Field>
              {rej > 0 ? (
                <Field label={t("rcv.dlg.reason")} hint={`${t("rcv.dlg.rejectedNow", { q: n3(rej), unit: l.unit ?? "" })} - ${t("rcv.dlg.reasonHint")}`} error={err === "reason" ? errText.reason : undefined} required>
                  <Textarea value={d?.reason ?? ""} maxLength={300} onInput={(e) => set(l.id, { reason: val(e) })} />
                </Field>
              ) : null}
            </div>
          );
        })}
        <Field label={t("rcv.dlg.notes")}><Textarea value={notes} maxLength={500} onInput={(e) => setNotes(val(e))} /></Field>
        {chk.ok ? <InlineAlert tone={chk.rejectedTotal > 0 ? "warn" : "success"}>{t("rcv.dlg.summary", { a: n3(chk.acceptedTotal), r: n3(chk.rejectedTotal) })}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}

function ViewDialog({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title={t("rcv.detail.title", { n: receipt.receiptNumber })} footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}>
      <div class="eng-form">
        {receipt.inspectedByName ? <p>{t("rcv.detail.inspector", { name: receipt.inspectedByName })}</p> : null}
        {receipt.inspectionNotes ? <p>{t("rcv.detail.notes", { notes: receipt.inspectionNotes })}</p> : null}
        <ul class="eng-issues">
          {receipt.lines.map((l) => (
            <li key={l.id}>
              {t("rcv.detail.line", { name: l.description, r: n3(l.qtyReceived), a: n3(l.qtyAccepted ?? 0), x: n3(l.qtyRejected ?? 0), unit: l.unit ?? "" })}
              {l.rejectReason ? <div class="eng-muted">{t("rcv.detail.reason", { reason: l.rejectReason })}</div> : null}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
