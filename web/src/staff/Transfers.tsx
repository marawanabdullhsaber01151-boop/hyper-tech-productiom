import "../copy/transfers";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, StatusPill, Textarea, useToast, type Column, type Tone } from "../design/components";
import { formatDate, formatMoney, formatNumber } from "../lib/format";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const k = (key: string) => key as CopyKey;
const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const AMOUNT_RE = /^\d{1,12}(\.\d{1,2})?$/;
const TONE: Record<string, Tone> = { pending: "warn", confirmed: "success", rejected: "danger" };

export interface TransferRow {
  id: number;
  reportNumber: string;
  companyName: string;
  reportedByName: string;
  amount: string;
  transferDate: string;
  method: "bank" | "instapay" | "wallet";
  reference: string;
  note: string | null;
  status: "pending" | "confirmed" | "rejected";
  paymentNumber: string | null;
  confirmedAmount: string | null;
  rejectReason: string | null;
}

/** المبلغ المقترح لطريقة التسجيل: المحفظة نقدي، والباقي بنك (نفس قاعدة السيرفر). */
export const suggestedMethod = (m: TransferRow["method"]): "cash" | "bank" => (m === "wallet" ? "cash" : "bank");

/** تحويلات العملاء: المالية بتراجع بلاغات العملاء وتأكّد (يتسجّل تحصيل رسمي) أو ترفض بسبب. */
export function Transfers() {
  const [status, setStatus] = useState("pending");
  const [confirming, setConfirming] = useState<TransferRow | null>(null);
  const [rejecting, setRejecting] = useState<TransferRow | null>(null);
  const q = useQuery((signal) => api.get<{ items: TransferRow[]; pending: number }>("/transfer-reports", { signal, query: status ? { status } : {} }), [status]);
  const refresh = () => void q.refetch();
  const cols: Column<TransferRow>[] = [
    { key: "n", header: t("tr.st.c.number"), cell: (r) => r.reportNumber, mobile: "title" },
    { key: "c", header: t("tr.st.c.company"), cell: (r) => r.companyName },
    { key: "d", header: t("tr.st.c.date"), cell: (r) => formatDate(r.transferDate), mobile: "hide" },
    { key: "m", header: t("tr.st.c.method"), cell: (r) => t(k(`tr.m.${r.method}`)), mobile: "hide" },
    { key: "a", header: t("tr.st.c.amount"), cell: (r) => formatMoney(Number(r.amount)) },
    { key: "r", header: t("tr.st.c.ref"), cell: (r) => <span dir="ltr">{r.reference}</span>, mobile: "hide" },
    { key: "s", header: t("tr.st.c.status"), cell: (r) => <StatusPill tone={TONE[r.status]}>{t(k(`tr.s.${r.status}`))}</StatusPill> },
    {
      key: "x",
      header: " ",
      cell: (r) =>
        r.status === "pending" ? (
          <span class="eng-actions">
            <Button size="sm" onClick={() => setConfirming(r)}>{t("tr.st.confirm")}</Button>
            <Button size="sm" variant="secondary" onClick={() => setRejecting(r)}>{t("tr.st.reject")}</Button>
          </span>
        ) : r.paymentNumber ? (
          <span class="eng-muted">{r.paymentNumber}</span>
        ) : null,
    },
  ];
  const pending = q.data?.pending ?? 0;
  return (
    <div class="ad-stack">
      <p class="eng-muted">{t("tr.st.hint")}</p>
      {pending > 0 ? <InlineAlert tone="warn">{t("tr.st.pending", { n: formatNumber(pending) })}</InlineAlert> : null}
      <div class="eng-toolbar">
        <Field label={t("tr.st.filter")}>
          <Select value={status} onChange={(e) => setStatus(val(e))} options={[{ value: "", label: t("tr.st.all") }, { value: "pending", label: t("tr.s.pending") }, { value: "confirmed", label: t("tr.s.confirmed") }, { value: "rejected", label: t("tr.s.rejected") }]} />
        </Field>
      </div>
      {q.error ? <InlineAlert tone="danger" title={t("tr.st.err")}>{q.error.message}</InlineAlert> : null}
      <DataTable columns={cols} rows={q.data?.items ?? []} rowKey={(r) => r.id} caption={t("tr.tab")} loading={q.loading} empty={<EmptyState compact title={t("tr.st.none")} />} />
      {confirming ? <ConfirmDialog row={confirming} onClose={() => setConfirming(null)} onDone={() => { setConfirming(null); refresh(); }} /> : null}
      {rejecting ? <RejectDialog row={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); refresh(); }} /> : null}
    </div>
  );
}

