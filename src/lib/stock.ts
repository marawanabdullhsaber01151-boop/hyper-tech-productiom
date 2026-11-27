/** @format */

import { and, eq, sql } from "drizzle-orm";
import { inventoryItemsTable, stockBalancesTable, stockMovementsTable, warehousesTable } from "../db/schema";
import { db } from "../db";
import { parseFiniteAmount } from "./validate";
import { defaultKindOf, fromMilli, kindAllowed, planOut, planRelease, planReserve, toMilli, totalsOf, type BalanceRow, type Share } from "./warehouseCore";

// ✅ نوع صحيح للـ Transaction بدلاً من any
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface StockMovementInput {
  inventoryItemId: number;
  movementType: "in" | "out";
  qty: string | number;
  referenceType?: string | null;
  referenceId?: number | null;
  unitPrice?: string | null;
  notes?: string | null;
  /** المخزن. لو فاضي: الافتراضي لفئة الصنف (وفي الصرف: الافتراضي أولًا ثم باقي المخازن). */
  warehouseId?: number | null;
}

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

export async function defaultWarehouseId(tx: Transaction, category: string): Promise<number> {
  const [w] = await tx.select({ id: warehousesTable.id }).from(warehousesTable)
    .where(and(eq(warehousesTable.isDefault, true), eq(warehousesTable.kind, defaultKindOf(category)))).limit(1);
  if (!w) throw fail("مفيش مخزن افتراضي لنوع الصنف ده. راجع إعدادات المخازن", 409);
  return w.id;
}

/** مخزن صريح: لازم يكون موجود ونشط ونوعه يناسب فئة الصنف. */
async function checkWarehouse(tx: Transaction, warehouseId: number, category: string, itemName: string, forIncrease: boolean) {
  const [w] = await tx.select().from(warehousesTable).where(eq(warehousesTable.id, warehouseId)).limit(1);
  if (!w) throw fail("المخزن غير موجود", 404);
  if (forIncrease && !w.active) throw fail(`المخزن "${w.name}" موقوف ومينفعش يستقبل رصيد`, 409);
  if (!kindAllowed(category, w.kind)) throw fail(`الصنف "${itemName}" مينفعش يتخزن في "${w.name}" لأن نوع المخزن مايناسبش الصنف`, 409);
  return w;
}

async function loadRows(tx: Transaction, itemId: number): Promise<BalanceRow[]> {
  const rows = await tx.select({
    warehouseId: stockBalancesTable.warehouseId, qty: stockBalancesTable.qty, reserved: stockBalancesTable.reservedQty, isDefault: warehousesTable.isDefault,
  }).from(stockBalancesTable).innerJoin(warehousesTable, eq(warehousesTable.id, stockBalancesTable.warehouseId))
    .where(eq(stockBalancesTable.itemId, itemId));
  return rows.map((r) => ({ warehouseId: r.warehouseId, qty: toMilli(r.qty), reserved: toMilli(r.reserved), isDefault: r.isDefault }));
}

/** يزوّد/ينقّص حقل في رصيد (صنف × مخزن). الصف بيتعمل لو مش موجود. إجمالي الصنف بيتحدّث بتريجر القاعدة. */
export async function bumpBalance(
  tx: Transaction,
  itemId: number,
  warehouseId: number,
  deltaMilli: number,
  field: "qty" | "reservedQty" = "qty",
) {
  await tx.insert(stockBalancesTable).values({ itemId, warehouseId }).onConflictDoNothing();
  const d = fromMilli(deltaMilli);
  await tx.update(stockBalancesTable)
    .set(field === "qty"
      ? { qty: sql`${stockBalancesTable.qty} + ${d}`, updatedAt: new Date() }
      : { reservedQty: sql`${stockBalancesTable.reservedQty} + ${d}`, updatedAt: new Date() })
    .where(and(eq(stockBalancesTable.itemId, itemId), eq(stockBalancesTable.warehouseId, warehouseId)));
}

async function lockItem(tx: Transaction, inventoryItemId: number) {
  const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, inventoryItemId)).for("update");
  return item;
}

/**
 * يطبّق حركة مخزون واحدة (تحديث رصيد المخزن + تسجيل الحركة) داخل transaction.
 * لازم يتنده جوه db.transaction(async (tx) => { ... }) وتتبعت tx ليه.
 * بيرفض العملية لو الصنف غير موجود، أو لو هتخلي الكمية بالسالب.
 * الصرف من غير مخزن صريح بيتم من مخزن واحد يغطي الكمية (الافتراضي أولًا)، ولو مفيش بيتوزع وكل جزء حركة.
 * بيرجّع أول حركة.
 */
