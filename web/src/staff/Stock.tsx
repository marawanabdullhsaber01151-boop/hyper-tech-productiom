import { useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { staffUser } from "../admin/session";
import { Button, DataTable, EmptyState, FilterBar, InlineAlert, Select, Stat, StatusPill, Tabs, type Column } from "../design/components";
import { Plus } from "../design/icons";
import { formatNumber } from "../lib/format";
import { CountDialog, ItemDrawer, ItemEditor, MovementDialog } from "./StockDialogs";
import { StockMoves } from "./StockMoves";
import { canManageStock, stockValue, totalValue, type StockItem } from "./stockCore";
import "./Stock.css";

/** الأدوار اللي بتشوف الصفحة (نفس أدوار قايمة /nav للمشتريات + رئيس المجلس). */
export const STOCK_ROLES = ["chairman", "purchasing_manager", "buyer", "warehouse_manager", "storekeeper"] as const;

export interface StockRow {
  id: number;
  code: string | null;
  name: string;
  category: string;
  unit: string | null;
  qty: string;
  availableQty: string;
  minQty: string;
  reservedQty?: string;
  unitPrice?: string;
  foundationItemId?: number | null;
}
export type StockState = "out" | "low" | "ok";

/** نفد: الكمية صفر أو أقل. منخفض: وصلت للحد الأدنى (لو الحد الأدنى متحدد). */
export function stockState(r: Pick<StockRow, "qty" | "minQty">): StockState {
  const q = Number(r.qty);
  const m = Number(r.minQty);
  if (!(q > 0)) return "out";
  if (m > 0 && q <= m) return "low";
  return "ok";
}

const TONE = { out: "danger", low: "warn", ok: "success" } as const;
const CATEGORIES = ["raw_material", "wip", "finished_good"] as const;
const num = (v: string) => formatNumber(Number(v) || 0);

type Dialogs = { kind: "in" | "out" | "count" | "edit"; item: StockItem } | { kind: "new" } | null;

/** المخزون: المشتريات بتشوف فقط (السيرفر بيخفي السعر). أمين المخزن ومديره والرئيس بيديروا الأصناف والحركات. */
export function Stock() {
  const manage = canManageStock(staffUser()?.role);
  const params = new URLSearchParams(location.search);
  const [tab, setTab] = useState(() => (manage && params.get("tab") === "movements" ? "moves" : "items"));
  const [openId, setOpenId] = useState<number | null>(null);
  const [dlg, setDlg] = useState<Dialogs>(null);
  const list = useQuery((signal) => api.get<StockItem[]>("/inventory", { signal }), []);
  // لوحة الأوامر (Ctrl+K) بتفتح الصفحة على البحث باسم الصنف: ?q=
  const [search, setSearch] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [cat, setCat] = useState("");
  const [status, setStatus] = useState("");

  const rows = list.data ?? [];
  const counts = useMemo(() => {
    let low = 0;
    let out = 0;
    for (const r of rows) {
      const s = stockState(r);
      if (s === "low") low += 1;
      else if (s === "out") out += 1;
    }
    return { low, out };
  }, [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.name} ${r.code ?? ""}`.toLowerCase().includes(q)) return false;
      if (cat && r.category !== cat) return false;
      if (status && stockState(r) !== status) return false;
      return true;
    });
  }, [rows, search, cat, status]);

  const value = manage ? totalValue(rows) : null;
  const opened = openId === null ? undefined : rows.find((r) => r.id === openId);
  const changed = () => {
    setDlg(null);
    void list.refetch();
  };
  const catLabel = (c: string) => (CATEGORIES.includes(c as (typeof CATEGORIES)[number]) ? t(`staff.stock.cat.${c}` as CopyKey) : c);
  const columns: Column<StockRow>[] = [
    { key: "code", header: t("staff.stock.col.code"), cell: (r) => r.code ?? "—", mobile: "hide" },
    { key: "name", header: t("staff.stock.col.name"), cell: (r) => r.name, mobile: "title" },
    { key: "cat", header: t("staff.stock.col.cat"), cell: (r) => catLabel(r.category), mobile: "hide" },
    { key: "unit", header: t("staff.stock.col.unit"), cell: (r) => r.unit ?? "—" },
    { key: "qty", header: t("staff.stock.col.qty"), cell: (r) => num(r.qty), numeric: true },
    { key: "avail", header: t("staff.stock.col.avail"), cell: (r) => num(r.availableQty), numeric: true },
    { key: "min", header: t("staff.stock.col.min"), cell: (r) => num(r.minQty), numeric: true, mobile: "hide" },
    {
      key: "status",
      header: t("staff.stock.col.status"),
      cell: (r) => {
        const s = stockState(r);
        return <StatusPill tone={TONE[s]}>{t(`staff.stock.status.${s}` as CopyKey)}</StatusPill>;
      },
    },
  ];
  if (manage) {
    columns.splice(6, 0, { key: "price", header: t("inv.col.price"), cell: (r) => (r.unitPrice === undefined ? "—" : num(r.unitPrice)), numeric: true, mobile: "hide" });
    columns.splice(7, 0, { key: "value", header: t("inv.col.value"), cell: (r) => { const v = stockValue(r); return v === null ? "—" : formatNumber(v); }, numeric: true, mobile: "hide" });
  }

  const activeCount = (cat ? 1 : 0) + (status ? 1 : 0);
  const itemsPanel = (
    <>
      <div class="st-stats">
        <Stat label={t("staff.stock.stat.items")} value={formatNumber(rows.length)} />
        <Stat label={t("staff.stock.stat.low")} value={formatNumber(counts.low)} tone={counts.low ? "warn" : "neutral"} />
        <Stat label={t("staff.stock.stat.out")} value={formatNumber(counts.out)} tone={counts.out ? "danger" : "neutral"} />
        {value !== null ? <Stat label={t("inv.stat.value")} value={formatNumber(value)} hint={t("inv.stat.value.hint")} /> : null}
      </div>

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchLabel={t("staff.stock.search")}
        activeCount={activeCount}
        onClear={() => {
          setCat("");
          setStatus("");
        }}
      >
        <Select
          aria-label={t("staff.stock.f.cat")}
          value={cat}
          options={[{ value: "", label: t("staff.stock.cat.all") }, ...CATEGORIES.map((c) => ({ value: c, label: t(`staff.stock.cat.${c}` as CopyKey) }))]}
          onChange={(e) => setCat((e.currentTarget as HTMLSelectElement).value)}
        />
        <Select
          aria-label={t("staff.stock.f.status")}
          value={status}
          options={[
            { value: "", label: t("staff.stock.status.all") },
            { value: "low", label: t("staff.stock.status.low") },
            { value: "out", label: t("staff.stock.status.out") },
            { value: "ok", label: t("staff.stock.status.ok") },
          ]}
          onChange={(e) => setStatus((e.currentTarget as HTMLSelectElement).value)}
        />
      </FilterBar>

      {list.error ? (
        <InlineAlert tone="danger" title={t("staff.stock.err")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("staff.stock.retry")}</Button>}>
          {list.error.message}
        </InlineAlert>
      ) : null}

      <DataTable
        columns={columns}
        rows={shown}
        rowKey={(r) => r.id}
        caption={t("staff.stock.caption")}
        loading={list.loading}
        onRowClick={manage ? (r) => setOpenId(r.id) : undefined}
        empty={<EmptyState title={t("staff.stock.empty.title")} description={t("staff.stock.empty.body")} compact />}
      />
    </>
  );

  return (
    <div class="ad-page">
      <h1 class="ad-title">{t("staff.stock.title")}</h1>
      <p class="st-login__sub">{t("staff.stock.subtitle")}</p>
      {manage ? (
        <>
          <div class="inv-bar">
            <Button icon={Plus} onClick={() => setDlg({ kind: "new" })}>{t("inv.new")}</Button>
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "items", label: t("inv.tab.items"), panel: itemsPanel },
              { id: "moves", label: t("inv.tab.moves"), panel: <StockMoves items={rows} itemId={params.get("item") ?? undefined} onChanged={() => void list.refetch()} /> },
            ]}
          />
        </>
      ) : (
        itemsPanel
      )}
      {manage && opened ? (
        <ItemDrawer
          item={opened}
          canDelete
          onClose={() => setOpenId(null)}
          onIn={() => setDlg({ kind: "in", item: opened })}
          onOut={() => setDlg({ kind: "out", item: opened })}
          onCount={() => setDlg({ kind: "count", item: opened })}
          onEdit={() => setDlg({ kind: "edit", item: opened })}
          onDeleted={() => {
            setOpenId(null);
            changed();
          }}
        />
      ) : null}
      {dlg && dlg.kind === "new" ? <ItemEditor onClose={() => setDlg(null)} onSaved={changed} /> : null}
      {dlg && dlg.kind === "edit" ? <ItemEditor item={dlg.item} onClose={() => setDlg(null)} onSaved={changed} /> : null}
      {dlg && (dlg.kind === "in" || dlg.kind === "out") ? <MovementDialog item={dlg.item} type={dlg.kind} onClose={() => setDlg(null)} onDone={changed} /> : null}
      {dlg && dlg.kind === "count" ? <CountDialog item={dlg.item} onClose={() => setDlg(null)} onDone={changed} /> : null}
    </div>
  );
}
