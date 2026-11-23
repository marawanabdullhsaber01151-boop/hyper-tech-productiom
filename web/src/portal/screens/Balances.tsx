import "../../copy/balances";
import { useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Banner, Button, Card, Dialog, EmptyState, Field, InlineAlert, Input, StatusPill, Textarea, useToast, type Tone } from "../../design/components";
import { useMutation, useQuery } from "../../api/hooks";
import { formatDate, formatMoney, formatRelative } from "../../lib/format";
import { api } from "../api";
import { ListSkeleton, LoadError } from "./shared";

interface Line { kind: "invoice" | "payment"; date: string; number: string; note: string | null; debit: string; credit: string; balance: string }
interface Confirmation {
  id: number;
  confirmationNumber: string;
  asOf: string;
  balance: string;
  direction: "owes" | "credit" | "zero";
  periodFrom: string;
  opening: string;
  lines: Line[];
  note: string | null;
  dueDate: string;
  overdue: boolean;
  status: "open" | "agreed" | "disputed" | "resolved" | "cancelled";
  respondedByName: string | null;
  respondedAt: string | null;
  customerAmount: string | null;
  customerNote: string | null;
  resolutionNote: string | null;
}

const TONE: Record<Confirmation["status"], Tone> = { open: "warn", agreed: "success", disputed: "danger", resolved: "success", cancelled: "neutral" };
const val = (e: Event) => (e.target as HTMLInputElement).value;
const AMOUNT_RE = /^-?\d{1,12}(\.\d{1,2})?$/;
const money = (s: string) => formatMoney(Math.abs(Number(s)));

/** نص الرصيد بالاتجاه: عليك / ليك عندنا / متعادل. */
export const balanceText = (c: Pick<Confirmation, "balance" | "direction">): string =>
  c.direction === "owes" ? t("bc.p.owes", { n: money(c.balance) }) : c.direction === "credit" ? t("bc.p.credit", { n: money(c.balance) }) : t("bc.p.zero");

/** العميل يراجع رصيده اللي المالية طلبت تأكيده، ويوافق أو يعترض. الموافقة نهائية. */
export function Balances() {
  const q = useQuery((signal) => api.get<{ items: Confirmation[] }>("/portal/balances", { signal }), []);
  const [agreeing, setAgreeing] = useState<Confirmation | null>(null);
  const [disputing, setDisputing] = useState<Confirmation | null>(null);
  const rows = q.data?.items ?? [];
  const done = () => { setAgreeing(null); setDisputing(null); void q.refetch(); };
  return (
    <div class="pt-stack">
      <div class="pt-stack">
        <h1 class="pt-page-title">{t("bc.p.title")}</h1>
        <p class="pt-muted">{t("bc.p.sub")}</p>
      </div>
      <Banner tone="info">{t("bc.p.note")}</Banner>
      {q.error ? <LoadError error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.loading && !q.data ? <ListSkeleton /> : null}
      {q.data && rows.length === 0 ? <EmptyState title={t("bc.p.empty")} description={t("bc.p.emptyBody")} /> : null}
      <div class="pt-list">
        {rows.map((c) => <ConfirmationCard key={c.id} c={c} onAgree={() => setAgreeing(c)} onDispute={() => setDisputing(c)} />)}
      </div>
      {agreeing ? <AgreeDialog c={agreeing} onClose={() => setAgreeing(null)} onDone={done} /> : null}
      {disputing ? <DisputeDialog c={disputing} onClose={() => setDisputing(null)} onDone={done} /> : null}
    </div>
  );
}

