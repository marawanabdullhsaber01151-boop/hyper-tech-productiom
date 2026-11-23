import "../../copy/transfers";
import { useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Banner, Button, Card, Dialog, EmptyState, Field, InlineAlert, Input, Select, StatusPill, Textarea, useToast, type Tone } from "../../design/components";
import { Plus } from "../../design/icons";
import { useMutation, useQuery } from "../../api/hooks";
import { formatDate, formatMoney, formatRelative } from "../../lib/format";
import { api } from "../api";
import { ListSkeleton, LoadError } from "./shared";

interface Report {
  id: number;
  reportNumber: string;
  amount: string;
  transferDate: string;
  method: "bank" | "instapay" | "wallet";
  reference: string;
  note: string | null;
  status: "pending" | "confirmed" | "rejected";
  reportedByName: string;
  confirmedAmount: string | null;
  rejectReason: string | null;
  createdAt: string;
}

const TONE: Record<Report["status"], Tone> = { pending: "warn", confirmed: "success", rejected: "danger" };
const val = (e: Event) => (e.target as HTMLInputElement).value;
const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const AMOUNT_RE = /^\d{1,12}(\.\d{1,2})?$/;

/** العميل يبلّغ عن تحويل ويتابع حالته. البلاغ مش بيسجّل فلوس لوحده: المالية بتأكّد أو بترفض. */
export function Payments() {
  const q = useQuery((signal) => api.get<{ items: Report[] }>("/portal/payments/reports", { signal }), []);
  const [form, setForm] = useState(false);
  const rows = q.data?.items ?? [];
  return (
    <div class="pt-stack">
      <div class="pt-page-head">
        <div class="pt-stack">
          <h1 class="pt-page-title">{t("tr.p.title")}</h1>
          <p class="pt-muted">{t("tr.p.sub")}</p>
        </div>
        <Button icon={Plus} onClick={() => setForm(true)}>{t("tr.p.new")}</Button>
      </div>
      <Banner tone="info">{t("tr.p.note")} {t("tr.p.wait")}</Banner>
      {q.error ? <LoadError error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.loading && !q.data ? <ListSkeleton /> : null}
      {q.data && rows.length === 0 ? <EmptyState title={t("tr.p.empty")} description={t("tr.p.emptyBody")} /> : null}
      <div class="pt-list">
        {rows.map((r) => (
          <Card key={r.id} class="pt-stack" pad>
            <div class="pt-row pt-row--between">
              <strong>{r.reportNumber} · {formatMoney(Number(r.amount))}</strong>
              <StatusPill tone={TONE[r.status]} pulse={r.status === "pending"}>{t(`tr.s.${r.status}` as CopyKey)}</StatusPill>
            </div>
            <span class="pt-muted">{formatDate(r.transferDate)} · {t(`tr.m.${r.method}` as CopyKey)} · {r.reference}</span>
            {r.status === "confirmed" && r.confirmedAmount ? <p>{t("tr.p.confirmedAs", { n: formatMoney(Number(r.confirmedAmount)) })}</p> : null}
            {r.status === "rejected" && r.rejectReason ? <InlineAlert tone="warn">{t("tr.p.rejectedWhy", { r: r.rejectReason })}</InlineAlert> : null}
            <span class="pt-muted">{t("tr.p.sent", { when: formatRelative(r.createdAt), name: r.reportedByName })}</span>
          </Card>
        ))}
      </div>
      {form ? <ReportForm onClose={() => setForm(false)} onDone={() => { setForm(false); void q.refetch(); }} /> : null}
    </div>
  );
}

function ReportForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(cairoToday());
  const [method, setMethod] = useState("bank");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const send = useMutation(async () => {
    await api.post("/portal/payments/reports", { amount: amount.trim(), transferDate: date, method, reference: reference.trim(), note: note.trim() || null });
    toast({ tone: "success", message: t("tr.p.saved") });
    onDone();
  });
  const amountOk = AMOUNT_RE.test(amount.trim()) && Number(amount) > 0;
  const ok = amountOk && reference.trim().length >= 3 && date !== "" && date <= cairoToday();
  return (
    <Dialog open onClose={onClose} title={t("tr.p.formTitle")} description={t("tr.p.formDesc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("tr.f.cancel")}</Button><Button loading={send.loading} disabled={!ok} onClick={() => void send.mutate(undefined)}>{t("tr.f.send")}</Button></>}>
      <div class="pt-stack">
        <Field label={t("tr.f.amount")} hint={t("tr.f.amountHint")} required error={amount && !amountOk ? t("tr.f.amountHint") : undefined}>
          <Input inputMode="decimal" dir="ltr" value={amount} onInput={(e) => setAmount(val(e))} />
        </Field>
        <Field label={t("tr.f.date")} required><Input type="date" max={cairoToday()} value={date} onInput={(e) => setDate(val(e))} /></Field>
        <Field label={t("tr.f.method")} required>
          <Select value={method} onChange={(e) => setMethod(val(e))} options={(["bank", "instapay", "wallet"] as const).map((m) => ({ value: m, label: t(`tr.m.${m}` as CopyKey) }))} />
        </Field>
        <Field label={t("tr.f.reference")} hint={t("tr.f.referenceHint")} required>
          <Input dir="ltr" value={reference} maxLength={120} onInput={(e) => setReference(val(e))} />
        </Field>
        <Field label={t("tr.f.note")}><Textarea value={note} maxLength={500} onInput={(e) => setNote(val(e))} /></Field>
        {send.error ? <InlineAlert tone="danger">{send.error.message}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}
