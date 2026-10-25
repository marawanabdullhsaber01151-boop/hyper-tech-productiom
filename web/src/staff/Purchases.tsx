import { useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, EmptyState, FilterBar, InlineAlert, Select, Stat, StatusPill, Tabs, type Column } from "../design/components";
import { Plus } from "../design/icons";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import { PurchaseDetail, poStatusLabel, poStatusTone } from "./PurchaseDetail";
import { PurchaseEditor } from "./PurchaseEditor";
import { PO_STATUSES, canBuy, draftFromNeeds, groupNeeds, lateDays, poCounts, type Draft, type Need, type PoFull, type PoRow } from "./purchasingCore";
import "./Purchases.css";

/** المشتريات: احتياجات الشراء (من الإنتاج والتخطيط) ← أمر شراء ← اعتماد ← استلام بيدخّل المخزون. */
export function Purchases() {
  const role = staffUser()?.role ?? "";
  const buyer = canBuy(role);
  const params = new URLSearchParams(location.search);
  const [tab, setTab] = useState(() => (buyer && params.get("tab") !== "orders" ? "needs" : "orders"));
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const [status, setStatus] = useState(() => {
    const s = params.get("status") ?? "";
    return (PO_STATUSES as readonly string[]).includes(s) ? s : "";
  });
  const [openId, setOpenId] = useState<number | null>(() => {
    const n = Number(params.get("po"));
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  const [editor, setEditor] = useState<{ order?: PoFull; initial?: Pick<Draft, "supplierId" | "lines"> } | null>(null);

  const orders = useQuery((signal) => api.get<PoRow[]>("/purchases", { signal }), []);
  const needs = useQuery((signal) => (buyer ? api.get<Need[]>("/purchases/needs", { signal }) : Promise.resolve([] as Need[])), [buyer]);
  const rows = Array.isArray(orders.data) ? orders.data : [];
  const needRows = Array.isArray(needs.data) ? needs.data : [];
  const counts = useMemo(() => poCounts(rows), [rows]);
  const groups = useMemo(() => groupNeeds(needRows), [needRows]);
  const blocked = needRows.filter((n) => !n.orderable);

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => (!status || r.status === status) && (!s || `${r.poNumber} ${r.supplierName ?? ""}`.toLowerCase().includes(s)));
  }, [rows, search, status]);

  const refresh = () => {
    void orders.refetch();
    void needs.refetch();
  };
  const hasPrice = rows.some((r) => r.total !== undefined);

  const columns: Column<PoRow>[] = [
    { key: "no", header: t("po.col.number"), cell: (r) => r.poNumber, mobile: "title" },
    { key: "sup", header: t("po.col.supplier"), cell: (r) => r.supplierName ?? "—" },
    { key: "st", header: t("po.col.status"), cell: (r) => <StatusPill tone={poStatusTone(r.status)}>{poStatusLabel(r.status)}</StatusPill> },
    { key: "date", header: t("po.col.date"), cell: (r) => formatDate(r.createdAt), mobile: "hide" },
    {
      key: "exp",
      header: t("po.col.expected"),
      cell: (r) => {
        const late = lateDays(r);
        return (
          <span>
            {r.expectedDate ? formatDate(r.expectedDate) : "—"}
            {late > 0 ? <StatusPill tone="danger">{t("po.late", { n: late })}</StatusPill> : null}
          </span>
        );
      },
      mobile: "hide",
    },
    { key: "prog", header: t("po.col.progress"), cell: (r) => t("po.progress", { r: formatNumber(Number(r.receivedQty)), o: formatNumber(Number(r.orderedQty)) }), numeric: true, mobile: "hide" },
  ];
  if (hasPrice) columns.push({ key: "total", header: t("po.col.total"), cell: (r) => (r.total === undefined ? "—" : formatMoney(Number(r.total))), numeric: true });

  const ordersPanel = (
    <>
      <div class="po-stats">
        <Stat label={t("po.stat.pending")} value={formatNumber(counts.pending)} tone={counts.pending ? "warn" : "neutral"} />
        <Stat label={t("po.stat.open")} value={formatNumber(counts.open)} />
        <Stat label={t("po.stat.late")} value={formatNumber(counts.late)} tone={counts.late ? "danger" : "neutral"} />
        {counts.openValue !== null ? <Stat label={t("po.stat.value")} value={formatMoney(counts.openValue)} /> : null}
      </div>
      <FilterBar search={search} onSearch={setSearch} searchLabel={t("po.search")} activeCount={status ? 1 : 0} onClear={() => setStatus("")}>
        <Select
          aria-label={t("po.col.status")}
          value={status}
          options={[{ value: "", label: t("po.status.all") }, ...PO_STATUSES.map((s) => ({ value: s, label: t(`po.status.${s}` as CopyKey) }))]}
          onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}
        />
      </FilterBar>
      {orders.error ? <InlineAlert tone="danger" title={t("po.err")} action={<Button size="sm" variant="secondary" onClick={() => void orders.refetch()}>{t("po.retry")}</Button>}>{orders.error.message}</InlineAlert> : null}
      <DataTable columns={columns} rows={shown} rowKey={(r) => r.id} caption={t("po.caption")} loading={orders.loading} onRowClick={(r) => setOpenId(r.id)} empty={<EmptyState title={t("po.empty.title")} description={t("po.empty.body")} compact />} />
    </>
  );

  const needsPanel = (
    <>
      {needs.error ? <InlineAlert tone="danger" title={t("po.needs.err")} action={<Button size="sm" variant="secondary" onClick={() => void needs.refetch()}>{t("po.retry")}</Button>}>{needs.error.message}</InlineAlert> : null}
      {!needs.loading && !needs.error && needRows.length === 0 ? <EmptyState title={t("po.needs.empty.title")} description={t("po.needs.empty.body")} compact /> : null}
      {blocked.length ? <InlineAlert tone="warn">{blocked.map((b) => `${b.name}: ${t("po.needs.nolink")}`).join(" | ")}</InlineAlert> : null}
      <div class="po-groups">
        {groups.map((g) => (
          <section key={g.key} class="po-group">
            <header class="po-group__head">
              <h3>{g.supplierName ? t("po.needs.group.supplier", { name: g.supplierName }) : t("po.needs.group.none")}</h3>
              <Button icon={Plus} onClick={() => setEditor({ initial: { supplierId: g.supplierId ? String(g.supplierId) : "", lines: draftFromNeeds(g.rows) } })}>{t("po.needs.make")}</Button>
            </header>
            <ul class="po-needs">
              {g.rows.map((n) => (
                <li key={`${n.source}-${n.id}`}>
                  <strong>{n.name}</strong>
                  <span class="po-num">{formatNumber(Number(n.qty))} {n.unit ?? ""}</span>
                  <StatusPill tone={n.source === "ops" ? "brand" : "info"}>{t(n.source === "ops" ? "po.needs.src.ops" : "po.needs.src.plan")}</StatusPill>
                  {n.reason ? <span class="po-muted">{n.reason}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );

  return (
    <div class="ad-page">
      <h1 class="ad-title">{t("po.title")}</h1>
      <p class="st-login__sub">{t("po.subtitle")}</p>
      {buyer ? (
        <>
          <div class="po-bar">
            <Button icon={Plus} onClick={() => setEditor({})}>{t("po.new")}</Button>
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "needs", label: t("po.tab.needs"), badge: groups.reduce((s, g) => s + g.rows.length, 0) || undefined, panel: needsPanel },
              { id: "orders", label: t("po.tab.orders"), panel: ordersPanel },
            ]}
          />
        </>
      ) : (
        ordersPanel
      )}
      {openId !== null ? (
        <PurchaseDetail
          id={openId}
          role={role}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
          onEdit={(o) => {
            setOpenId(null);
            setEditor({ order: o });
          }}
        />
      ) : null}
      {editor ? (
        <PurchaseEditor
          order={editor.order}
          initial={editor.initial}
          onClose={() => setEditor(null)}
          onSaved={(o) => {
            setEditor(null);
            refresh();
            setTab("orders");
            setOpenId(o.id);
          }}
        />
      ) : null}
    </div>
  );
}
