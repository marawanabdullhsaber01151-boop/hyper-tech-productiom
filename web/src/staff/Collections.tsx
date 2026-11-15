import "../copy/ledger";
import { useMemo, useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Checkbox, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, StatusPill, Textarea, useToast, type Column } from "../design/components";
import { Plus } from "../design/icons";
import { formatDate, formatMoney, formatNumber } from "../lib/format";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const k = (key: string) => key as CopyKey;
const money = (v: string | number) => formatMoney(Number(v));
const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const toCents = (v: string): number => Math.round(Number(v) * 100);

interface PaymentRow { id: number; paymentNumber: string; contactName: string; paymentDate: string; method: string; amount: string; status: string; allocated: string }
interface OpenInvoice { orderId: number; orderNumber: string; date: string; total: string; paid: string; outstanding: string }
interface OpenRes { items: OpenInvoice[]; advanceBalance: string }
interface PaymentDetail { id: number; contactId: number; paymentNumber: string; contactName: string; paymentDate: string; method: string; amount: string; status: string; reference: string | null; notes: string | null; voidReason: string | null; unallocated: string; allocations: Array<{ id: number; orderNumber: string; amount: string }> }
interface ContactOpt { id: number; name: string; type?: string }

/** التحصيلات: تسجيل تحصيل من عميل وتوزيعه على فواتيره (تلقائي الأقدم الأول أو يدوي)، وتوزيع الباقي لاحقًا، والإلغاء بسبب. */
export function Collections() {
  const [status, setStatus] = useState("");
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery((signal) => api.get<{ items: PaymentRow[] }>("/payments", { signal, query: status ? { status } : {} }), [status]);
  const cols: Column<PaymentRow>[] = [
    { key: "n", header: t("lg.c.number"), cell: (r) => <Button size="sm" variant="ghost" onClick={() => setOpen(r.id)}>{r.paymentNumber}</Button>, mobile: "title" },
    { key: "d", header: t("lg.c.date"), cell: (r) => formatDate(r.paymentDate) },
    { key: "c", header: t("lg.c.customer"), cell: (r) => r.contactName },
    { key: "m", header: t("lg.c.method"), cell: (r) => t(k(`lg.c.method.${r.method}`)), mobile: "hide" },
    { key: "a", header: t("lg.c.amount"), cell: (r) => money(r.amount) },
    { key: "u", header: t("lg.c.unallocated"), cell: (r) => money(toCents(r.amount) / 100 - toCents(r.allocated) / 100), mobile: "hide" },
    { key: "s", header: t("lg.c.status"), cell: (r) => <StatusPill tone={r.status === "posted" ? "success" : "warn"}>{t(k(`lg.c.status.${r.status}`))}</StatusPill> },
  ];
  return (
    <div class="ad-stack">
      <p class="eng-muted">{t("lg.c.hint")}</p>
      <div class="eng-toolbar">
        <Field label={t("lg.c.filter")}>
          <Select value={status} onChange={(e) => setStatus(val(e))} options={[{ value: "", label: t("lg.c.all") }, { value: "posted", label: t("lg.c.status.posted") }, { value: "voided", label: t("lg.c.status.voided") }]} />
        </Field>
        <Button icon={Plus} onClick={() => setForm(true)}>{t("lg.c.new")}</Button>
      </div>
      {q.error ? <InlineAlert tone="danger" title={t("lg.err")}>{q.error.message}</InlineAlert> : null}
      <DataTable columns={cols} rows={q.data?.items ?? []} rowKey={(r) => r.id} caption={t("lg.tab.collections")} loading={q.loading} empty={<EmptyState compact title={t("lg.c.empty")} />} />
      {form ? <NewPayment onClose={() => setForm(false)} onDone={() => { setForm(false); void q.refetch(); }} /> : null}
      {open !== null ? <PaymentView id={open} onClose={() => setOpen(null)} onChanged={() => void q.refetch()} /> : null}
    </div>
  );
}