function Summary({ row }: { row: TransferRow }) {
  return (
    <>
      <p>{t("tr.st.reported", { who: `${row.companyName} (${row.reportedByName})`, amount: formatMoney(Number(row.amount)), date: formatDate(row.transferDate), ref: row.reference })}</p>
      {row.note ? <p class="eng-muted">{t("tr.st.customerNote", { t: row.note })}</p> : null}
    </>
  );
}

function ConfirmDialog({ row, onClose, onDone }: { row: TransferRow; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const toast = useToast();
  const [amount, setAmount] = useState(row.amount);
  const [method, setMethod] = useState<string>(suggestedMethod(row.method));
  const [date, setDate] = useState(row.transferDate);
  const [note, setNote] = useState("");
  const amountOk = AMOUNT_RE.test(amount.trim()) && Number(amount) > 0;
  const differs = amountOk && Math.round(Number(amount) * 100) !== Math.round(Number(row.amount) * 100);
  const noteMissing = differs && note.trim().length < 3;
  const go = async () => {
    const r = await act.run(() => api.post<{ paymentNumber: string | null }>(`/transfer-reports/${row.id}/confirm`, { amount: amount.trim(), method, paymentDate: date, note: note.trim() || null }));
    if (r) {
      toast({ tone: "success", message: t("tr.st.confirmed", { n: r.paymentNumber ?? "" }) });
      onDone();
    }
  };
  return (
    <Dialog open onClose={onClose} title={t("tr.st.confirmTitle", { n: row.reportNumber })} description={t("tr.st.confirmDesc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("tr.st.close")}</Button><Button loading={act.busy} disabled={!amountOk || noteMissing || !date || date > cairoToday()} onClick={() => void go()}>{t("tr.st.confirmGo")}</Button></>}>
      <div class="eng-form">
        <Summary row={row} />
        <Field label={t("tr.st.amount")} hint={t("tr.st.amountHint")} required>
          <Input inputMode="decimal" dir="ltr" value={amount} onInput={(e) => setAmount(val(e))} />
        </Field>
        <Field label={t("tr.st.method")} required>
          <Select value={method} onChange={(e) => setMethod(val(e))} options={[{ value: "bank", label: t("tr.st.pm.bank") }, { value: "cash", label: t("tr.st.pm.cash") }]} />
        </Field>
        <Field label={t("tr.st.payDate")} required><Input type="date" max={cairoToday()} value={date} onInput={(e) => setDate(val(e))} /></Field>
        <Field label={t("tr.st.note")} error={noteMissing ? t("tr.st.noteNeeded") : undefined}><Textarea value={note} maxLength={500} onInput={(e) => setNote(val(e))} /></Field>
      </div>
    </Dialog>
  );
}

function RejectDialog({ row, onClose, onDone }: { row: TransferRow; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [reason, setReason] = useState("");
  const go = async () => {
    const r = await act.run(() => api.post(`/transfer-reports/${row.id}/reject`, { reason: reason.trim() }), t("tr.st.rejected"));
    if (r) onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("tr.st.rejectTitle", { n: row.reportNumber })} description={t("tr.st.rejectDesc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("tr.st.close")}</Button><Button loading={act.busy} disabled={reason.trim().length < 3} onClick={() => void go()}>{t("tr.st.rejectGo")}</Button></>}>
      <div class="eng-form">
        <Summary row={row} />
        <Field label={t("tr.st.reason")} required><Textarea value={reason} maxLength={500} onInput={(e) => setReason(val(e))} /></Field>
      </div>
    </Dialog>
  );
}
