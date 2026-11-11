import "../copy/quotes";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, Textarea, type Column } from "../design/components";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "../lib/format";
import { SALES_PAGE_ROLES } from "./staffRoles";
import { PriceAgreements } from "./PriceAgreements";
import {
  QUOTE_FILTERS, daysLeft, emptyForm, formEstimate, formFromQuote, formIssues, statusTone, summarize, toPayload,
  type Quote, type QuoteForm, type QuoteList, type QuoteLookups, type QuoteShown,
} from "./quotesCore";
import "./Engineering.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const k = (key: string) => key as CopyKey;
const money = (v: string | number) => formatMoney(Number(v));
const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

/** عروض الأسعار: إنشاء وإرسال ومتابعة رد العميل. الطلب من العرض بيتم من بوابة العميل بنفس السعر. */
export function Quotes() {
  const role = staffUser()?.role ?? "";
  const allowed = (SALES_PAGE_ROLES as readonly string[]).includes(role);
  const [tab, setTab] = useState<"quotes" | "agreements">("quotes");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const q = useQuery((signal) => (allowed ? api.get<QuoteList>(`/price-quotes?q=${encodeURIComponent(search)}`, { signal }) : Promise.resolve({ items: [], counts: {} } as QuoteList)), [allowed, search]);
  const [form, setForm] = useState<{ edit: Quote | null } | null>(null);
  const [view, setView] = useState<Quote | null>(null);
  if (!allowed) return <div class="ad-page"><InlineAlert tone="warn">{t("qt.noAccess")}</InlineAlert></div>;
  const all = q.data?.items ?? [];
  const counts = q.data?.counts ?? {};
  const shown = status ? all.filter((x) => x.status === status) : all;
  const today = cairoToday();
  const sum = summarize(all);
  const cols: Column<Quote>[] = [
    { key: "no", header: t("qt.col.number"), cell: (r) => <Button size="sm" variant="ghost" onClick={() => setView(r)}>{r.quoteNumber}</Button>, mobile: "title" },
    { key: "cu", header: t("qt.col.customer"), cell: (r) => r.customerName },
    { key: "ln", header: t("qt.col.lines"), cell: (r) => formatNumber(r.lines.length), numeric: true, mobile: "hide" },
    { key: "vu", header: t("qt.col.valid"), cell: (r) => <ValidCell quote={r} today={today} />, mobile: "hide" },
    { key: "to", header: t("qt.col.total"), cell: (r) => money(r.total), numeric: true },
    { key: "st", header: t("qt.col.status"), cell: (r) => <StatusPill tone={statusTone(r.status)}>{t(k(`qt.status.${r.status}`))}</StatusPill> },
  ];
  const refresh = () => void q.refetch();
  return (
    <div class="ad-page">
      <div>
        <h1 class="ad-title">{t("qt.title")}</h1>
        <p class="st-login__sub">{t("qt.subtitle")}</p>
      </div>
      <div class="eng-toolbar" role="group" aria-label={t("qt.tabs")}>
        <Button variant={tab === "quotes" ? "primary" : "secondary"} aria-pressed={tab === "quotes"} onClick={() => setTab("quotes")}>{t("qt.tab.quotes")}</Button>
        <Button variant={tab === "agreements" ? "primary" : "secondary"} aria-pressed={tab === "agreements"} onClick={() => setTab("agreements")}>{t("qt.tab.agreements")}</Button>
      </div>
      {tab === "agreements" ? <PriceAgreements /> : null}
      {tab === "quotes" ? <>
      <div class="eng-stats">
        {(["draft", "sent", "ordered", "expired"] as QuoteShown[]).map((s) => <Stat key={s} label={t(k(`qt.status.${s}`))} value={formatNumber(counts[s] ?? 0)} />)}
        <Stat label={t("qt.sum.conversion")} value={sum.conversionPct === null ? t("qt.sum.conversionNone") : `${formatNumber(sum.conversionPct)}%`} />
        <Stat label={t("qt.sum.orderedValue")} value={money(sum.orderedValue)} />
        <Stat label={t("qt.sum.openValue")} value={money(sum.openValue)} />
      </div>
      <p class="eng-muted">{t("qt.sum.hint")}</p>
      <div class="eng-toolbar">
        <Input aria-label={t("qt.search")} placeholder={t("qt.search")} value={search} onInput={(e) => setSearch(val(e))} />
        <Select aria-label={t("qt.col.status")} value={status} onChange={(e) => setStatus(val(e))} options={[{ value: "", label: t("qt.filter.all") }, ...QUOTE_FILTERS.map((s) => ({ value: s, label: t(k(`qt.status.${s}`)) }))]} />
        <Button onClick={() => setForm({ edit: null })}>{t("qt.new")}</Button>
      </div>
      {q.error ? <InlineAlert tone="danger" title={t("qt.err")} action={<Button size="sm" variant="secondary" onClick={refresh}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert> : null}
      <DataTable columns={cols} rows={shown} rowKey={(r) => r.id} caption={t("qt.caption")} loading={q.loading} empty={<EmptyState title={t("qt.empty")} compact />} />
      </> : null}
      {form ? <QuoteDialog edit={form.edit} onClose={() => setForm(null)} onDone={() => { setForm(null); refresh(); }} /> : null}
      {view ? <DetailDialog quote={view} onClose={() => setView(null)} onEdit={() => { setForm({ edit: view }); setView(null); }} onDone={() => { setView(null); refresh(); }} /> : null}
    </div>
  );
}

function ValidCell({ quote, today }: { quote: Quote; today: string }) {
  const left = daysLeft(quote.validUntil, today);
  return (
    <span>
      {formatDate(quote.validUntil)}
      {quote.status === "sent" ? <span class="eng-muted"> · {left <= 0 ? t("qt.expiresToday") : t("qt.daysLeft", { n: formatNumber(left) })}</span> : null}
    </span>
  );
}

function QuoteDialog({ edit, onClose, onDone }: { edit: Quote | null; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [custSearch, setCustSearch] = useState("");
  const look = useQuery((signal) => api.get<QuoteLookups>(`/price-quotes/lookups?q=${encodeURIComponent(custSearch)}`, { signal }), [custSearch]);
  const [form, setForm] = useState<QuoteForm | null>(() => (edit ? formFromQuote(edit) : null));
  const [tried, setTried] = useState(false);
  const data = look.data;
  const f: QuoteForm | null = form ?? (data ? emptyForm(data.defaultValidUntil) : null);
  const set = (patch: Partial<QuoteForm>) => f && setForm({ ...f, ...patch });
  const setLine = (key: number, patch: Partial<QuoteForm["lines"][number]>) => f && set({ lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const issues = f ? formIssues(f) : [];
  const save = async (send: boolean) => {
    setTried(true);
    if (!f || issues.length > 0) return;
    const saved = await act.run(() => (edit ? api.put<Quote>(`/price-quotes/${edit.id}`, toPayload(f)) : api.post<Quote>("/price-quotes", toPayload(f))), send ? undefined : t("qt.form.saved"));
    if (!saved) return;
    if (send) {
      const sent = await act.run(() => api.post<Quote>(`/price-quotes/${saved.id}/send`, {}), t("qt.form.sent"));
      if (!sent) return;
    }
    onDone();
  };
  const customerOptions = (() => {
    const list = data?.companies ?? [];
    const cur = edit && !list.some((c) => c.id === edit.portalCustomerId) ? [{ value: String(edit.portalCustomerId), label: edit.customerName }] : [];
    return [{ value: "", label: t("qt.form.pick") }, ...cur, ...list.map((c) => ({ value: String(c.id), label: c.name }))];
  })();
  const recipeOptions = [{ value: "", label: t("qt.form.pick") }, ...(data?.recipes ?? []).map((r) => ({ value: String(r.id), label: r.name }))];
  return (
    <Dialog open onClose={onClose} title={edit ? t("qt.form.titleEdit", { n: edit.quoteNumber }) : t("qt.form.titleNew")} description={t("qt.form.desc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button variant="secondary" loading={act.busy} disabled={!f} onClick={() => void save(false)}>{t("qt.form.saveDraft")}</Button><Button loading={act.busy} disabled={!f} onClick={() => void save(true)}>{t("qt.form.saveSend")}</Button></>}>
      {look.error ? <InlineAlert tone="danger">{look.error.message}</InlineAlert> : null}
      {f ? (
        <div class="eng-form">
          <Field label={t("qt.form.customerSearch")}><Input value={custSearch} onInput={(e) => setCustSearch(val(e))} /></Field>
          <Field label={t("qt.form.customer")} required>
            <Select value={f.customerId} onChange={(e) => set({ customerId: val(e) })} options={customerOptions} />
          </Field>
          <Field label={t("qt.form.valid")} hint={t("qt.form.validHint")} required>
            <Input type="date" value={f.validUntil} onInput={(e) => set({ validUntil: val(e) })} />
          </Field>
          <h3 class="eng-h">{t("qt.form.lines")}</h3>
          {f.lines.map((l) => (
            <div key={l.key} class="eng-form">
              <Field label={t("qt.form.product")}>
                <Select value={l.bomRecipeId} options={recipeOptions} onChange={(e) => {
                  const id = val(e);
                  const ref = data?.recipes.find((r) => String(r.id) === id)?.referencePrice;
                  setLine(l.key, { bomRecipeId: id, ...(l.unitPrice === "" && ref ? { unitPrice: String(Number(ref)) } : {}) });
                }} />
              </Field>
              <div class="eng-actions">
                <Field label={t("qt.form.qty")}><Input inputMode="decimal" value={l.qty} onInput={(e) => setLine(l.key, { qty: val(e) })} /></Field>
                <Field label={t("qt.form.price")}><Input inputMode="decimal" value={l.unitPrice} onInput={(e) => setLine(l.key, { unitPrice: val(e) })} /></Field>
                {f.lines.length > 1 ? <Button size="sm" variant="ghost" onClick={() => set({ lines: f.lines.filter((x) => x.key !== l.key) })}>{t("qt.form.removeLine")}</Button> : null}
              </div>
            </div>
          ))}
          <div class="eng-actions">
            <Button size="sm" variant="secondary" onClick={() => set({ lines: [...f.lines, { key: Math.max(0, ...f.lines.map((x) => x.key)) + 1, bomRecipeId: "", qty: "", unitPrice: "" }] })}>{t("qt.form.addLine")}</Button>
            <span class="eng-ok">{t("qt.form.estimate", { total: money(formEstimate(f)) })}</span>
          </div>
          <Field label={t("qt.form.notes")}><Textarea value={f.notes} maxLength={1000} onInput={(e) => set({ notes: val(e) })} /></Field>
          {tried && issues.length > 0 ? (
            <ul class="eng-issues">{issues.map((i) => <li key={i} class="is-error">{t(k(`qt.issue.${i}`))}</li>)}</ul>
          ) : null}
        </div>
      ) : <p class="eng-muted">{t("common.loading")}</p>}
    </Dialog>
  );
}

function DetailDialog({ quote, onClose, onEdit, onDone }: { quote: Quote; onClose: () => void; onEdit: () => void; onDone: () => void }) {
  const act = useAct();
  const [cancel, setCancel] = useState<string | null>(null);
  const send = async () => {
    const r = await act.run(() => api.post<Quote>(`/price-quotes/${quote.id}/send`, {}), t("qt.form.sent"));
    if (r) onDone();
  };
  const doCancel = async () => {
    const r = await act.run(() => api.post<Quote>(`/price-quotes/${quote.id}/cancel`, { reason: (cancel ?? "").trim() }), t("qt.cancel.done"));
    if (r) onDone();
  };
  const cols: Column<Quote["lines"][number]>[] = [
    { key: "p", header: t("qt.d.col.product"), cell: (l) => l.productName, mobile: "title" },
    { key: "q", header: t("qt.d.col.qty"), cell: (l) => formatNumber(Number(l.qty)), numeric: true },
    { key: "u", header: t("qt.d.col.price"), cell: (l) => money(l.unitPrice), numeric: true },
    { key: "t", header: t("qt.d.col.total"), cell: (l) => money(Math.round(Number(l.qty) * Number(l.unitPrice) * 100) / 100), numeric: true },
  ];
  return (
    <>
      <Dialog open={cancel === null} onClose={onClose} title={t("qt.d.title", { n: quote.quoteNumber })}
        footer={<>
          <Button variant="ghost" onClick={onClose}>{t("qt.d.close")}</Button>
          {quote.canCancel ? <Button variant="secondary" onClick={() => setCancel("")}>{t("qt.d.cancel")}</Button> : null}
          {quote.canEdit ? <Button variant="secondary" onClick={onEdit}>{t("qt.d.edit")}</Button> : null}
          {quote.canSend ? <Button loading={act.busy} onClick={() => void send()}>{t("qt.d.send")}</Button> : null}
        </>}>
        <div class="eng-form">
          <div class="eng-actions"><StatusPill tone={statusTone(quote.status)}>{t(k(`qt.status.${quote.status}`))}</StatusPill></div>
          <p>{t("qt.d.customer", { name: quote.customerName })}</p>
          <p>{t("qt.d.valid", { date: formatDate(quote.validUntil) })}</p>
          {quote.createdByName ? <p class="eng-muted">{t("qt.d.createdBy", { name: quote.createdByName })}</p> : null}
          {quote.sentAt ? <p class="eng-muted">{t("qt.d.sentAt", { at: formatDateTime(quote.sentAt) })}</p> : null}
          {quote.notes ? <p>{t("qt.d.notes", { notes: quote.notes })}</p> : null}
          <DataTable columns={cols} rows={quote.lines} rowKey={(l) => l.bomRecipeId} caption={t("qt.caption")} />
          <p><strong>{t("qt.d.total", { total: money(quote.total) })}</strong></p>
          {quote.status === "declined" ? <InlineAlert tone="warn">{quote.declineReason ? t("qt.d.declined", { name: quote.decidedByName ?? "", reason: quote.declineReason }) : t("qt.d.declinedNoReason", { name: quote.decidedByName ?? "" })}</InlineAlert> : null}
          {quote.status === "ordered" ? <InlineAlert tone="success">{t("qt.d.ordered", { name: quote.decidedByName ?? "", ref: quote.batchRef ?? "" })}</InlineAlert> : null}
          {quote.status === "cancelled" && quote.cancelReason ? <InlineAlert tone="info">{t("qt.d.cancelled", { reason: quote.cancelReason })}</InlineAlert> : null}
        </div>
      </Dialog>
      <Dialog open={cancel !== null} onClose={() => setCancel(null)} title={t("qt.cancel.title", { n: quote.quoteNumber })} description={t("qt.cancel.body")}
        footer={<><Button variant="ghost" onClick={() => setCancel(null)}>{t("qt.cancel.back")}</Button><Button loading={act.busy} disabled={(cancel ?? "").trim().length < 3} onClick={() => void doCancel()}>{t("qt.cancel.go")}</Button></>}>
        <Field label={t("qt.cancel.reason")} required><Textarea value={cancel ?? ""} maxLength={300} onInput={(e) => setCancel(val(e))} /></Field>
      </Dialog>
    </>
  );
}
