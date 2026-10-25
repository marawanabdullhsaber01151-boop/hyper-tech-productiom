import { useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { navigate } from "../app/router";
import { t, type CopyKey } from "../copy";
import { GOVERNORATES } from "../copy/governorates";
import { Button, DataTable, EmptyState, FilterBar, InlineAlert, Select, Stat, StatusPill, Tabs, useToast, type Column } from "../design/components";
import { Download, Plus } from "../design/icons";
import { formatNumber } from "../lib/format";
import { ContactDrawer } from "./ContactDrawer";
import { ContactEditor } from "./ContactEditor";
import { SEGMENTS, canWriteContacts, contactCounts, filterContacts, initials, isCustomer, isSupplier, sortContacts, telLink, type ContactRow, type SortKey, type TypeTab } from "./contactsCore";
import { buildCsv } from "./salesCore";
import { CONTACT_ROLES } from "./staffRoles";
import "./Contacts.css";

export { CONTACT_ROLES };
const SORTS: SortKey[] = ["name", "recent", "activity"];
const typeTone = (type: string) => (type === "supplier" ? "warn" : type === "both" ? "brand" : "info");

/** الموردون والعملاء: بحث وفلاتر، اتصال وواتساب بضغطة، نشاط كل جهة، وتحذير من التكرار. */
export function Contacts() {
  const role = staffUser()?.role ?? "";
  const canWrite = canWriteContacts(role);
  const toast = useToast();
  const qs = new URLSearchParams(location.search);
  const [tab, setTab] = useState<TypeTab>(() => (qs.get("tab") === "supplier" || qs.get("tab") === "customer" ? (qs.get("tab") as TypeTab) : "all"));
  const [search, setSearch] = useState(() => qs.get("q") ?? "");
  const [city, setCity] = useState("");
  const [segment, setSegment] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [openId, setOpenId] = useState<number | null>(() => Number(qs.get("open")) || null);
  const [editor, setEditor] = useState<{ contact?: ContactRow } | null>(null);

  const list = useQuery((signal) => api.get<ContactRow[]>("/contacts/overview", { signal }), []);
  const rows = Array.isArray(list.data) ? list.data : [];
  const counts = useMemo(() => contactCounts(rows), [rows]);
  const shown = useMemo(() => sortContacts(filterContacts(rows, { tab, search, city, segment }), sort), [rows, tab, search, city, segment, sort]);
  const opened = openId === null ? undefined : rows.find((r) => r.id === openId);
  const cities = useMemo(() => GOVERNORATES.filter((g) => rows.some((r) => r.city === g)), [rows]);
  const filtered = (city ? 1 : 0) + (segment ? 1 : 0);

  const exportCsv = () => {
    const header = [t("con.col.name"), t("con.ed.company"), t("con.col.type"), t("con.col.phone"), t("con.ed.email"), t("con.col.city"), t("con.col.segment"), t("con.ed.address")];
    const csv = buildCsv(
      header,
      shown.map((c) => [c.name, c.company ?? "", t(`con.type.${c.type}` as CopyKey), c.phone ?? "", c.email ?? "", c.city ?? "", c.segment ? t(`con.seg.${c.segment}` as CopyKey) : "", c.address ?? ""]),
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ tone: "success", message: t("con.export.done") });
  };

  const columns: Column<ContactRow>[] = [
    {
      key: "name",
      header: t("con.col.name"),
      cell: (r) => (
        <span class="con-name">
          <span class="con-avatar con-avatar--sm" aria-hidden="true">{initials(r.name)}</span>
          <span>
            <strong>{r.name}</strong>
            {r.company ? <small class="con-muted">{r.company}</small> : null}
          </span>
        </span>
      ),
      mobile: "title",
    },
    { key: "type", header: t("con.col.type"), cell: (r) => <StatusPill tone={typeTone(r.type)}>{t(`con.type.${r.type}` as CopyKey)}</StatusPill> },
    {
      key: "phone",
      header: t("con.col.phone"),
      cell: (r) => {
        const tel = telLink(r.phone);
        return r.phone ? (
          tel ? <a href={tel} dir="ltr" class="con-tel" onClick={(e) => e.stopPropagation()} aria-label={t("con.callnow", { name: r.name })}>{r.phone}</a> : <span dir="ltr">{r.phone}</span>
        ) : (
          "—"
        );
      },
    },
    { key: "city", header: t("con.col.city"), cell: (r) => r.city ?? "—", mobile: "hide" },
    { key: "segment", header: t("con.col.segment"), cell: (r) => (r.segment ? t(`con.seg.${r.segment}` as CopyKey) : "—"), mobile: "hide" },
    {
      key: "activity",
      header: t("con.col.activity"),
      cell: (r) => {
        const parts: string[] = [];
        if (isCustomer(r) && r.salesCount > 0) parts.push(t("con.act.sales", { n: formatNumber(r.salesCount) }));
        if (isSupplier(r) && r.poCount > 0) parts.push(t("con.act.po", { n: formatNumber(r.poCount) }));
        return parts.length ? parts.join(" | ") : <span class="con-muted">{t("con.act.none")}</span>;
      },
      mobile: "hide",
    },
  ];

  const tabs: Array<{ id: TypeTab; label: string }> = [
    { id: "all", label: t("con.tab.all") },
    { id: "customer", label: t("con.tab.customer") },
    { id: "supplier", label: t("con.tab.supplier") },
  ];
  const table = (
    <>
      <FilterBar search={search} onSearch={setSearch} searchLabel={t("con.search")} activeCount={filtered} onClear={() => { setCity(""); setSegment(""); }}>
        <Select aria-label={t("con.col.city")} value={city} options={[{ value: "", label: t("con.f.city") }, ...cities.map((g) => ({ value: g, label: g }))]} onChange={(e) => setCity((e.target as HTMLSelectElement).value)} />
        <Select aria-label={t("con.col.segment")} value={segment} options={[{ value: "", label: t("con.f.segment") }, ...SEGMENTS.map((s) => ({ value: s, label: t(`con.seg.${s}` as CopyKey) }))]} onChange={(e) => setSegment((e.target as HTMLSelectElement).value)} />
        <Select aria-label={t("con.sort.label")} value={sort} options={SORTS.map((s) => ({ value: s, label: t(`con.sort.${s}` as CopyKey) }))} onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortKey)} />
      </FilterBar>
      {list.error ? <InlineAlert tone="danger" title={t("con.err")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("con.retry")}</Button>}>{list.error.message}</InlineAlert> : null}
      <DataTable
        columns={columns}
        rows={shown}
        rowKey={(r) => r.id}
        caption={t("con.caption")}
        loading={list.loading}
        onRowClick={(r) => setOpenId(r.id)}
        empty={rows.length ? <EmptyState title={t("con.empty.title")} description={t("con.empty.filtered")} compact /> : <EmptyState title={t("con.empty.title")} description={t("con.empty.body")} compact />}
      />
    </>
  );

  return (
    <div class="ad-page">
      <h1 class="ad-title">{t("con.title")}</h1>
      <p class="st-login__sub">{t("con.subtitle")}</p>
      <div class="con-bar">
        {canWrite ? <Button icon={Plus} onClick={() => setEditor({})}>{t("con.new")}</Button> : null}
        <Button variant="secondary" icon={Download} onClick={exportCsv} disabled={shown.length === 0}>{t("con.export")}</Button>
      </div>
      <div class="con-stats">
        <Stat label={t("con.stat.total")} value={formatNumber(counts.total)} />
        <Stat label={t("con.stat.customers")} value={formatNumber(counts.customers)} />
        <Stat label={t("con.stat.suppliers")} value={formatNumber(counts.suppliers)} />
        {counts.both ? <Stat label={t("con.stat.both")} value={formatNumber(counts.both)} /> : null}
      </div>
      <Tabs value={tab} onChange={(v) => setTab(v as TypeTab)} tabs={tabs.map((x) => ({ id: x.id, label: x.label, panel: table }))} />
      {opened ? (
        <ContactDrawer
          contact={opened}
          canWrite={canWrite}
          onClose={() => setOpenId(null)}
          onEdit={() => setEditor({ contact: opened })}
          onDeleted={() => {
            setOpenId(null);
            void list.refetch();
          }}
          onOpenSale={(id) => navigate(`/staff/sales?open=${id}`)}
          onOpenPo={(id) => navigate(`/staff/purchases?po=${id}`)}
          onAllSales={() => navigate(`/staff/sales?customer=${opened.id}`)}
        />
      ) : null}
      {editor ? (
        <ContactEditor
          contact={editor.contact}
          startTab={tab}
          onClose={() => setEditor(null)}
          onSaved={(id) => {
            setEditor(null);
            setOpenId(id);
            void list.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
