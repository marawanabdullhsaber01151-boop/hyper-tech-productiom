import { useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { staffUser, SALES_ROLES } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, EmptyState, FilterBar, InlineAlert, Pagination, Select, Stat, StatusPill, Tabs, useToast, type Column } from "../design/components";
import { Download, Plus } from "../design/icons";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import { SalesDetail, statusLabel, statusTone } from "./SalesDetail";
import { SalesEditor, type CustomerOpt } from "./SalesEditor";
import { SALES_STATUSES, buildCsv, dateBounds, isOverdue, overdueDays, type DatePreset, type SalesChannel, type SalesOrder } from "./salesCore";
import "./Sales.css";

export const SALES_PAGE_ROLES = SALES_ROLES;
const PAGE_SIZE = 15;
const PRESETS: DatePreset[] = ["all", "today", "week", "month", "year"];

interface ListResp {
  items: SalesOrder[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  statusCounts: Record<string, number>;
  summary: { total: number; revenue: string; pending: number; customers: number };
}
interface Contact extends CustomerOpt {
  type?: string;
}

/** بائع الأونلاين بيشوف الأونلاين بس، وبائع الأوفلاين فواتيره بس. الباقي بيختار القناة. */
export function fixedChannel(role: string): SalesChannel | null {
  return role === "online_seller" ? "website" : role === "offline_seller" ? "direct" : null;
}

export function Sales() {
  const role = staffUser()?.role ?? "";
  const fixed = fixedChannel(role);
  const toast = useToast();
  const qs = new URLSearchParams(location.search);
  const [tab, setTab] = useState<string>(() => fixed ?? (qs.get("channel") === "website" || qs.get("channel") === "direct" ? (qs.get("channel") as string) : "all"));
  const [status, setStatus] = useState(() => ((SALES_STATUSES as readonly string[]).includes(qs.get("status") ?? "") ? (qs.get("status") as string) : ""));
  const [search, setSearch] = useState(qs.get("q") ?? "");
  const [customer, setCustomer] = useState("");
  const [preset, setPreset] = useState<DatePreset>("all");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(() => Number(qs.get("open")) || null);
  const [editor, setEditor] = useState<{ order?: SalesOrder } | null>(null);
  const [exporting, setExporting] = useState(false);

  const channel = fixed ?? (tab === "all" ? undefined : (tab as SalesChannel));
  const bounds = dateBounds(preset);
  const query = { status, contact_id: customer, search: search.trim(), channel, date_from: bounds.from, date_to: bounds.to };
  const list = useQuery(
    (signal) => api.get<ListResp>("/sales", { signal, query: { ...query, page, page_size: PAGE_SIZE } }),
    [page, status, search, customer, preset, channel],
  );
  const contacts = useQuery((signal) => api.get<Contact[]>("/contacts", { signal }), []);

  const customers = useMemo(() => (contacts.data ?? []).filter((c) => !c.type || c.type === "customer" || c.type === "both"), [contacts.data]);
  const nameById = useMemo(() => new Map((contacts.data ?? []).map((c) => [c.id, c.name])), [contacts.data]);
  const customerName = (id: number | null) => (id === null ? t("sales.noCustomer") : nameById.get(id) ?? `#${id}`);

  const data = list.data;
  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 0;
  useEffect(() => {
    if (totalPages > 0 && page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const activeCount = (status ? 1 : 0) + (customer ? 1 : 0) + (preset !== "all" ? 1 : 0) + (search.trim() ? 1 : 0);
  const clear = () => {
    setStatus("");
    setCustomer("");
    setPreset("all");
    setSearch("");
    setPage(1);
  };
  const allCount = Object.values(data?.statusCounts ?? {}).reduce((a, b) => a + b, 0);

  const canCreate = role !== "online_seller" && tab !== "website";
  const titleKey: CopyKey = channel === "website" ? "sales.title.website" : channel === "direct" ? "sales.title.direct" : "sales.title";
  const subKey: CopyKey = channel === "website" ? "sales.subtitle.website" : channel === "direct" ? "sales.subtitle.direct" : "sales.subtitle.all";

  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const all: SalesOrder[] = [];
      for (let p = 1; p <= 30; p += 1) {
        const r = await api.get<ListResp>("/sales", { query: { ...query, page: p, page_size: 100 } });
        all.push(...r.items);
        if (p >= r.pagination.totalPages) break;
      }
      if (!all.length) {
        toast({ tone: "info", message: t("sales.export.empty") });
        return;
      }
      const csv = buildCsv(
        [t("sales.col.number"), t("sales.col.customer"), t("sales.col.channel"), t("sales.col.date"), t("sales.col.due"), t("sales.col.status"), t("sales.col.total")],
        all.map((o) => [o.orderNumber, customerName(o.contactId), t(`sales.channel.${o.channel}` as CopyKey), o.date, o.dueDate ?? "", statusLabel(o.status), Number(o.total).toFixed(2)]),
      );
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `sales-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast({ tone: "success", message: t("sales.export.done") });
    } catch {
      toast({ tone: "danger", message: t("sales.export.fail") });
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<SalesOrder>[] = [
    { key: "no", header: t("sales.col.number"), cell: (o) => o.orderNumber, mobile: "title" },
    { key: "cust", header: t("sales.col.customer"), cell: (o) => customerName(o.contactId) },
    ...(fixed ? [] : [{ key: "ch", header: t("sales.col.channel"), cell: (o: SalesOrder) => t(`sales.channel.${o.channel}` as CopyKey), mobile: "hide" as const }]),
    { key: "date", header: t("sales.col.date"), cell: (o) => formatDate(o.date), mobile: "hide" },
    {
      key: "due",
      header: t("sales.col.due"),
      cell: (o) => (isOverdue(o) ? <StatusPill tone="danger">{t("sales.overdue", { n: overdueDays(o) })}</StatusPill> : o.dueDate ? formatDate(o.dueDate) : "—"),
      mobile: "hide",
    },
    { key: "status", header: t("sales.col.status"), cell: (o) => <StatusPill tone={statusTone(o.status)}>{statusLabel(o.status)}</StatusPill> },
    { key: "total", header: t("sales.col.total"), cell: (o) => formatMoney(Number(o.total)), numeric: true },
  ];

  const tabs = [
    { id: "all", label: t("sales.tab.all"), panel: null },
    { id: "website", label: t("sales.tab.website"), panel: null },
    { id: "direct", label: t("sales.tab.direct"), panel: null },
  ];

  return (
    <div class="sales">
      <header class="sales-head">
        <div>
          <h1 class="sales-title">{t(titleKey)}</h1>
          <p class="sales-muted">{t(subKey)}</p>
        </div>
        <div class="sales-head__actions">
          <Button variant="secondary" icon={Download} loading={exporting} onClick={() => void exportCsv()}>
            {t("sales.export")}
          </Button>
          {canCreate ? (
            <Button icon={Plus} onClick={() => setEditor({})}>
              {t("sales.new")}
            </Button>
          ) : null}
        </div>
      </header>

      {!fixed ? <Tabs tabs={tabs} value={tab} onChange={reset(setTab)} /> : null}

      <div class="sales-stats">
        <Stat label={t("sales.stat.total")} value={formatNumber(data?.summary.total ?? 0)} />
        <Stat label={t("sales.stat.revenue")} value={formatMoney(Number(data?.summary.revenue ?? 0))} hint={t("sales.stat.revenue.hint")} tone="success" />
        <Stat label={t("sales.stat.pending")} value={formatNumber(data?.summary.pending ?? 0)} hint={t("sales.stat.pending.hint")} tone="warn" />
        <Stat label={t("sales.stat.customers")} value={formatNumber(data?.summary.customers ?? 0)} />
      </div>

      <div class="sales-chips" role="group" aria-label={t("sales.col.status")}>
        {[{ id: "", n: allCount }, ...SALES_STATUSES.map((s) => ({ id: s as string, n: data?.statusCounts[s] ?? 0 }))].map((c) => (
          <button key={c.id || "all"} type="button" class="sales-chip" aria-pressed={status === c.id} onClick={() => reset(setStatus)(c.id)}>
            {c.id ? statusLabel(c.id) : t("sales.chip.all")}
            <span class="sales-chip__n">{formatNumber(c.n)}</span>
          </button>
        ))}
      </div>

      <FilterBar search={search} onSearch={reset(setSearch)} searchLabel={t("sales.search")} activeCount={activeCount} onClear={clear}>
        <Select aria-label={t("sales.f.customer")} value={customer} onChange={(e) => reset(setCustomer)((e.target as HTMLSelectElement).value)} placeholder={t("sales.f.customer.all")} options={customers.map((c) => ({ value: String(c.id), label: c.name }))} />
        <Select aria-label={t("sales.f.date")} value={preset} onChange={(e) => reset(setPreset)((e.target as HTMLSelectElement).value as DatePreset)} options={PRESETS.map((p) => ({ value: p, label: t(`sales.date.${p}` as CopyKey) }))} />
      </FilterBar>

      {list.error && !data ? (
        <InlineAlert tone="danger" title={t("sales.err")} action={<Button variant="secondary" size="sm" onClick={() => void list.refetch()}>{t("sales.retry")}</Button>} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(o) => o.id}
            caption={t("sales.caption")}
            loading={list.loading && !data}
            onRowClick={(o) => setOpenId(o.id)}
            empty={
              <EmptyState
                title={activeCount ? t("sales.empty.title") : t("sales.empty.none.title")}
                description={activeCount ? t("sales.empty.body") : channel === "website" ? t("sales.empty.website") : t("sales.empty.none.body")}
              />
            }
          />
          {total > PAGE_SIZE ? <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /> : null}
        </>
      )}

      {openId !== null ? (
        <SalesDetail
          id={openId}
          role={role}
          customerName={customerName}
          onClose={() => setOpenId(null)}
          onChanged={() => void list.refetch()}
          onEdit={(o) => {
            setOpenId(null);
            setEditor({ order: o });
          }}
        />
      ) : null}
      {editor ? <SalesEditor order={editor.order} customers={customers} onClose={() => setEditor(null)} onSaved={() => void list.refetch()} /> : null}
    </div>
  );
}
