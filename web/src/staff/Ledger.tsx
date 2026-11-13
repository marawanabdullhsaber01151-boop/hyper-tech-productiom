import "../copy/ledger";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, Tabs, Textarea, useToast, type Column } from "../design/components";
import { Plus } from "../design/icons";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import { accountTree, emptyForm, emptyLine, formIssues, formatCents, postableAccounts, toPayload, totals, type AccountRow, type EntryForm } from "./ledgerCore";
import { FINANCE_PAGE_ROLES } from "./staffRoles";
import "./Engineering.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const k = (key: string) => key as CopyKey;
const money = (v: string | number) => formatMoney(Number(v));
const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

interface Entry { id: number; entryNumber: string; entryDate: string; description: string; sourceType: string; status: string; reversalOf: number | null; total: string; createdByName: string | null }
interface EntryDetail extends Entry { lines: Array<{ id: number; lineNo: number; accountId: number; code: string; accountName: string; debit: string; credit: string; memo: string | null }> }
interface Period { id: number; year: number; month: number; status: string; fiscalYear: string }
interface PeriodsRes { items: Period[]; fiscalStartMonth: number; currentFiscalYear: string }
interface TbRow { accountId: number; code: string; name: string; balanceDebit: string; balanceCredit: string; debit: string; credit: string }
interface Tb { rows: TbRow[]; totalDebit: string; totalCredit: string; totalBalanceDebit: string; totalBalanceCredit: string; balanced: boolean }

/** الحسابات والقيود: دليل الحسابات، قيود اليومية (يدوي وعكسي)، ميزان المراجعة، والفترات. */
export function Ledger() {
  const role = staffUser()?.role ?? "";
  const allowed = (FINANCE_PAGE_ROLES as readonly string[]).includes(role);
  const [tab, setTab] = useState("entries");
  const periods = useQuery((signal) => (allowed ? api.get<PeriodsRes>("/ledger/periods", { signal }) : Promise.resolve({ items: [], fiscalStartMonth: 1, currentFiscalYear: "" } as PeriodsRes)), [allowed]);
  if (!allowed) return <div class="ad-page"><InlineAlert tone="warn">{t("lg.noAccess")}</InlineAlert></div>;
  return (
    <div class="ad-page">
      <div>
        <h1 class="ad-title">{t("lg.title")}</h1>
        <p class="st-login__sub">{t("lg.subtitle")}</p>
        {periods.data?.currentFiscalYear ? <p class="eng-muted">{t("lg.fy", { fy: periods.data.currentFiscalYear })}</p> : null}
      </div>
      <Tabs label={t("lg.title")} value={tab} onChange={setTab} tabs={[
        { id: "entries", label: t("lg.tab.entries"), panel: <Entries /> },
        { id: "accounts", label: t("lg.tab.accounts"), panel: <Accounts /> },
        { id: "trial", label: t("lg.tab.trial"), panel: <Trial /> },
        { id: "periods", label: t("lg.tab.periods"), panel: <Periods data={periods.data?.items ?? []} /> },
      ]} />
    </div>
  );
}

