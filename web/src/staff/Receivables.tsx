import "../copy/ledger";
import { useMemo, useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, StatusPill, Textarea, useToast, type Column } from "../design/components";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import "./Receivables.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const k = (key: string) => key as CopyKey;
const money = (v: string | number) => formatMoney(Number(v));
const BUCKETS = ["b0", "b30", "b60", "b90"] as const;

interface AgingRow { contactId: number; contactName: string; invoices: number; oldestDays: number; total: string; advance: string; buckets: Record<(typeof BUCKETS)[number], string> }
interface AgingRes { asOf: string; rows: AgingRow[]; totals: Record<(typeof BUCKETS)[number], string> & { total: string; advance: string } }
interface StatementLine { kind: "invoice" | "payment"; id: number; date: string; number: string; note: string | null; debit: string; credit: string; balance: string }
interface StatementRes { contact: { id: number; name: string; phone: string | null }; from: string | null; to: string | null; generatedOn: string; opening: string; closing: string; debit: string; credit: string; lines: StatementLine[] }

/** أرصدة العملاء وأعمار الديون (0-30 / 31-60 / 61-90 / +90 يوم من تاريخ الفاتورة)، ومنها كشف حساب كل عميل للطباعة أو PDF. */
export function Receivables() {
  const [asOf, setAsOf] = useState("");
  const [pick, setPick] = useState<{ id: number; name: string } | null>(null);
  const q = useQuery((signal) => api.get<AgingRes>("/receivables/aging", { signal, query: asOf ? { asOf } : {} }), [asOf]);
  if (pick) return <Statement contactId={pick.id} onBack={() => setPick(null)} />;
  const cols: Column<AgingRow>[] = [
    { key: "c", header: t("lg.c.customer"), cell: (r) => <Button size="sm" variant="ghost" onClick={() => setPick({ id: r.contactId, name: r.contactName })}>{r.contactName}</Button>, mobile: "title" },
    ...BUCKETS.map((b): Column<AgingRow> => ({ key: b, header: t(k(`lg.r.${b}`)), cell: (r) => money(r.buckets[b]), mobile: "hide" })),
    { key: "t", header: t("lg.r.total"), cell: (r) => money(r.total) },
    { key: "o", header: t("lg.r.oldest"), cell: (r) => t("lg.r.days", { n: formatNumber(r.oldestDays) }), mobile: "hide" },
    { key: "a", header: t("lg.r.advance"), cell: (r) => (Number(r.advance) > 0 ? money(r.advance) : "-"), mobile: "hide" },
  ];
  return (
    <div class="ad-stack">
      <p class="eng-muted">{t("lg.r.hint")}</p>
      <div class="eng-toolbar">
        <Field label={t("lg.r.asOf")}><Input type="date" value={asOf || q.data?.asOf || ""} onInput={(e) => setAsOf(val(e))} /></Field>
      </div>
      {q.error ? <InlineAlert tone="danger" title={t("lg.err")}>{q.error.message}</InlineAlert> : null}
      {q.data ? (
        <p class="rc-totals">
          {BUCKETS.map((b) => <span key={b}>{t(k(`lg.r.${b}`))}: <strong>{money(q.data!.totals[b])}</strong></span>)}
          <span>{t("lg.r.total")}: <strong>{money(q.data.totals.total)}</strong></span>
          {Number(q.data.totals.advance) > 0 ? <span>{t("lg.r.advance")}: <strong>{money(q.data.totals.advance)}</strong></span> : null}
        </p>
      ) : null}
      <DataTable columns={cols} rows={q.data?.rows ?? []} rowKey={(r) => r.contactId} caption={t("lg.tab.receivables")} loading={q.loading} empty={<EmptyState compact title={t("lg.r.empty")} />} />
      <CreditLimits />
    </div>
  );
}

interface CreditRow { contactId: number; contactName: string; limit: string | null; debt: string; available: string | null; over: boolean; overBy: string }
interface CreditRes { policy: "off" | "warn" | "block"; rows: CreditRow[] }
interface ContactOpt { id: number; name: string; type?: string }