function ConfirmationCard({ c, onAgree, onDispute }: { c: Confirmation; onAgree: () => void; onDispute: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Card class="pt-stack" pad>
      <div class="pt-row pt-row--between">
        <strong>{t("bc.p.asOf", { d: formatDate(c.asOf) })}</strong>
        <StatusPill tone={TONE[c.status]}>{t(`bc.p.s.${c.status}` as CopyKey)}</StatusPill>
      </div>
      <p><strong>{balanceText(c)}</strong></p>
      {c.note ? <p class="pt-muted">{t("bc.p.fromFinance", { t: c.note })}</p> : null}
      {c.status === "open" ? (c.overdue ? <InlineAlert tone="warn">{t("bc.p.overdue", { d: formatDate(c.dueDate) })}</InlineAlert> : <span class="pt-muted">{t("bc.p.due", { d: formatDate(c.dueDate) })}</span>) : null}
      {c.customerNote ? <p>{t("bc.p.yourNote", { t: c.customerNote })}</p> : null}
      {c.customerAmount ? <p>{t("bc.p.yourAmount", { n: formatMoney(Number(c.customerAmount)) })}</p> : null}
      {c.resolutionNote ? <InlineAlert tone="success">{t("bc.p.answer", { t: c.resolutionNote })}</InlineAlert> : null}
      {c.respondedByName && c.respondedAt ? <span class="pt-muted">{t("bc.p.respondedBy", { name: c.respondedByName, when: formatRelative(c.respondedAt) })}</span> : null}
      <Button variant="ghost" onClick={() => setOpen(!open)}>{open ? t("bc.p.hide") : t("bc.p.show")}</Button>
      {open ? <Lines c={c} /> : null}
      {c.status === "open" ? (
        <div class="pt-row">
          <Button onClick={onAgree}>{t("bc.p.agree")}</Button>
          <Button variant="secondary" onClick={onDispute}>{t("bc.p.dispute")}</Button>
        </div>
      ) : null}
    </Card>
  );
}

function Lines({ c }: { c: Confirmation }) {
  return (
    <div class="pt-stack">
      <span class="pt-muted">{t("bc.p.lines", { from: formatDate(c.periodFrom), to: formatDate(c.asOf) })}</span>
      <span class="pt-muted">{t("bc.p.opening", { n: formatMoney(Number(c.opening)) })}</span>
      {c.lines.length === 0 ? <span class="pt-muted">{t("bc.p.noLines")}</span> : (
        <div class="ht-tablewrap">
          <table class="ht-table">
            <thead><tr><th>{t("bc.p.c.date")}</th><th>{t("bc.p.c.kind")}</th><th>{t("bc.p.c.number")}</th><th>{t("bc.p.c.debit")}</th><th>{t("bc.p.c.credit")}</th><th>{t("bc.p.c.balance")}</th></tr></thead>
            <tbody>
              {c.lines.map((l, i) => (
                <tr key={i}>
                  <td>{formatDate(l.date)}</td><td>{t(`bc.p.k.${l.kind}` as CopyKey)}</td><td dir="ltr">{l.number}</td>
                  <td>{Number(l.debit) ? formatMoney(Number(l.debit)) : ""}</td><td>{Number(l.credit) ? formatMoney(Number(l.credit)) : ""}</td><td>{formatMoney(Number(l.balance))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AgreeDialog({ c, onClose, onDone }: { c: Confirmation; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const go = useMutation(async () => {
    await api.post(`/portal/balances/${c.id}/agree`, {});
    toast({ tone: "success", message: t("bc.p.agreed") });
    onDone();
  });
  return (
    <Dialog open onClose={onClose} title={t("bc.p.agreeTitle")} description={t("bc.p.agreeDesc", { n: balanceText(c), d: formatDate(c.asOf) })}
      footer={<><Button variant="ghost" onClick={onClose}>{t("bc.p.cancel")}</Button><Button loading={go.loading} onClick={() => void go.mutate(undefined)}>{t("bc.p.agreeGo")}</Button></>}>
      {go.error ? <InlineAlert tone="danger">{go.error.message}</InlineAlert> : null}
    </Dialog>
  );
}

function DisputeDialog({ c, onClose, onDone }: { c: Confirmation; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const amountOk = amount.trim() === "" || AMOUNT_RE.test(amount.trim());
  const send = useMutation(async () => {
    await api.post(`/portal/balances/${c.id}/dispute`, { note: note.trim(), amount: amount.trim() || null });
    toast({ tone: "success", message: t("bc.p.disputedOk") });
    onDone();
  });
  return (
    <Dialog open onClose={onClose} title={t("bc.p.disputeTitle")} description={t("bc.p.disputeDesc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("bc.p.cancel")}</Button><Button loading={send.loading} disabled={note.trim().length < 3 || !amountOk} onClick={() => void send.mutate(undefined)}>{t("bc.p.disputeGo")}</Button></>}>
      <div class="pt-stack">
        <Field label={t("bc.p.reason")} required><Textarea value={note} maxLength={500} onInput={(e) => setNote(val(e))} /></Field>
        <Field label={t("bc.p.myAmount")} hint={t("bc.p.myAmountHint")} error={amountOk ? undefined : t("bc.p.myAmountHint")}>
          <Input inputMode="decimal" dir="ltr" value={amount} onInput={(e) => setAmount(val(e))} />
        </Field>
        {send.error ? <InlineAlert tone="danger">{send.error.message}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}
