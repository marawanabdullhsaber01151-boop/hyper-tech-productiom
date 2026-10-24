import { normNum, validQty } from "./salesCore";

/** منطق المخزون والحركات النقي (من غير شاشة). */
export interface StockItem {
  id: number;
  code: string | null;
  name: string;
  category: string;
  unit: string | null;
  qty: string;
  reservedQty?: string;
  availableQty: string;
  minQty: string;
  /** السيرفر بيبعته لأدوار المخزن بس. */
  unitPrice?: string;
  foundationItemId?: number | null;
}
export interface Movement {
  id: number;
  inventoryItemId: number;
  movementType: string;
  qty: string;
  referenceType: string | null;
  referenceId: number | null;
  unitPrice: string | null;
  notes: string | null;
  createdAt: string;
}
export interface MoveRow extends Movement {
  balanceBefore: number;
  balanceAfter: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000 || 0; // || 0 بيحوّل -0 لصفر

/** رصيد الصنف قبل وبعد كل حركة: بنبدأ من الكمية الحالية ونرجع لورا (الأحدث أولًا في الناتج). */
export function buildMovementRows(items: Pick<StockItem, "id" | "qty">[], moves: Movement[]): MoveRow[] {
  const qtyOf = new Map(items.map((i) => [i.id, Number(i.qty)]));
  const byItem = new Map<number, Movement[]>();
  for (const m of moves) {
    const l = byItem.get(m.inventoryItemId) ?? [];
    l.push(m);
    byItem.set(m.inventoryItemId, l);
  }
  const out: MoveRow[] = [];
  for (const [id, list] of byItem) {
    // الأحدث الأول؛ الأعلى id أحدث لو الوقت متساوي
    const sorted = [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id);
    let after = qtyOf.get(id) ?? 0;
    for (const m of sorted) {
      const q = Number(m.qty) || 0;
      const before = m.movementType === "in" ? after - q : after + q;
      out.push({ ...m, balanceBefore: r3(before), balanceAfter: r3(after) });
      after = before;
    }
  }
  return out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id);
}

/** الجرد: الكمية الفعلية ← حركة الفرق (وارد لو زادت، منصرف لو نقصت). null لو مفيش فرق أو الرقم غلط. */
export function adjustmentFor(current: number, countedRaw: string): { type: "in" | "out"; qty: string; delta: number } | null {
  const c = normNum(countedRaw);
  if (c === "" || !/^\d+(?:\.\d{1,3})?$/.test(c)) return null;
  const delta = r3(Number(c) - current);
  if (delta === 0) return null;
  return { type: delta > 0 ? "in" : "out", qty: String(Math.abs(delta)), delta };
}

export type MoveError = "qty" | "insufficient" | "reason";
/** تحقق من حركة يدوية قبل الإرسال. */
export function moveError(type: "in" | "out", qtyRaw: string, current: number, reason: string): MoveError | null {
  const q = normNum(qtyRaw);
  if (!validQty(q)) return "qty";
  if (type === "out" && Number(q) > current) return "insufficient";
  if (!reason.trim()) return "reason";
  return null;
}

/** قيمة المخزون للصنف (الكمية × سعر الوحدة). null لو السعر مش واصل للدور ده. */
export function stockValue(i: Pick<StockItem, "qty" | "unitPrice">): number | null {
  if (i.unitPrice === undefined) return null;
  return r3(Number(i.qty) * Number(i.unitPrice));
}
export function totalValue(items: Array<Pick<StockItem, "qty" | "unitPrice">>): number | null {
  let any = false;
  let sum = 0;
  for (const i of items) {
    const v = stockValue(i);
    if (v !== null) {
      any = true;
      sum += v;
    }
  }
  return any ? r3(sum) : null;
}

export function movementTotals(rows: Array<Pick<Movement, "movementType" | "qty">>): { count: number; inQty: number; outQty: number } {
  let inQty = 0;
  let outQty = 0;
  for (const r of rows) (r.movementType === "in" ? (inQty += Number(r.qty) || 0) : (outQty += Number(r.qty) || 0));
  return { count: rows.length, inQty: r3(inQty), outQty: r3(outQty) };
}

/** الفلتر بتاريخ الحركة (YYYY-MM-DD بتوقيت القاهرة تقريبًا: بنقارن على أول 10 حروف من ISO). */
export function inDateRange(createdAt: string, from: string, to: string): boolean {
  const d = createdAt.slice(0, 10);
  return (!from || d >= from) && (!to || d <= to);
}

export const MANAGE_ROLES = ["chairman", "warehouse_manager", "storekeeper"] as const;
export const canManageStock = (role: string | undefined) => !!role && (MANAGE_ROLES as readonly string[]).includes(role);
