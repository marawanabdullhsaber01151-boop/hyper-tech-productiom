/** @format */
// المخازن - المرحلة ب: مين يشوف أنهي نوع مخازن، ومين يدير، وتجميع الأرصدة (مجمّع/منفصل). دوال نقية.
import { fromMilli, toMilli, type WarehouseKind } from "./warehouseCore";

export const WAREHOUSE_MANAGE_ROLES = ["chairman", "executive_manager", "warehouse_manager"] as const;

const TOP = ["chairman", "executive_manager", "warehouse_manager", "storekeeper", "operations_manager"] as const;

/** مين يقدر يشوف كل نوع. نفس مبدأ فلترة المخزون الحالي: المشتريات خام، الإنتاج خام وتحت تشغيل، المبيعات تام. */
export const KIND_VIEW_ROLES: Record<WarehouseKind, readonly string[]> = {
  raw: [...TOP, "production_manager", "production_controller", "purchasing_manager", "buyer", "raw_material_quality_controller"],
  wip: [...TOP, "production_manager", "production_controller"],
  finished: [...TOP, "sales_manager", "online_seller", "offline_seller"],
};

export const WAREHOUSE_VIEW_ROLES: readonly string[] = [...new Set(Object.values(KIND_VIEW_ROLES).flat())];

export const kindsFor = (role: string): WarehouseKind[] =>
  (Object.keys(KIND_VIEW_ROLES) as WarehouseKind[]).filter((k) => KIND_VIEW_ROLES[k].includes(role));

export const canManageWarehouses = (role: string): boolean => (WAREHOUSE_MANAGE_ROLES as readonly string[]).includes(role);

/**
 * نطاق المخازن: أمين المخزن اللي اتعيّن على مخزن أو أكتر بيشتغل في دول بس.
 * أمين من غير أي تعيين بيشوف الكل (علشان الأمناء الحاليين مايتقفلوش لحد ما الإدارة تعيّنهم). باقي الأدوار الكل.
 */
export function scopeFor(role: string, assigned: readonly number[]): "all" | number[] {
  if (role === "storekeeper" && assigned.length > 0) return [...assigned];
  return "all";
}

export const inScope = (scope: "all" | number[], warehouseId: number): boolean => scope === "all" || scope.includes(warehouseId);

export const KIND_CODE_PREFIX: Record<WarehouseKind, string> = { raw: "WH-RAW", wip: "WH-WIP", finished: "WH-FG" };
export const codeFor = (kind: WarehouseKind, id: number): string => `${KIND_CODE_PREFIX[kind]}-${id}`;

export function normalizeName(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}
export const nameProblem = (v: string): string | null => {
  const n = normalizeName(v);
  if (n.length < 1) return "اكتب اسم المخزن";
  if (n.length > 60) return "اسم المخزن أطول من 60 حرف";
  return null;
};

export interface StockRow {
  itemId: number;
  itemName: string;
  unit: string | null;
  category: string;
  minQty: string;
  warehouseId: number;
  warehouseName: string;
  qty: string;
  reserved: string;
  quarantine: string;
}
export interface CombinedRow {
  itemId: number;
  itemName: string;
  unit: string | null;
  category: string;
  minQty: string;
  qty: string;
  reserved: string;
  quarantine: string;
  parts: Array<{ warehouseId: number; warehouseName: string; qty: string; reserved: string }>;
}

/** تقرير مجمّع: صف لكل صنف بمجموع مخازنه (والأجزاء جواه). مجموع المجمّع = مجموع المنفصل دايمًا. */
export function combineStock(rows: readonly StockRow[]): CombinedRow[] {
  const by = new Map<number, { row: CombinedRow; q: number; r: number; k: number }>();
  for (const r of rows) {
    let e = by.get(r.itemId);
    if (!e) {
      e = { row: { itemId: r.itemId, itemName: r.itemName, unit: r.unit, category: r.category, minQty: r.minQty, qty: "0", reserved: "0", quarantine: "0", parts: [] }, q: 0, r: 0, k: 0 };
      by.set(r.itemId, e);
    }
    e.q += toMilli(r.qty);
    e.r += toMilli(r.reserved);
    e.k += toMilli(r.quarantine);
    e.row.parts.push({ warehouseId: r.warehouseId, warehouseName: r.warehouseName, qty: r.qty, reserved: r.reserved });
  }
  return [...by.values()]
    .map(({ row, q, r, k }) => ({ ...row, qty: fromMilli(q), reserved: fromMilli(r), quarantine: fromMilli(k), parts: [...row.parts].sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, "ar")) }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName, "ar"));
}
