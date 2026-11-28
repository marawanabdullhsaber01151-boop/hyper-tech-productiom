/** @format */
// المرحلة أ من المخازن: دوال نقية (من غير قاعدة بيانات) لقواعد النوع وتوزيع الحركة على المخازن.
// الكميات في القاعدة numeric(12,3) فبنشتغل بالألف (milli) كأعداد صحيحة علشان مفيش كسور عشرية عايمة.

export const WAREHOUSE_KINDS = ["raw", "wip", "finished"] as const;
export type WarehouseKind = (typeof WAREHOUSE_KINDS)[number];

export const ITEM_CATEGORIES = ["raw_material", "wip", "finished_good"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/** المخزن الافتراضي لكل فئة صنف. */
export const DEFAULT_KIND_OF: Record<ItemCategory, WarehouseKind> = {
  raw_material: "raw",
  wip: "wip",
  finished_good: "finished",
};

/** الخام يتخزن في خام أو تحت تشغيل، والتام في تحت تشغيل أو تام، ونص المصنّع تحت تشغيل بس. */
export const ALLOWED_KINDS: Record<ItemCategory, readonly WarehouseKind[]> = {
  raw_material: ["raw", "wip"],
  wip: ["wip"],
  finished_good: ["wip", "finished"],
};

export const isKind = (v: unknown): v is WarehouseKind => (WAREHOUSE_KINDS as readonly unknown[]).includes(v);
export const isCategory = (v: unknown): v is ItemCategory => (ITEM_CATEGORIES as readonly unknown[]).includes(v);

export function kindAllowed(category: string, kind: string): boolean {
  return isCategory(category) && (ALLOWED_KINDS[category] as readonly string[]).includes(kind);
}

export function defaultKindOf(category: string): WarehouseKind {
  return isCategory(category) ? DEFAULT_KIND_OF[category] : "raw";
}

export const toMilli = (v: string | number): number => Math.round(Number(v) * 1000);
export const fromMilli = (m: number): string => (m / 1000).toFixed(3);

export interface BalanceRow {
  warehouseId: number;
  qty: number; // milli
  reserved: number; // milli
  isDefault: boolean;
}

export interface Share {
  warehouseId: number;
  amount: number; // milli، دايمًا > 0
}

export type PlanResult = { ok: true; shares: Share[] } | { ok: false; short: number };

const ordered = (rows: BalanceRow[]) =>
  [...rows].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.warehouseId - b.warehouseId);

function spread(rows: BalanceRow[], amount: number, room: (r: BalanceRow) => number): PlanResult {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, short: amount };
  const list = ordered(rows).filter((r) => room(r) > 0);
  const single = list.find((r) => room(r) >= amount);
  if (single) return { ok: true, shares: [{ warehouseId: single.warehouseId, amount }] };
  const shares: Share[] = [];
  let left = amount;
  for (const r of list) {
    if (left <= 0) break;
    const take = Math.min(room(r), left);
    shares.push({ warehouseId: r.warehouseId, amount: take });
    left -= take;
  }
  return left > 0 ? { ok: false, short: left } : { ok: true, shares };
}

/** صرف: من مخزن واحد يغطي الكمية لو موجود (الافتراضي أولًا)، وإلا بيتوزع بالترتيب. */
export const planOut = (rows: BalanceRow[], amount: number): PlanResult => spread(rows, amount, (r) => r.qty);
/** حجز: على المتاح (الكمية - المحجوز). */
export const planReserve = (rows: BalanceRow[], amount: number): PlanResult => spread(rows, amount, (r) => r.qty - r.reserved);
/** فك حجز: من المخازن اللي فيها محجوز. */
export const planRelease = (rows: BalanceRow[], amount: number): PlanResult => spread(rows, amount, (r) => r.reserved);

/** مجموع الأرصدة = إجمالي الصنف (الثابت الرياضي اللي القاعدة بتحافظ عليه). */
export function totalsOf(rows: readonly BalanceRow[]): { qty: number; reserved: number } {
  return rows.reduce((a, r) => ({ qty: a.qty + r.qty, reserved: a.reserved + r.reserved }), { qty: 0, reserved: 0 });
}

/** المشتريات للخامات بس: المنتج التام من إنتاجنا، ونص المصنّع بيتصنّع. بيرجّع سبب الرفض أو null. */
export function purchasableProblem(category: string, itemName: string): string | null {
  return category === "raw_material" ? null : `الصنف "${itemName}" مش خامة، والمشتريات للخامات بس (المنتج التام من إنتاجنا ونص المصنّع بيتصنّع)`;
}
