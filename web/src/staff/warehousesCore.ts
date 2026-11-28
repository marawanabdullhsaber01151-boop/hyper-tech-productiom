import { buildCsv } from "./salesCore";

/** منطق شاشة المخازن النقي (من غير شاشة). */
export type WhKind = "raw" | "wip" | "finished";
export const WH_KINDS: readonly WhKind[] = ["raw", "wip", "finished"];
export const isWhKind = (v: unknown): v is WhKind => typeof v === "string" && (WH_KINDS as readonly string[]).includes(v);

export interface WhItem {
  id: number;
  code: string;
  name: string;
  kind: WhKind;
  isDefault: boolean;
  active: boolean;
  notes: string | null;
  itemsCount: number;
  keepers: Array<{ userId: number; name: string }>;
}
export interface WhStockRow {
  itemId: number;
  itemName: string;
  unit: string | null;
  minQty: string;
  qty: string;
  reserved: string;
  warehouseId?: number;
  warehouseName?: string;
  parts?: Array<{ warehouseId: number; warehouseName: string; qty: string; reserved: string }>;
}

/** ?kind=&wh=all|<id>&new=1 → حالة الصفحة. نوع غلط = null (الصفحة تعرض «مش متاح»). */
export function parsePageParams(search: string): { kind: WhKind | null; wh: "all" | number; wantNew: boolean } {
  const p = new URLSearchParams(search);
  const k = p.get("kind");
  const w = p.get("wh");
  const n = w && /^\d+$/.test(w) ? Number(w) : 0;
  return { kind: isWhKind(k) ? k : null, wh: n > 0 ? n : "all", wantNew: p.get("new") === "1" };
}

const num = (v: string) => Number(v) || 0;
export const availOf = (r: Pick<WhStockRow, "qty" | "reserved">): number => Math.round((num(r.qty) - num(r.reserved)) * 1000) / 1000;

export type WhState = "out" | "low" | "ok";
export function whState(r: Pick<WhStockRow, "qty" | "minQty">): WhState {
  const q = num(r.qty);
  const m = num(r.minQty);
  if (!(q > 0)) return "out";
  if (m > 0 && q <= m) return "low";
  return "ok";
}

export function stockCounts(rows: readonly WhStockRow[]): { items: number; low: number; out: number } {
  const ids = new Set<number>();
  let low = 0;
  let out = 0;
  for (const r of rows) {
    const s = whState(r);
    if (s === "low") low += 1;
    else if (s === "out") out += 1;
    ids.add(r.itemId);
  }
  return { items: ids.size, low, out };
}

export function filterStock<T extends { itemName: string; warehouseName?: string }>(rows: readonly T[], search: string): T[] {
  const q = search.trim().toLowerCase();
  return q ? rows.filter((r) => `${r.itemName} ${r.warehouseName ?? ""}`.toLowerCase().includes(q)) : [...rows];
}

export function partsText(r: WhStockRow, fmt: (n: number) => string): string {
  return (r.parts ?? []).map((p) => `${p.warehouseName}: ${fmt(num(p.qty))}`).join(" • ");
}

export function stockCsv(header: string[], rows: readonly WhStockRow[], mode: "separate" | "combined"): string {
  return buildCsv(
    header,
    rows.map((r) =>
      mode === "combined"
        ? [r.itemName, r.unit ?? "", partsText(r, String), r.qty, r.reserved, String(availOf(r))]
        : [r.itemName, r.unit ?? "", r.warehouseName ?? "", r.qty, r.reserved, String(availOf(r))],
    ),
  );
}

/** اختيارات المخزن في الاستلام/الحركة: المخازن النشطة من النوع المطلوب. اختيار فاضي = الافتراضي. */
export function pickOptions(items: readonly WhItem[], kind: WhKind): WhItem[] {
  return items.filter((w) => w.kind === kind && w.active);
}
export const needsPicker = (opts: readonly WhItem[]): boolean => opts.length > 1;

/** أنواع المخازن المسموحة لتصنيف الصنف (نفس قاعدة السيرفر wh_kind_ok). */
export const KINDS_OF_CATEGORY: Record<string, readonly WhKind[]> = {
  raw_material: ["raw", "wip"],
  wip: ["wip"],
  finished_good: ["wip", "finished"],
};
export const kindsOfCategory = (category: string): readonly WhKind[] => KINDS_OF_CATEGORY[category] ?? ["raw"];
export const pickForCategory = (items: readonly WhItem[], category: string): WhItem[] => items.filter((w) => w.active && kindsOfCategory(category).includes(w.kind));
