import "../copy/quotes";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, Textarea, type Column } from "../design/components";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import { AGREEMENT_FILTERS, agreementIssues, agreementPayload, agreementTone, emptyAgreement, type Agreement, type AgreementForm, type AgreementList } from "./agreementsCore";
import type { QuoteLookups } from "./quotesCore";
import "./Engineering.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const k = (key: string) => key as CopyKey;
const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const plusYear = (iso: string) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;

/** اتفاقيات الأسعار: سعر ثابت لعميل ومنتج لفترة، بيتطبق تلقائيًا على طلباته. */
export function PriceAgreements() {
  const [status, setStatus] = useState("");
  const q = useQuery((signal) => api.get<AgreementList>("/price-agreements", { signal }), []);
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState<Agreement | null>(null);
  const all = q.data?.items ?? [];
  const counts = q.data?.counts ?? {};
  const shown = status ? all.filter((a) => a.status === status) : all;
  const cols: Column<Agreement>[] = [
    { key: "c", header: t("ag.col.customer"), cell: (a) => a.customerName, mobile: "title" },
    { key: "p", header: t("ag.col.product"), cell: (a) => a.productName },
    { key: "u", header: t("ag.col.price"), cell: (a) => formatMoney(Number(a.unitPrice)), numeric: true },
    { key: "d", header: t("ag.col.period"), cell: (a) => t("ag.period", { from: formatDate(a.validFrom), until: formatDate(a.validUntil) }), mobile: "hide" },
    { key: "s", header: t("ag.col.status"), cell: (a) => <StatusPill tone={agreementTone(a.status)}>{t(k(`ag.status.${a.status}`))}</StatusPill> },
    { key: "x", header: t("ag.col.action"), cell: (a) => (a.status === "ended" ? <span class="eng-muted">{a.endReason ? t("ag.ended.reason", { reason: a.endReason }) : ""}</span> : <Button size="sm" variant="ghost" onClick={() => setEnding(a)}>{t("ag.end")}</Button>) },
  ];
  return (
    <div class="eng-form">
      <p class="st-login__sub">{t("ag.subtitle")}</p>
      <div class="eng-stats">
        {AGREEMENT_FILTERS.map((s) => <Stat key={s} label={t(k(`ag.status.${s}`))} value={formatNumber(counts[s] ?? 0)} />)}
      </div>
      <div class="eng-toolbar">
        <Select aria-label={t("ag.col.status")} value={status} onChange={(e) => setStatus(val(e))} options={[{ value: "", label: t("qt.filter.all") }, ...AGREEMENT_FILTERS.map((s) => ({ value: s, label: t(k(`ag.status.${s}`)) }))]} />
        <Button onClick={() => setCreating(true)}>{t("ag.new")}</Button>
      </div>
      {q.error ? <InlineAlert tone="danger" title={t("ag.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert> : null}
      <DataTable columns={cols} rows={shown} rowKey={(a) => a.id} caption={t("ag.caption")} loading={q.loading} empty={<EmptyState title={t("ag.empty")} compact />} />
      {creating ? <CreateDialog onClose={() => setCreating(false)} onDone={() => { setCreating(false); void q.refetch(); }} /> : null}
      {ending ? <EndDialog agreement={ending} onClose={() => setEnding(null)} onDone={() => { setEnding(null); void q.refetch(); }} /> : null}
    </div>
  );
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [search, setSearch] = useState("");
  const look = useQuery((signal) => api.get<QuoteLookups>(`/price-quotes/lookups?q=${encodeURIComponent(search)}`, { signal }), [search]);
  const today = cairoToday();
  const [form, setForm] = useState<AgreementForm>(() => emptyAgreement(today, plusYear(today)));
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<AgreementForm>) => setForm((f) => ({ ...f, ...patch }));
  const issues = agreementIssues(form);
  const save = async () => {
    setTried(true);
    if (issues.length > 0) return;
    const r = await act.run(() => api.post<Agreement>("/price-agreements", agreementPayload(form)), t("ag.form.saved"));
    if (r) onDone();
  };
  const data = look.data;
  return (
    <Dialog open onClose={onClose} title={t("ag.form.title")} description={t("ag.form.desc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} onClick={() => void save()}>{t("ag.form.save")}</Button></>}>
      {look.error ? <InlineAlert tone="danger">{look.error.message}</InlineAlert> : null}
      <div class="eng-form">
        <Field label={t("ag.form.customerSearch")}><Input value={search} onInput={(e) => setSearch(val(e))} /></Field>
        <Field label={t("ag.form.customer")} required>
          <Select value={form.customerId} onChange={(e) => set({ customerId: val(e) })} options={[{ value: "", label: t("qt.form.pick") }, ...(data?.companies ?? []).map((c) => ({ value: String(c.id), label: c.name }))]} />
        </Field>
        <Field label={t("ag.form.product")} required>
          <Select value={form.recipeId} onChange={(e) => {
            const id = val(e);
            const ref = data?.recipes.find((r) => String(r.id) === id)?.referencePrice;
            set({ recipeId: id, ...(form.unitPrice === "" && ref ? { unitPrice: String(Number(ref)) } : {}) });
          }} options={[{ value: "", label: t("qt.form.pick") }, ...(data?.recipes ?? []).map((r) => ({ value: String(r.id), label: r.name }))]} />
        </Field>
        <Field label={t("ag.form.price")} required><Input inputMode="decimal" value={form.unitPrice} onInput={(e) => set({ unitPrice: val(e) })} /></Field>
        <div class="eng-actions">
          <Field label={t("ag.form.from")} required><Input type="date" value={form.validFrom} onInput={(e) => set({ validFrom: val(e) })} /></Field>
          <Field label={t("ag.form.until")} required><Input type="date" value={form.validUntil} onInput={(e) => set({ validUntil: val(e) })} /></Field>
        </div>
        <Field label={t("ag.form.note")}><Textarea value={form.note} maxLength={500} onInput={(e) => set({ note: val(e) })} /></Field>
        {tried && issues.length > 0 ? <ul class="eng-issues">{issues.map((i) => <li key={i} class="is-error">{t(k(`ag.issue.${i}`))}</li>)}</ul> : null}
      </div>
    </Dialog>
  );
}

function EndDialog({ agreement, onClose, onDone }: { agreement: Agreement; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [reason, setReason] = useState("");
  const go = async () => {
    const r = await act.run(() => api.post<Agreement>(`/price-agreements/${agreement.id}/end`, { reason: reason.trim() }), t("ag.end.done"));
    if (r) onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("ag.end.title", { p: agreement.productName })} description={t("ag.end.body")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("ag.end.back")}</Button><Button loading={act.busy} disabled={reason.trim().length < 3} onClick={() => void go()}>{t("ag.end.go")}</Button></>}>
      <Field label={t("ag.end.reason")} required><Textarea value={reason} maxLength={300} onInput={(e) => setReason(val(e))} /></Field>
    </Dialog>
  );
}