export async function applyStockMovement(
  tx: Transaction,
  data: StockMovementInput,
) {
  const item = await lockItem(tx, data.inventoryItemId);
  if (!item) {
    throw fail(`الصنف رقم ${data.inventoryItemId} غير موجود في المخزون`, 404);
  }

  // ✅ إصلاح حرج: نفس مشكلة الأرصدة بالظبط — Number(data.qty) الفاسدة كانت
  // بترجع NaN، وNaN < 0 دايمًا false، يعني فحص "الكمية غير كافية" كان بيتخطى
  // تلقائيًا، والكمية المسجلة في المخزون كانت بتتحول فعليًا لنص "NaN".
  const qtyNum = parseFiniteAmount(data.qty, "الكمية", { min: 0, allowZero: false });
  const amount = toMilli(qtyNum);
  if (amount <= 0) throw fail("الكمية أصغر من أقل وحدة مسموحة (0.001)", 400);

  let shares: Share[];
  if (data.movementType === "in") {
    const wid = data.warehouseId ?? await defaultWarehouseId(tx, item.category);
    if (data.warehouseId) await checkWarehouse(tx, wid, item.category, item.name, true);
    shares = [{ warehouseId: wid, amount }];
  } else {
    let rows = await loadRows(tx, item.id);
    if (data.warehouseId) {
      await checkWarehouse(tx, data.warehouseId, item.category, item.name, false);
      rows = rows.filter((r) => r.warehouseId === data.warehouseId);
    }
    const plan = planOut(rows, amount);
    if (!plan.ok) {
      const have = totalsOf(rows).qty;
      throw fail(`الكمية غير كافية لصنف "${item.name}" — المتاح حالياً ${Number(fromMilli(have))} فقط، والمطلوب ${qtyNum}`, 400);
    }
    shares = plan.shares;
  }

  let first: typeof stockMovementsTable.$inferSelect | undefined;
  for (const sh of shares) {
    await bumpBalance(tx, item.id, sh.warehouseId, data.movementType === "in" ? sh.amount : -sh.amount);
    const [movement] = await tx
      .insert(stockMovementsTable)
      .values({
        inventoryItemId: data.inventoryItemId,
        warehouseId: sh.warehouseId,
        movementType: data.movementType,
        qty: fromMilli(sh.amount),
        referenceType: data.referenceType ?? null,
        referenceId: data.referenceId ?? null,
        unitPrice: data.unitPrice ?? null,
        notes: data.notes ?? null,
      })
      .returning();
    if (!first) first = movement;
  }
  return first!;
}

/**
 * Reserve sellable stock without changing the physical quantity. The row lock
 * makes two simultaneous confirmations compete for the same available units.
 */
export async function reserveStock(
  tx: Transaction,
  inventoryItemId: number,
  qty: string | number,
  warehouseId?: number | null,
) {
  const item = await lockItem(tx, inventoryItemId);
  if (!item) throw fail("الصنف غير موجود في المخزون", 404);
  const amount = parseFiniteAmount(qty, "الكمية", { min: 0, allowZero: false });
  let rows = await loadRows(tx, item.id);
  if (warehouseId) {
    await checkWarehouse(tx, warehouseId, item.category, item.name, false);
    rows = rows.filter((r) => r.warehouseId === warehouseId);
  }
  const plan = planReserve(rows, toMilli(amount));
  if (!plan.ok) {
    const t = totalsOf(rows);
    throw fail(`الكمية المتاحة للبيع غير كافية — المتاح ${Number(fromMilli(t.qty - t.reserved))} والمطلوب ${amount}`, 400);
  }
  for (const sh of plan.shares) await bumpBalance(tx, item.id, sh.warehouseId, sh.amount, "reservedQty");
  const [updated] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, inventoryItemId));
  return updated;
}

export async function releaseStockReservation(
  tx: Transaction,
  inventoryItemId: number,
  qty: string | number,
  warehouseId?: number | null,
) {
  const amount = parseFiniteAmount(qty, "الكمية", { min: 0, allowZero: false });
  const item = await lockItem(tx, inventoryItemId);
  if (!item) throw fail("الصنف غير موجود في المخزون", 404);
  let rows = await loadRows(tx, item.id);
  if (warehouseId) rows = rows.filter((r) => r.warehouseId === warehouseId);
  const plan = planRelease(rows, toMilli(amount));
  if (!plan.ok) throw fail("لا يمكن تحرير حجز أكبر من الكمية المحجوزة", 409);
  for (const sh of plan.shares) await bumpBalance(tx, item.id, sh.warehouseId, -sh.amount, "reservedQty");
  const [updated] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, inventoryItemId));
  return updated;
}

/** رصيد الصنف الحالي في مخزن معيّن (0 لو مفيش). */
export async function balanceIn(tx: Transaction, itemId: number, warehouseId: number): Promise<number> {
  const [b] = await tx.select({ qty: stockBalancesTable.qty }).from(stockBalancesTable)
    .where(and(eq(stockBalancesTable.itemId, itemId), eq(stockBalancesTable.warehouseId, warehouseId))).limit(1);
  return b ? Number(b.qty) : 0;
}
