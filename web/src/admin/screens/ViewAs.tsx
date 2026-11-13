import "../../copy/viewas";
import { useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, StatusPill, Tabs, Textarea, type Column } from "../../design/components";
import { formatDate, formatDateTime, formatNumber } from "../../lib/format";
import { api } from "../api";
import { useAct } from "../act";

interface OrderItem { id: number; orderNumber: string; productName: string; qty: string | number; unit?: string | null; referenceUnitPrice: string | null }
interface Batch { batchRef: string; createdAt: string; overallStatus: string; items: OrderItem[] }
interface Quote { id: number; quoteNumber: string; status: string; validUntil: string; total: string; lines: Array<{ bomRecipeId: number; productName: string; qty: number | string; unitPrice: string }> }
interface Agreement { id: number; productName: string; unitPrice: string; validFrom: string; validUntil: string }
interface Member { id: number; fullName: string; roleName: string; isOwner: boolean }
interface Notice { id: number; title: string; body: string; createdAt: string }
export interface ViewAsData {
  profile: { companyName: string; fullName: string; phone: string | null; email: string | null; address: string | null; city: string | null };
  orders: Batch[];
  quotes: Quote[];
  agreements: Agreement[];
  team: Member[];
  notices: Notice[];
}
const val = (e: Event) => (e.target as HTMLTextAreaElement).value;

/** بيسأل عن السبب الأول (الفتح بيتسجّل)، وبعدين بيعرض نسخة قراءة فقط من بوابة العميل. */
export function ViewAs({ companyId, companyName, onClose }: { companyId: number; companyName: string; onClose: () => void }) {
  const act = useAct();
  const [reason, setReason] = useState("");
  const [data, setData] = useState<ViewAsData | null>(null);
  const [tab, setTab] = useState("profile");
  const go = async () => {
    const r = await act.run(() => api.post<ViewAsData>(`/portal-companies/${companyId}/view-as`, { reason: reason.trim() }));
    if (r) setData(r);
  };
  if (!data) {
    return (
      <Dialog open onClose={onClose} title={t("va.ask.title", { name: companyName })} description={t("va.ask.desc")}
        footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={reason.trim().length < 3} onClick={() => void go()}>{t("va.ask.go")}</Button></>}>
        <Field label={t("va.ask.reason")} hint={t("va.ask.hint")} required><Textarea value={reason} maxLength={300} onInput={(e) => setReason(val(e))} /></Field>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title={t("va.title", { name: data.profile.companyName || companyName })} footer={<Button variant="ghost" onClick={onClose}>{t("va.close")}</Button>}>
      <div class="ad-stack">
        <InlineAlert tone="info">{t("va.banner")}</InlineAlert>
        <Tabs label={t("va.open")} value={tab} onChange={setTab} tabs={[
          { id: "profile", label: t("va.tab.profile"), panel: <Profile d={data} /> },
          { id: "orders", label: t("va.tab.orders"), panel: <Orders rows={data.orders} /> },
          { id: "quotes", label: t("va.tab.quotes"), panel: <Quotes d={data} /> },
          { id: "team", label: t("va.tab.team"), panel: <Team rows={data.team} /> },
          { id: "notices", label: t("va.tab.notices"), panel: <Notices rows={data.notices} /> },
        ]} />
      </div>
    </Dialog>
  );
}

function Profile({ d }: { d: ViewAsData }) {
  const p = d.profile;
  const rows: Array<[CopyKey, string | null]> = [["va.p.company", p.companyName], ["va.p.name", p.fullName], ["va.p.phone", p.phone], ["va.p.email", p.email], ["va.p.address", p.address], ["va.p.city", p.city]];
  return <dl class="ad-stack">{rows.map(([k, v]) => <div key={k}><dt class="ad-muted">{t(k)}</dt><dd>{v || "—"}</dd></div>)}</dl>;
}

function Orders({ rows }: { rows: Batch[] }) {
  if (!rows.length) return <EmptyState compact title={t("va.o.empty")} />;
  return (
    <ul class="ad-list">
      {rows.map((b) => (
        <li key={b.batchRef} class="ad-list__item">
          <strong class="num">{t("va.o.batch", { ref: b.batchRef })}</strong>
          <span class="ad-muted">{formatDateTime(b.createdAt)}</span>
          <StatusPill tone="info">{t(`va.o.status.${b.overallStatus}` as CopyKey)}</StatusPill>
          <ul>{b.items.map((i) => <li key={i.id}>{t("va.o.item", { name: i.productName, qty: formatNumber(Number(i.qty)) })}{i.referenceUnitPrice ? <span class="ad-muted"> · {t("va.o.price", { price: i.referenceUnitPrice })}</span> : null}</li>)}</ul>
        </li>
      ))}
    </ul>
  );
}

function Quotes({ d }: { d: ViewAsData }) {
  const qCols: Column<Quote>[] = [
    { key: "n", header: t("va.q.title"), cell: (q) => <span class="num">{q.quoteNumber}</span>, mobile: "title" },
    { key: "s", header: " ", cell: (q) => <StatusPill tone="info">{t(`va.q.status.${q.status}` as CopyKey)}</StatusPill> },
    { key: "v", header: " ", cell: (q) => t("va.q.valid", { date: formatDate(q.validUntil) }) },
  ];
  return (
    <div class="ad-stack">
      <h3>{t("va.q.title")}</h3>
      {d.quotes.length ? <DataTable columns={qCols} rows={d.quotes} rowKey={(q) => q.id} caption={t("va.q.title")} /> : <EmptyState compact title={t("va.q.empty")} />}
      <h3>{t("va.a.title")}</h3>
      {d.agreements.length ? (
        <ul class="ad-list">{d.agreements.map((a) => <li key={a.id} class="ad-list__item"><strong>{a.productName}</strong><span class="ad-muted">{t("va.a.range", { price: a.unitPrice, from: formatDate(a.validFrom), to: formatDate(a.validUntil) })}</span></li>)}</ul>
      ) : <EmptyState compact title={t("va.a.empty")} />}
    </div>
  );
}

function Team({ rows }: { rows: Member[] }) {
  if (!rows.length) return <EmptyState compact title={t("va.team.empty")} />;
  return <ul class="ad-list">{rows.map((m) => <li key={m.id} class="ad-list__item"><strong>{m.fullName}</strong><span class="ad-muted">{m.isOwner ? t("va.team.owner") : m.roleName}</span></li>)}</ul>;
}

function Notices({ rows }: { rows: Notice[] }) {
  if (!rows.length) return <EmptyState compact title={t("va.n.empty")} />;
  return <ul class="ad-list">{rows.map((n) => <li key={n.id} class="ad-list__item"><strong>{n.title}</strong><span class="ad-muted">{formatDateTime(n.createdAt)}</span><p>{n.body}</p></li>)}</ul>;
}
