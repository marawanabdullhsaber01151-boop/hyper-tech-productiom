import "../copy/balances";
import { useMemo, useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, StatusPill, Textarea, useToast, type Column, type Tone } from "../design/components";
import { formatDate, formatMoney, formatNumber } from "../lib/format";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const k = (key: string) => key as CopyKey;
const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const TONE: Record<string, Tone> = { open: "warn", agreed: "success", disputed: "danger", resolved: "success", cancelled: "neutral" };

export interface ConfirmationRow {
  id: number;
  confirmationNumber: string;
  companyName: string;
  contactName: string;
  asOf: string;
  balance: string;
  dueDate: string;
  status: "open" | "agreed" | "disputed" | "resolved" | "cancelled";
  customerNote: string | null;
  customerAmount: string | null;
  resolutionNote: string | null;
}
interface ContactOpt { id: number; name: string; type?: string }

/** رصيد موجب = عليه، سالب = له، صفر = متعادل. */
export const balanceLabel = (balance: string): string => {
  const n = Number(balance);
  return n > 0 ? t("bc.st.owes", { n: formatMoney(n) }) : n < 0 ? t("bc.st.credit", { n: formatMoney(-n) }) : t("bc.st.zero");
};
export const isLate = (r: Pick<ConfirmationRow, "status" | "dueDate">, today: string): boolean => r.status === "open" && r.dueDate < today;

/** تأكيد الأرصدة: المالية بتطلب من العميل يؤكد رصيده، وبتتابع الردود، وبتقفل الاعتراضات. */
export function BalanceConfirmations() {
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [resolving, setResolving] = useState<ConfirmationRow | null>(null);
  const [cancelling, setCancelling] = useState<ConfirmationRow | null>(null);
  const q = useQuery((signal) => api.get<{ items: ConfirmationRow[]; attention: { disputed: number; overdue: number } }>("/balance-confirmations", { signal, query: status ? { status } : {} }), [status]);
  const refresh = () => void q.refetch();
  const today = cairoToday();
  const attn = q.data?.attention;
  const cols: Column<ConfirmationRow>[] = [
    { key: "n", header: t("bc.st.c.number"), cell: (r) => r.confirmationNumber, mobile: "title" },
    { key: "c", header: t("bc.st.c.company"), cell: (r) => r.companyName },
    { key: "a", header: t("bc.st.c.asOf"), cell: (r) => formatDate(r.asOf), mobile: "hide" },
    { key: "b", header: t("bc.st.c.balance"), cell: (r) => balanceLabel(r.balance) },
    { key: "d", header: t("bc.st.c.due"), cell: (r) => formatDate(r.dueDate), mobile: "hide" },
    {
      key: "s",
      header: t("bc.st.c.status"),
      cell: (r) => (
        <span>
          <StatusPill tone={TONE[r.status]}>{t(k(`bc.st.s.${r.status}`))}</StatusPill>
          {isLate(r, today) ? <StatusPill tone="danger">{t("bc.st.overdue")}</StatusPill> : null}
        </span>
      ),
    },
    {
      key: "x",
      header: " ",
      cell: (r) => (
        <span class="eng-actions">
          {r.status === "disputed" ? <Button size="sm" onClick={() => setResolving(r)}>{t("bc.st.resolve")}</Button> : null}
          {r.status === "open" || r.status === "disputed" ? <Button size="sm" variant="secondary" onClick={() => setCancelling(r)}>{t("bc.st.cancel")}</Button> : null}
        </span>
      ),
    },
  ];
  return (
    <div class="ad-stack">
      <p class="eng-muted">{t("bc.st.hint")}</p>
      {attn && (attn.disputed > 0 || attn.overdue > 0) ? <InlineAlert tone="warn">{t("bc.st.attn", { d: formatNumber(attn.disputed), o: formatNumber(attn.overdue) })}</InlineAlert> : null}
      <div class="eng-toolbar">
        <Field label={t("bc.st.filter")}>
          <Select value={status} onChange={(e) => setStatus(val(e))} options={[{ value: "", label: t("bc.st.all") }, ...(["open", "disputed", "agreed", "resolved", "cancelled"] as const).map((s) => ({ value: s, label: t(k(`bc.st.s.${s}`)) }))]} />
        </Field>
        <Button onClick={() => setCreating(true)}>{t("bc.st.new")}</Button>
      </div>
      {q.error ? <InlineAlert tone="danger" title={t("bc.st.err")}>{q.error.message}</InlineAlert> : null}
      <DataTable columns={cols} rows={q.data?.items ?? []} rowKey={(r) => r.id} caption={t("bc.tab")} loading={q.loading} empty={<EmptyState compact title={t("bc.st.none")} />} />
      {creating ? <NewDialog onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); }} /> : null}
      {resolving ? <ResolveDialog row={resolving} onClose={() => setResolving(null)} onDone={() => { setResolving(null); refresh(); }} /> : null}
      {cancelling ? <CancelDialog row={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); refresh(); }} /> : null}
    </div>
  );
}

function NewDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const toast = useToast();
  const contacts = useQuery((signal) => api.get<ContactOpt[]>("/contacts", { signal }), []);
  const customers = useMemo(() => (contacts.data ?? []).filter((c) => c.type !== "supplier"), [contacts.data]);
  const [contactId, setContactId] = useState("");
  const [asOf, setAsOf] = useState(cairoToday());
  const [note, setNote] = useState("");
  const go = async () => {
    const r = await act.run(() => api.post<{ confirmationNumber: string }>("/balance-confirmations", { contactId: Number(contactId), asOf, note: note.trim() || null }));
    if (r) {
      toast({ tone: "success", message: t("bc.st.sent", { n: r.confirmationNumber }) });
      onDone();
    }
  };
  return (
    <Dialog open onClose={onClose} title={t("bc.st.newTitle")} description={t("bc.st.newDesc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("bc.st.close")}</Button><Button loading={act.busy} disabled={!contactId || !asOf || asOf > cairoToday()} onClick={() => void go()}>{t("bc.st.send")}</Button></>}>
      <div class="eng-form">
        <Field label={t("bc.st.customer")} required>
          <Select value={contactId} onChange={(e) => setContactId(val(e))} options={[{ value: "", label: t("bc.st.pick") }, ...customers.map((c) => ({ value: String(c.id), label: c.name }))]} />
        </Field>
        <Field label={t("bc.st.asOf")} required><Input type="date" max={cairoToday()} value={asOf} onInput={(e) => setAsOf(val(e))} /></Field>
        <Field label={t("bc.st.note")}><Textarea value={note} maxLength={300} onInput={(e) => setNote(val(e))} /></Field>
      </div>
    </Dialog>
  );
}

function ResolveDialog({ row, onClose, onDone }: { row: ConfirmationRow; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [note, setNote] = useState("");
  const go = async () => {
    const r = await act.run(() => api.post(`/balance-confirmations/${row.id}/resolve`, { note: note.trim() }), t("bc.st.resolved"));
    if (r) onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("bc.st.resolveTitle", { n: row.confirmationNumber })} description={t("bc.st.resolveDesc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("bc.st.close")}</Button><Button loading={act.busy} disabled={note.trim().length < 3} onClick={() => void go()}>{t("bc.st.resolveGo")}</Button></>}>
      <div class="eng-form">
        <p>{t("bc.st.snapshot", { n: balanceLabel(row.balance) })}</p>
        {row.customerNote ? <p class="eng-muted">{t("bc.st.theirNote", { t: row.customerNote })}</p> : null}
        {row.customerAmount ? <p class="eng-muted">{t("bc.st.theirAmount", { n: formatMoney(Number(row.customerAmount)) })}</p> : null}
        <Field label={t("bc.st.resolveNote")} required><Textarea value={note} maxLength={500} onInput={(e) => setNote(val(e))} /></Field>
      </div>
    </Dialog>
  );
}

function CancelDialog({ row, onClose, onDone }: { row: ConfirmationRow; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [reason, setReason] = useState("");
  const go = async () => {
    const r = await act.run(() => api.post(`/balance-confirmations/${row.id}/cancel`, { reason: reason.trim() }), t("bc.st.cancelled"));
    if (r) onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("bc.st.cancelTitle", { n: row.confirmationNumber })} description={t("bc.st.cancelDesc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("bc.st.close")}</Button><Button loading={act.busy} disabled={reason.trim().length < 3} onClick={() => void go()}>{t("bc.st.cancelGo")}</Button></>}>
      <div class="eng-form">
        <Field label={t("bc.st.cancelReason")} required><Textarea value={reason} maxLength={500} onInput={(e) => setReason(val(e))} /></Field>
      </div>
    </Dialog>
  );
}
