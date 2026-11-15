import "../copy/ledger";
import { useState } from "preact/hooks";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, EmptyState, Field, InlineAlert, Input, type Column } from "../design/components";
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
    </div>
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