/* ---------------- قيود اليومية ---------------- */
function Entries() {
  const [search, setSearch] = useState("");
  const q = useQuery((signal) => api.get<{ items: Entry[] }>(`/ledger/entries?q=${encodeURIComponent(search)}`, { signal }), [search]);
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const rows = q.data?.items ?? [];
  const cols: Column<Entry>[] = [
    { key: "n", header: t("lg.col.number"), cell: (r) => <Button size="sm" variant="ghost" onClick={() => setOpen(r.id)}>{r.entryNumber}</Button>, mobile: "title" },
    { key: "d", header: t("lg.col.date"), cell: (r) => formatDate(r.entryDate) },
    { key: "x", header: t("lg.col.desc"), cell: (r) => r.description, mobile: "hide" },
    { key: "s", header: t("lg.col.source"), cell: (r) => t(k(`lg.src.${r.sourceType === "reversal" ? "reversal" : "manual"}`)), mobile: "hide" },
    { key: "t", header: t("lg.col.total"), cell: (r) => money(r.total), numeric: true },
    { key: "st", header: t("lg.col.status"), cell: (r) => <StatusPill tone={r.status === "posted" ? "success" : "warn"}>{t(k(`lg.status.${r.status}`))}</StatusPill> },
  ];
  return (
    <div class="ad-stack">
      <div class="eng-toolbar">
        <Button icon={Plus} onClick={() => setForm(true)}>{t("lg.e.new")}</Button>
        <Input value={search} placeholder={t("lg.e.search")} aria-label={t("lg.e.search")} onInput={(e) => setSearch(val(e))} />
      </div>
      {q.error ? <InlineAlert tone="danger" title={t("lg.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("lg.retry")}</Button>}>{q.error.message}</InlineAlert> : null}
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} caption={t("lg.e.caption")} loading={q.loading} empty={<EmptyState compact title={t("lg.e.empty")} description={t("lg.e.emptyHint")} />} />
      {form ? <EntryDialog onClose={() => setForm(false)} onDone={() => { setForm(false); void q.refetch(); }} /> : null}
      {open !== null ? <EntryView id={open} onClose={() => setOpen(null)} onChanged={() => void q.refetch()} /> : null}
    </div>
  );
}

function EntryDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const toast = useToast();
  const accts = useQuery((signal) => api.get<{ items: AccountRow[] }>("/ledger/accounts", { signal }), []);
  const [f, setF] = useState<EntryForm>(() => emptyForm(cairoToday()));
  const [tried, setTried] = useState(false);
  const [nextKey, setNextKey] = useState(3);
  const list = postableAccounts(accts.data?.items ?? []);
  const issues = formIssues(f);
  const tot = totals(f);
  const setLine = (key: number, patch: Partial<EntryForm["lines"][number]>) => setF({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const post = async () => {
    setTried(true);
    if (issues.length) return;
    const r = await act.run(() => api.post<{ entryNumber: string }>("/ledger/entries", toPayload(f)));
    if (r) { toast({ tone: "success", message: t("lg.f.posted", { n: r.entryNumber }) }); onDone(); }
  };
  const options = [{ value: "", label: t("lg.f.pick") }, ...list.map((a) => ({ value: String(a.id), label: `${a.code} - ${a.name}` }))];
  return (
    <Dialog open onClose={onClose} title={t("lg.f.title")} description={t("lg.f.desc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} onClick={() => void post()}>{t("lg.f.post")}</Button></>}>
      <div class="eng-form">
        <Field label={t("lg.f.date")} required><Input type="date" value={f.entryDate} onInput={(e) => setF({ ...f, entryDate: val(e) })} /></Field>
        <Field label={t("lg.f.text")} hint={t("lg.f.textHint")} required><Textarea value={f.description} maxLength={500} onInput={(e) => setF({ ...f, description: val(e) })} /></Field>
        {f.lines.map((l, i) => (
          <div key={l.key} class="eng-form">
            <Field label={`${t("lg.f.account")} ${formatNumber(i + 1)}`}><Select value={l.accountId} options={options} onChange={(e) => setLine(l.key, { accountId: val(e) })} /></Field>
            <Field label={t("lg.f.debit")}><Input inputMode="decimal" dir="ltr" value={l.debit} onInput={(e) => setLine(l.key, { debit: val(e) })} /></Field>
            <Field label={t("lg.f.credit")}><Input inputMode="decimal" dir="ltr" value={l.credit} onInput={(e) => setLine(l.key, { credit: val(e) })} /></Field>
            <Field label={t("lg.f.memo")}><Input value={l.memo} maxLength={300} onInput={(e) => setLine(l.key, { memo: val(e) })} /></Field>
            {f.lines.length > 2 ? <Button size="sm" variant="ghost" onClick={() => setF({ ...f, lines: f.lines.filter((x) => x.key !== l.key) })}>{t("lg.f.removeLine", { n: formatNumber(i + 1) })}</Button> : null}
          </div>
        ))}
        <div><Button size="sm" variant="secondary" icon={Plus} onClick={() => { setF({ ...f, lines: [...f.lines, emptyLine(nextKey)] }); setNextKey(nextKey + 1); }}>{t("lg.f.addLine")}</Button></div>
        <p>{t("lg.f.totals", { d: formatCents(tot.debit), c: formatCents(tot.credit) })} {!tot.badAmount ? <StatusPill tone={tot.diff === 0n ? "success" : "danger"}>{tot.diff === 0n ? t("lg.f.balanced") : t("lg.f.diff", { n: formatCents(tot.diff < 0n ? -tot.diff : tot.diff) })}</StatusPill> : null}</p>
        {tried && issues.length ? <InlineAlert tone="danger">{issues.map((i) => t(k(`lg.issue.${i}`))).join(" - ")}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}

function EntryView({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const act = useAct();
  const q = useQuery((signal) => api.get<EntryDetail>(`/ledger/entries/${id}`, { signal }), [id]);
  const [reverse, setReverse] = useState<string | null>(null);
  const e = q.data;
  const doReverse = async () => {
    if (!e) return;
    const r = await act.run(() => api.post<{ entryNumber: string }>(`/ledger/entries/${e.id}/reverse`, { reason: (reverse ?? "").trim() }), t("lg.d.reverseDone", { n: e.entryNumber }));
    if (r) { setReverse(null); onChanged(); void q.refetch(); }
  };
  const cols: Column<EntryDetail["lines"][number]>[] = [
    { key: "a", header: t("lg.f.account"), cell: (l) => `${l.code} - ${l.accountName}`, mobile: "title" },
    { key: "d", header: t("lg.f.debit"), cell: (l) => (Number(l.debit) ? money(l.debit) : "—"), numeric: true },
    { key: "c", header: t("lg.f.credit"), cell: (l) => (Number(l.credit) ? money(l.credit) : "—"), numeric: true },
    { key: "m", header: t("lg.f.memo"), cell: (l) => l.memo ?? "", mobile: "hide" },
  ];
  return (
    <>
      <Dialog open={reverse === null} onClose={onClose} title={t("lg.d.title", { n: e?.entryNumber ?? "" })}
        footer={<><Button variant="ghost" onClick={onClose}>{t("lg.d.close")}</Button>{e && e.status === "posted" && !e.reversalOf ? <Button variant="secondary" onClick={() => setReverse("")}>{t("lg.d.reverse")}</Button> : null}</>}>
        {q.error ? <InlineAlert tone="danger">{q.error.message}</InlineAlert> : null}
        {e ? (
          <div class="eng-form">
            <p>{formatDate(e.entryDate)} - {e.description}</p>
            <div class="eng-actions"><StatusPill tone={e.status === "posted" ? "success" : "warn"}>{t(k(`lg.status.${e.status}`))}</StatusPill>{e.reversalOf ? <StatusPill tone="info">{t("lg.d.reversalOf")}</StatusPill> : null}</div>
            {e.createdByName ? <p class="eng-muted">{t("lg.d.by", { name: e.createdByName })}</p> : null}
            <DataTable columns={cols} rows={e.lines} rowKey={(l) => l.id} caption={t("lg.d.title", { n: e.entryNumber })} />
          </div>
        ) : null}
      </Dialog>
      <Dialog open={reverse !== null} onClose={() => setReverse(null)} title={t("lg.d.reverseTitle", { n: e?.entryNumber ?? "" })} description={t("lg.d.reverseDesc")}
        footer={<><Button variant="ghost" onClick={() => setReverse(null)}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={(reverse ?? "").trim().length < 3} onClick={() => void doReverse()}>{t("lg.d.reverseGo")}</Button></>}>
        <Field label={t("lg.d.reason")} required><Textarea value={reverse ?? ""} maxLength={300} onInput={(ev) => setReverse(val(ev))} /></Field>
      </Dialog>
    </>
  );
}

/* ---------------- دليل الحسابات ---------------- */
function Accounts() {
  const act = useAct();
  const q = useQuery((signal) => api.get<{ items: AccountRow[] }>("/ledger/accounts", { signal }), []);
  const [form, setForm] = useState(false);
  const rows = accountTree(q.data?.items ?? []);
  const toggle = async (a: AccountRow) => {
    const r = await act.run(() => api.patch<AccountRow>(`/ledger/accounts/${a.id}`, { isActive: !a.isActive }), a.isActive ? t("lg.a.stopped") : t("lg.a.resumed"));
    if (r) void q.refetch();
  };
  const cols: Column<AccountRow & { depth: number }>[] = [
    { key: "c", header: t("lg.a.col.code"), cell: (a) => <span class="num" dir="ltr">{a.code}</span> },
    { key: "n", header: t("lg.a.col.name"), cell: (a) => <span style={{ paddingInlineStart: `${a.depth * 16}px` }}>{a.isPostable ? a.name : <strong>{a.name}</strong>}{!a.isActive ? <span class="eng-muted"> ({t("lg.a.inactive")})</span> : null}</span>, mobile: "title" },
    { key: "t", header: t("lg.a.col.type"), cell: (a) => t(k(`lg.type.${a.type}`)), mobile: "hide" },
    { key: "s", header: t("lg.a.col.kind"), cell: (a) => (a.isPostable ? t(k(`lg.side.${a.normalSide}`)) : t("lg.a.group")), mobile: "hide" },
    { key: "x", header: " ", cell: (a) => (a.isPostable ? <Button size="sm" variant="ghost" onClick={() => void toggle(a)}>{a.isActive ? t("lg.a.stop") : t("lg.a.resume")}</Button> : null) },
  ];
  return (
    <div class="ad-stack">
      <div class="eng-toolbar"><Button icon={Plus} onClick={() => setForm(true)}>{t("lg.a.new")}</Button></div>
      {q.error ? <InlineAlert tone="danger" title={t("lg.err")}>{q.error.message}</InlineAlert> : null}
      <DataTable columns={cols} rows={rows} rowKey={(a) => a.id} caption={t("lg.a.caption")} loading={q.loading} />
      {form ? <AccountDialog rows={q.data?.items ?? []} onClose={() => setForm(false)} onDone={() => { setForm(false); void q.refetch(); }} /> : null}
    </div>
  );
}

function AccountDialog({ rows, onClose, onDone }: { rows: AccountRow[]; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("asset");
  const [parent, setParent] = useState("");
  const [postable, setPostable] = useState(true);
  const groups = rows.filter((r) => !r.isPostable && r.type === type).sort((a, b) => a.code.localeCompare(b.code));
  const save = async () => {
    const r = await act.run(() => api.post<AccountRow>("/ledger/accounts", { code: code.trim(), name: name.trim(), type, parentId: parent ? Number(parent) : null, isPostable: postable }), t("lg.a.f.saved"));
    if (r) onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("lg.a.f.title")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={!/^\d{3,8}$/.test(code.trim()) || name.trim().length < 2} onClick={() => void save()}>{t("lg.a.f.save")}</Button></>}>
      <div class="eng-form">
        <Field label={t("lg.a.f.type")}><Select value={type} onChange={(e) => { setType(val(e)); setParent(""); }} options={["asset", "liability", "equity", "revenue", "expense"].map((x) => ({ value: x, label: t(k(`lg.type.${x}`)) }))} /></Field>
        <Field label={t("lg.a.f.parent")}><Select value={parent} onChange={(e) => setParent(val(e))} options={[{ value: "", label: t("lg.a.f.none") }, ...groups.map((g) => ({ value: String(g.id), label: `${g.code} - ${g.name}` }))]} /></Field>
        <Field label={t("lg.a.f.code")} hint={t("lg.a.f.codeHint")} required><Input inputMode="numeric" dir="ltr" value={code} maxLength={8} onInput={(e) => setCode(val(e))} /></Field>
        <Field label={t("lg.a.f.name")} required><Input value={name} maxLength={120} onInput={(e) => setName(val(e))} /></Field>
        <label><input type="checkbox" checked={postable} onChange={() => setPostable(!postable)} /> {t("lg.a.f.postable")}</label>
      </div>
    </Dialog>
  );
}

/* ---------------- ميزان المراجعة ---------------- */
function Trial() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useQuery((signal) => api.get<Tb>(`/ledger/trial-balance?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}`, { signal }), [from, to]);
  const d = q.data;
  const cols: Column<TbRow>[] = [
    { key: "c", header: t("lg.a.col.code"), cell: (r) => <span class="num" dir="ltr">{r.code}</span> },
    { key: "n", header: t("lg.a.col.name"), cell: (r) => r.name, mobile: "title" },
    { key: "d", header: t("lg.t.dr"), cell: (r) => money(r.debit), numeric: true, mobile: "hide" },
    { key: "cr", header: t("lg.t.cr"), cell: (r) => money(r.credit), numeric: true, mobile: "hide" },
    { key: "bd", header: t("lg.t.bdr"), cell: (r) => (Number(r.balanceDebit) ? money(r.balanceDebit) : "—"), numeric: true },
    { key: "bc", header: t("lg.t.bcr"), cell: (r) => (Number(r.balanceCredit) ? money(r.balanceCredit) : "—"), numeric: true },
  ];
  return (
    <div class="ad-stack">
      <div class="eng-toolbar">
        <Field label={t("lg.t.from")}><Input type="date" value={from} onInput={(e) => setFrom(val(e))} /></Field>
        <Field label={t("lg.t.to")}><Input type="date" value={to} onInput={(e) => setTo(val(e))} /></Field>
      </div>
      {q.error ? <InlineAlert tone="danger" title={t("lg.err")}>{q.error.message}</InlineAlert> : null}
      {d ? (
        <>
          <div class="st-stats">
            <Stat label={t("lg.t.bdr")} value={money(d.totalBalanceDebit)} />
            <Stat label={t("lg.t.bcr")} value={money(d.totalBalanceCredit)} />
          </div>
          <InlineAlert tone={d.balanced ? "info" : "danger"}>{d.balanced ? t("lg.t.ok") : t("lg.t.bad")}</InlineAlert>
        </>
      ) : null}
      <DataTable columns={cols} rows={d?.rows ?? []} rowKey={(r) => r.accountId} caption={t("lg.t.caption")} loading={q.loading} empty={<EmptyState compact title={t("lg.t.empty")} />} />
    </div>
  );
}

/* ---------------- الفترات ---------------- */
function Periods({ data }: { data: Period[] }) {
  const cols: Column<Period>[] = [
    { key: "p", header: t("lg.p.col.period"), cell: (p) => <span class="num" dir="ltr">{p.year}-{String(p.month).padStart(2, "0")}</span>, mobile: "title" },
    { key: "f", header: t("lg.p.col.fy"), cell: (p) => p.fiscalYear },
    { key: "s", header: t("lg.p.col.status"), cell: (p) => <StatusPill tone={p.status === "open" ? "success" : "warn"}>{p.status === "open" ? t("lg.p.open") : t("lg.p.closed")}</StatusPill> },
  ];
  return (
    <div class="ad-stack">
      <p class="eng-muted">{t("lg.p.hint")}</p>
      <DataTable columns={cols} rows={data} rowKey={(p) => p.id} caption={t("lg.p.caption")} empty={<EmptyState compact title={t("lg.p.empty")} />} />
    </div>
  );
}