/** جدول توزيع يدوي: لكل فاتورة مفتوحة خانة مبلغ. */
function AllocationInputs({ invoices, values, onChange }: { invoices: OpenInvoice[]; values: Record<number, string>; onChange: (v: Record<number, string>) => void }) {
  return (
    <div class="eng-form">
      {invoices.map((i) => (
        <Field key={i.orderId} label={t("lg.c.invoice", { n: i.orderNumber, left: money(i.outstanding) })}>
          <Input inputMode="decimal" dir="ltr" value={values[i.orderId] ?? ""} onInput={(e) => onChange({ ...values, [i.orderId]: val(e) })} />
        </Field>
      ))}
    </div>
  );
}
const manualLines = (values: Record<number, string>) => Object.entries(values).filter(([, v]) => v.trim() !== "" && toCents(v) > 0).map(([id, v]) => ({ orderId: Number(id), amount: v.trim() }));

function NewPayment({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const toast = useToast();
  const contacts = useQuery((signal) => api.get<ContactOpt[]>("/contacts", { signal }), []);
  const customers = useMemo(() => (contacts.data ?? []).filter((c) => c.type !== "supplier"), [contacts.data]);
  const [contactId, setContactId] = useState("");
  const [date, setDate] = useState(cairoToday());
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [manual, setManual] = useState(false);
  const [values, setValues] = useState<Record<number, string>>({});
  const open = useQuery((signal) => (contactId ? api.get<OpenRes>("/payments/open-invoices", { signal, query: { contactId } }) : Promise.resolve({ items: [], advanceBalance: "0" } as OpenRes)), [contactId]);
  const invoices = open.data?.items ?? [];
  const amountOk = /^\d{1,12}(\.\d{1,2})?$/.test(amount.trim()) && toCents(amount) > 0;
  const manualSum = manualLines(values).reduce((s, l) => s + toCents(l.amount), 0);
  const overAllocated = manual && amountOk && manualSum > toCents(amount);
  const save = async () => {
    const body = { contactId: Number(contactId), paymentDate: date, method, amount: amount.trim(), reference: reference.trim() || null, ...(manual ? { allocations: manualLines(values) } : {}) };
    const r = await act.run(() => api.post<{ paymentNumber: string }>("/payments", body));
    if (r) { toast({ tone: "success", message: t("lg.c.saved", { n: r.paymentNumber }) }); onDone(); }
  };
  return (
    <Dialog open onClose={onClose} title={t("lg.c.newTitle")} description={t("lg.c.newDesc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={!contactId || !amountOk || overAllocated} onClick={() => void save()}>{t("lg.c.save")}</Button></>}>
      <div class="eng-form">
        <Field label={t("lg.c.customer")} required>
          <Select value={contactId} onChange={(e) => { setContactId(val(e)); setValues({}); }} options={[{ value: "", label: t("lg.c.pickCustomer") }, ...customers.map((c) => ({ value: String(c.id), label: c.name }))]} />
        </Field>
        <Field label={t("lg.c.date")} required><Input type="date" max={cairoToday()} value={date} onInput={(e) => setDate(val(e))} /></Field>
        <Field label={t("lg.c.method")} required><Select value={method} onChange={(e) => setMethod(val(e))} options={[{ value: "cash", label: t("lg.c.method.cash") }, { value: "bank", label: t("lg.c.method.bank") }]} /></Field>
        <Field label={t("lg.c.amount")} required><Input inputMode="decimal" dir="ltr" value={amount} onInput={(e) => setAmount(val(e))} /></Field>
        <Field label={t("lg.c.reference")} hint={t("lg.c.referenceHint")}><Input value={reference} maxLength={120} onInput={(e) => setReference(val(e))} /></Field>
        {contactId ? (
          <>
            {Number(open.data?.advanceBalance ?? 0) > 0 ? <InlineAlert tone="info">{t("lg.c.advance", { n: money(open.data!.advanceBalance) })}</InlineAlert> : null}
            <p class="eng-muted">{invoices.length ? t("lg.c.openCount", { n: formatNumber(invoices.length) }) : t("lg.c.noOpen")}</p>
            {invoices.length ? <Checkbox label={t("lg.c.manual")} checked={manual} onChange={(e) => setManual((e.target as HTMLInputElement).checked)} /> : null}
            {manual ? <AllocationInputs invoices={invoices} values={values} onChange={setValues} /> : invoices.length ? <p class="eng-muted">{t("lg.c.autoNote")}</p> : null}
            {overAllocated ? <InlineAlert tone="danger">{t("lg.c.over")}</InlineAlert> : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

function PaymentView({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const act = useAct();
  const q = useQuery((signal) => api.get<PaymentDetail>(`/payments/${id}`, { signal }), [id]);
  const p = q.data;
  const [voiding, setVoiding] = useState<string | null>(null);
  const [allocating, setAllocating] = useState(false);
  const refresh = () => { void q.refetch(); onChanged(); };
  const cols: Column<PaymentDetail["allocations"][number]>[] = [
    { key: "o", header: t("lg.c.order"), cell: (r) => r.orderNumber },
    { key: "a", header: t("lg.c.amount"), cell: (r) => money(r.amount) },
  ];
  const doVoid = async () => {
    const r = await act.run(() => api.post(`/payments/${id}/void`, { reason: (voiding ?? "").trim() }), t("lg.c.voided"));
    if (r) { setVoiding(null); refresh(); }
  };
  return (
    <>
      <Dialog open={voiding === null && !allocating} onClose={onClose} title={t("lg.c.viewTitle", { n: p?.paymentNumber ?? "" })}
        footer={<><Button variant="ghost" onClick={onClose}>{t("lg.d.close")}</Button>
          {p && p.status === "posted" && Number(p.unallocated) > 0 ? <Button variant="secondary" onClick={() => setAllocating(true)}>{t("lg.c.allocateRest")}</Button> : null}
          {p && p.status === "posted" ? <Button variant="secondary" onClick={() => setVoiding("")}>{t("lg.c.void")}</Button> : null}</>}>
        {q.error ? <InlineAlert tone="danger">{q.error.message}</InlineAlert> : null}
        {p ? (
          <div class="eng-form">
            <p>{p.contactName} - {formatDate(p.paymentDate)} - {t(k(`lg.c.method.${p.method}`))} - {money(p.amount)}</p>
            <div class="eng-actions"><StatusPill tone={p.status === "posted" ? "success" : "warn"}>{t(k(`lg.c.status.${p.status}`))}</StatusPill></div>
            {p.reference ? <p class="eng-muted">{t("lg.c.reference")}: {p.reference}</p> : null}
            {p.voidReason ? <InlineAlert tone="warn">{t("lg.c.voidReason", { r: p.voidReason })}</InlineAlert> : null}
            <p>{t("lg.c.unallocatedIs", { n: money(p.unallocated) })}</p>
            <DataTable columns={cols} rows={p.allocations} rowKey={(r) => r.id} caption={t("lg.c.allocations")} empty={<EmptyState compact title={t("lg.c.noAlloc")} />} />
          </div>
        ) : null}
      </Dialog>
      <Dialog open={voiding !== null} onClose={() => setVoiding(null)} title={t("lg.c.voidTitle", { n: p?.paymentNumber ?? "" })} description={t("lg.c.voidDesc")}
        footer={<><Button variant="ghost" onClick={() => setVoiding(null)}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={(voiding ?? "").trim().length < 3} onClick={() => void doVoid()}>{t("lg.c.voidGo")}</Button></>}>
        <Field label={t("lg.d.reason")} required><Textarea value={voiding ?? ""} maxLength={300} onInput={(e) => setVoiding(val(e))} /></Field>
      </Dialog>
      {allocating && p ? <AllocateRest payment={p} onClose={() => setAllocating(false)} onDone={() => { setAllocating(false); refresh(); }} /> : null}
    </>
  );
}

function AllocateRest({ payment, onClose, onDone }: { payment: PaymentDetail; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const cid = payment.contactId;
  const open = useQuery((signal) => (cid ? api.get<OpenRes>("/payments/open-invoices", { signal, query: { contactId: cid } }) : Promise.resolve({ items: [], advanceBalance: "0" } as OpenRes)), [cid]);
  const [values, setValues] = useState<Record<number, string>>({});
  const lines = manualLines(values);
  const sum = lines.reduce((s, l) => s + toCents(l.amount), 0);
  const over = sum > toCents(payment.unallocated);
  const go = async () => {
    const r = await act.run(() => api.post(`/payments/${payment.id}/allocate`, { allocations: lines }), t("lg.c.allocated"));
    if (r) onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("lg.c.allocateTitle", { n: money(payment.unallocated) })}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={lines.length === 0 || over} onClick={() => void go()}>{t("lg.c.allocateGo")}</Button></>}>
      {open.data && open.data.items.length === 0 ? <p class="eng-muted">{t("lg.c.noOpen")}</p> : <AllocationInputs invoices={open.data?.items ?? []} values={values} onChange={setValues} />}
      {over ? <InlineAlert tone="danger">{t("lg.c.over")}</InlineAlert> : null}
    </Dialog>
  );
}
