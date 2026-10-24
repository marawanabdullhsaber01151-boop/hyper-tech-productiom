import { useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { useAct } from "../admin/act";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, ConfirmDialog, DataTable, EmptyState, FilterBar, IconButton, InlineAlert, Input, Select, Stat, StatusPill, useToast, type Column } from "../design/components";
import { Download, Trash } from "../design/icons";
import { formatDateTime, formatNumber } from "../lib/format";
import { buildCsv } from "./salesCore";
import { buildMovementRows, inDateRange, movementTotals, type Movement, type MoveRow, type StockItem } from "./stockCore";

const fmt = (n: number | string) => formatNumber(Number(n) || 0);
const REFS = ["purchase", "sale", "production", "adjustment"] as const;
const refLabel = (r: string | null) => (r && (REFS as readonly string[]).includes(r) ? t(`inv.mv.ref.${r}` as CopyKey) : r ?? "");

/** تبويب الحركات: كل حركات المخزون مع الرصيد قبل وبعد، فلاتر، إجماليات، تصدير، ومسح حركة. */
export function StockMoves({ items, itemId, onChanged }: { items: StockItem[]; itemId?: string; onChanged: () => void }) {
  const q = useQuery((signal) => api.get<Movement[]>("/stock-movements", { signal }), []);
  const act = useAct();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [item, setItem] = useState(itemId ?? "");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [del, setDel] = useState<MoveRow | null>(null);

  const nameOf = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const rows = useMemo(() => buildMovementRows(items, q.data ?? []), [items, q.data]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (item && String(r.inventoryItemId) !== item) return false;
      if (type && r.movementType !== type) return false;
      if (!inDateRange(r.createdAt, from, to)) return false;
      if (s && !`${nameOf.get(r.inventoryItemId)?.name ?? ""} ${r.notes ?? ""}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [rows, search, item, type, from, to, nameOf]);
  const totals = useMemo(() => movementTotals(shown), [shown]);

  const columns: Column<MoveRow>[] = [
    { key: "date", header: t("inv.mv.col.date"), cell: (r) => formatDateTime(r.createdAt), mobile: "hide" },
    { key: "item", header: t("inv.mv.col.item"), cell: (r) => nameOf.get(r.inventoryItemId)?.name ?? `#${r.inventoryItemId}`, mobile: "title" },
    { key: "type", header: t("inv.mv.col.type"), cell: (r) => <StatusPill tone={r.movementType === "in" ? "success" : "warn"}>{t(r.movementType === "in" ? "inv.mv.type.in" : "inv.mv.type.out")}</StatusPill> },
    { key: "qty", header: t("inv.mv.col.qty"), cell: (r) => fmt(r.qty), numeric: true },
    { key: "before", header: t("inv.mv.col.before"), cell: (r) => fmt(r.balanceBefore), numeric: true, mobile: "hide" },
    { key: "after", header: t("inv.mv.col.after"), cell: (r) => fmt(r.balanceAfter), numeric: true },
    { key: "ref", header: t("inv.mv.col.ref"), cell: (r) => refLabel(r.referenceType), mobile: "hide" },
    { key: "notes", header: t("inv.mv.col.notes"), cell: (r) => r.notes ?? "", mobile: "hide" },
    { key: "del", header: "", cell: (r) => <IconButton icon={Trash} label={t("inv.mv.del.label")} onClick={() => setDel(r)} /> },
  ];

  const exportCsv = () => {
    if (!shown.length) {
      toast({ tone: "info", message: t("inv.mv.export.empty") });
      return;
    }
    const csv = buildCsv(
      columns.slice(0, 8).map((c) => c.header),
      shown.map((r) => [r.createdAt.slice(0, 19).replace("T", " "), nameOf.get(r.inventoryItemId)?.name ?? "", t(r.movementType === "in" ? "inv.mv.type.in" : "inv.mv.type.out"), r.qty, String(r.balanceBefore), String(r.balanceAfter), refLabel(r.referenceType), r.notes ?? ""]),
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `stock-movements-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast({ tone: "success", message: t("inv.mv.export.done") });
  };
  const doDelete = async () => {
    if (!del) return;
    const ok = await act.run(
      async () => {
        await api.delete<unknown>(`/stock-movements/${del.id}`);
        return true;
      },
      t("inv.mv.deleted"),
    );
    if (!ok) return;
    setDel(null);
    void q.refetch();
    onChanged();
  };

  const active = (item ? 1 : 0) + (type ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0);
  return (
    <div class="inv-moves">
      <div class="inv-stats">
        <Stat label={t("inv.mv.stat.count")} value={fmt(totals.count)} />
        <Stat label={t("inv.mv.stat.in")} value={fmt(totals.inQty)} tone="success" />
        <Stat label={t("inv.mv.stat.out")} value={fmt(totals.outQty)} tone={totals.outQty ? "warn" : "neutral"} />
      </div>
      <FilterBar
        search={search}
        onSearch={setSearch}
        searchLabel={t("inv.mv.search")}
        activeCount={active}
        onClear={() => {
          setItem("");
          setType("");
          setFrom("");
          setTo("");
        }}
      >
        <Select aria-label={t("inv.mv.f.item")} value={item} options={[{ value: "", label: t("inv.mv.f.item.all") }, ...items.map((i) => ({ value: String(i.id), label: i.name }))]} onChange={(e) => setItem((e.target as HTMLSelectElement).value)} />
        <Select aria-label={t("inv.mv.f.type")} value={type} options={[{ value: "", label: t("inv.mv.type.all") }, { value: "in", label: t("inv.mv.type.in") }, { value: "out", label: t("inv.mv.type.out") }]} onChange={(e) => setType((e.target as HTMLSelectElement).value)} />
        <Input type="date" aria-label={t("inv.mv.f.date")} value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />
        <Input type="date" aria-label={t("inv.mv.f.date")} value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
      </FilterBar>
      <div class="inv-bar">
        <Button variant="secondary" icon={Download} onClick={exportCsv}>{t("inv.mv.export")}</Button>
      </div>
      {q.error ? <InlineAlert tone="danger" title={t("inv.mv.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("staff.stock.retry")}</Button>} /> : null}
      <DataTable columns={columns} rows={shown} rowKey={(r) => r.id} caption={t("inv.mv.caption")} loading={q.loading} empty={<EmptyState title={t("inv.mv.empty.title")} description={t("inv.mv.empty.body")} compact />} />
      <ConfirmDialog open={!!del} danger loading={act.busy} onClose={() => setDel(null)} onConfirm={() => void doDelete()} title={t("inv.mv.del.title")} description={t("inv.mv.del.desc")} confirmLabel={t("inv.mv.del.label")} />
    </div>
  );
}