/** حدود الائتمان: كل عميل عليه حد أو مديونية، والمتجاوز بيظهر الأول بعلامة. تحديد الحد أو مسحه بسبب مسجّل. */
function CreditLimits() {
  const [form, setForm] = useState<{ contactId: string; limit: string } | null>(null);
  const q = useQuery((signal) => api.get<CreditRes>("/credit/overview", { signal }), []);
  const cols: Column<CreditRow>[] = [
    { key: "c", header: t("lg.c.customer"), cell: (r) => <Button size="sm" variant="ghost" onClick={() => setForm({ contactId: String(r.contactId), limit: r.limit ? String(Number(r.limit)) : "" })}>{r.contactName}</Button>, mobile: "title" },
    { key: "l", header: t("lg.r.cr.limit"), cell: (r) => (r.limit ? money(r.limit) : t("lg.r.cr.none")) },
    { key: "d", header: t("lg.r.cr.debt"), cell: (r) => money(r.debt) },
    { key: "a", header: t("lg.r.cr.available"), cell: (r) => (r.available === null ? "-" : money(r.available)), mobile: "hide" },
    { key: "s", header: t("lg.c.status"), cell: (r) => (r.over ? <StatusPill tone="danger">{t("lg.r.cr.over", { n: money(r.overBy) })}</StatusPill> : r.limit ? <StatusPill tone="success">{t("lg.r.cr.within")}</StatusPill> : <span class="eng-muted">-</span>) },
  ];
  return (
    <section class="ad-stack" aria-labelledby="rc-cr">
      <h2 id="rc-cr" class="rc-h">{t("lg.r.cr.title")}</h2>
      <p class="eng-muted">{t("lg.r.cr.hint")}</p>
      {q.data ? <InlineAlert tone={q.data.policy === "block" ? "warn" : "info"}>{t(k(`lg.r.cr.policy.${q.data.policy}`))}</InlineAlert> : null}
      {q.error ? <InlineAlert tone="danger" title={t("lg.err")}>{q.error.message}</InlineAlert> : null}
      <div class="eng-toolbar"><Button onClick={() => setForm({ contactId: "", limit: "" })}>{t("lg.r.cr.set")}</Button></div>
      <DataTable columns={cols} rows={q.data?.rows ?? []} rowKey={(r) => r.contactId} caption={t("lg.r.cr.title")} loading={q.loading} empty={<EmptyState compact title={t("lg.r.cr.empty")} />} />
      {form ? <LimitDialog initial={form} onClose={() => setForm(null)} onDone={() => { setForm(null); void q.refetch(); }} /> : null}
    </section>
  );
}

