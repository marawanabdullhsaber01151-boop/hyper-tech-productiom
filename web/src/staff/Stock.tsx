import { useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, EmptyState, FilterBar, InlineAlert, Select, Stat, StatusPill, type Column } from "../design/components";
import { formatNumber } from "../lib/format";

/** الأدوار اللي بتشوف الصفحة (نفس أدوار قايمة /nav للمشتريات + رئيس المجلس). */
export const STOCK_ROLES = ["chairman", "purchasing_manager", "buyer"] as const;

export interface StockRow {
  id: number;
  code: string | null;
  name: string;
  category: string;
  unit: string | null;
  qty: string;
  availableQty: string;
  minQty: string;
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

/** المخزون والمواد الخام — عرض فقط (للمشتريات). سعر الوحدة مش بيوصل لهنا أصلًا: السيرفر بيخفيه. */
export function Stock() {
  const list = useQuery((signal) => api.get<StockRow[]>("/inventory", { signal }), []);
  const [search, setSearch] = useState("");
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

  const activeCount = (cat ? 1 : 0) + (status ? 1 : 0);
  return (
    <div class="ad-page">
      <h1 class="ad-title">{t("staff.stock.title")}</h1>
      <p class="st-login__sub">{t("staff.stock.subtitle")}</p>

      <div class="st-stats">
        <Stat label={t("staff.stock.stat.items")} value={formatNumber(rows.length)} />
        <Stat label={t("staff.stock.stat.low")} value={formatNumber(counts.low)} tone={counts.low ? "warn" : "neutral"} />
        <Stat label={t("staff.stock.stat.out")} value={formatNumber(counts.out)} tone={counts.out ? "danger" : "neutral"} />
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
        empty={<EmptyState title={t("staff.stock.empty.title")} description={t("staff.stock.empty.body")} compact />}
      />
    </div>
  );
}