function LimitDialog({ initial, onClose, onDone }: { initial: { contactId: string; limit: string }; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const toast = useToast();
  const contacts = useQuery((signal) => api.get<ContactOpt[]>("/contacts", { signal }), []);
  const customers = useMemo(() => (contacts.data ?? []).filter((c) => c.type !== "supplier"), [contacts.data]);
  const [contactId, setContactId] = useState(initial.contactId);
  const [limit, setLimit] = useState(initial.limit);
  const [reason, setReason] = useState("");
  const limitOk = limit.trim() === "" || (/^\d{1,12}(\.\d{1,2})?$/.test(limit.trim()) && Number(limit) > 0);
  const save = async () => {
    const r = await act.run(() => api.put("/credit/limit", { contactId: Number(contactId), limit: limit.trim() === "" ? null : limit.trim(), reason: reason.trim() }), t("lg.r.cr.saved"));
    if (r) { toast({ tone: "success", message: t("lg.r.cr.saved") }); onDone(); }
  };
  return (
    <Dialog open onClose={onClose} title={t("lg.r.cr.dlgTitle")} description={t("lg.r.cr.dlgDesc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={!contactId || !limitOk || reason.trim().length < 3} onClick={() => void save()}>{t("lg.c.save")}</Button></>}>
      <div class="eng-form">
        <Field label={t("lg.c.customer")} required>
          <Select value={contactId} onChange={(e) => setContactId(val(e))} options={[{ value: "", label: t("lg.c.pickCustomer") }, ...customers.map((c) => ({ value: String(c.id), label: c.name }))]} />
        </Field>
        <Field label={t("lg.r.cr.limit")} hint={t("lg.r.cr.limitHint")}><Input inputMode="decimal" dir="ltr" value={limit} onInput={(e) => setLimit(val(e))} /></Field>
        {!limitOk ? <InlineAlert tone="danger">{t("lg.r.cr.badLimit")}</InlineAlert> : null}
        <Field label={t("lg.r.cr.reason")} required><Textarea value={reason} maxLength={300} onInput={(e) => setReason(val(e))} /></Field>
      </div>
    </Dialog>
  );
}

function Statement({ contactId, onBack }: { contactId: number; onBack: () => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const bad = Boolean(from && to && from > to);
  const q = useQuery((signal) => (bad ? Promise.resolve(null) : api.get<StatementRes>("/receivables/statement", { signal, query: { contactId, ...(from ? { from } : {}), ...(to ? { to } : {}) } })), [contactId, from, to]);
  const s = q.data;
  const closing = Number(s?.closing ?? 0);
  return (
    <div class="ad-stack">
      <div class="rc-noprint eng-toolbar">
        <Button variant="ghost" onClick={onBack}>{t("lg.r.back")}</Button>
        <Field label={t("lg.r.from")}><Input type="date" value={from} onInput={(e) => setFrom(val(e))} /></Field>
        <Field label={t("lg.r.to")}><Input type="date" value={to} onInput={(e) => setTo(val(e))} /></Field>
        <Button disabled={!s} onClick={() => window.print()}>{t("lg.r.print")}</Button>
      </div>
      <p class="rc-noprint eng-muted">{t("lg.r.printHint")}</p>
      {bad ? <InlineAlert tone="danger">{t("lg.r.badRange")}</InlineAlert> : null}
      {q.error ? <InlineAlert tone="danger" title={t("lg.err")}>{q.error.message}</InlineAlert> : null}
      {s ? (
        <section class="rc-print" aria-labelledby="rc-h">
          <h2 id="rc-h" class="rc-h">{t("lg.r.title", { name: s.contact.name })}</h2>
          <p class="eng-muted">
            {s.from || s.to ? t("lg.r.period", { from: s.from ? formatDate(s.from) : "-", to: s.to ? formatDate(s.to) : "-" }) : t("lg.r.allTime")} · {t("lg.r.generated", { d: formatDate(s.generatedOn) })}
          </p>
          <div class="rc-scroll">
            <table class="rc-table">
              <caption class="rc-cap">{t("lg.r.caption")}</caption>
              <thead><tr>
                <th scope="col">{t("lg.c.date")}</th><th scope="col">{t("lg.r.doc")}</th><th scope="col">{t("lg.r.note")}</th>
                <th scope="col" class="rc-num">{t("lg.r.debit")}</th><th scope="col" class="rc-num">{t("lg.r.credit")}</th><th scope="col" class="rc-num">{t("lg.r.balance")}</th>
              </tr></thead>
              <tbody>
                <tr><td colSpan={5}>{t("lg.r.opening")}</td><td class="rc-num">{money(s.opening)}</td></tr>
                {s.lines.map((l) => (
                  <tr key={`${l.kind}-${l.id}`}>
                    <td>{formatDate(l.date)}</td>
                    <td>{t(k(`lg.r.kind.${l.kind}`))} {l.number}</td>
                    <td>{l.note && l.kind === "payment" ? (l.note === "cash" || l.note === "bank" ? t(k(`lg.c.method.${l.note}`)) : l.note) : ""}</td>
                    <td class="rc-num">{Number(l.debit) ? money(l.debit) : ""}</td>
                    <td class="rc-num">{Number(l.credit) ? money(l.credit) : ""}</td>
                    <td class="rc-num">{money(l.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3}>{t("lg.r.sums")}</td><td class="rc-num">{money(s.debit)}</td><td class="rc-num">{money(s.credit)}</td><td class="rc-num">{money(s.closing)}</td></tr>
              </tfoot>
            </table>
          </div>
          <p class="rc-closing">{closing > 0 ? t("lg.r.closingOwed", { n: money(closing) }) : closing < 0 ? t("lg.r.closingCredit", { n: money(-closing) }) : t("lg.r.closingZero")}</p>
        </section>
      ) : null}
    </div>
  );
}
