/** @format */

import { eq, sql } from "drizzle-orm";
import { inventoryItemsTable, stockMovementsTable } from "../db/schema";
import { db } from "../db";
import { parseFiniteAmount } from "./validate";

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
}

/**
 * يطبّق حركة مخزون واحدة (تحديث الكمية + تسجيل الحركة) داخل transaction.
 * لازم يتنده جوه db.transaction(async (tx) => { ... }) وتتبعت tx ليه.
 * بيرفض العملية لو الصنف غير موجود، أو لو هتخلي الكمية بالسالب.
 */
export async function applyStockMovement(
  tx: Transaction,
  data: StockMovementInput,
) {
  const [item] = await tx
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, data.inventoryItemId))
    .for("update");

  if (!item) {
    throw Object.assign(
      new Error(`الصنف رقم ${data.inventoryItemId} غير موجود في المخزون`),
      { status: 404 },
    );
  }

  // ✅ إصلاح حرج: نفس مشكلة الأرصدة بالظبط — Number(data.qty) الفاسدة كانت
  // بترجع NaN، وNaN < 0 دايمًا false، يعني فحص "الكمية غير كافية" كان بيتخطى
  // تلقائيًا، والكمية المسجلة في المخزون كانت بتتحول فعليًا لنص "NaN".
  const currentQty = Number(item.qty);
  const qtyNum = parseFiniteAmount(data.qty, "الكمية", {
    min: 0,
    allowZero: false,
  });
  const delta = data.movementType === "in" ? qtyNum : -qtyNum;
  const newQty = currentQty + delta;

  if (newQty < 0) {
    throw Object.assign(
      new Error(
        `الكمية غير كافية لصنف "${item.name}" — المتاح حالياً ${currentQty} فقط، والمطلوب ${qtyNum}`,
      ),
      { status: 400 },
    );
  }

  await tx
    .update(inventoryItemsTable)
    .set({ qty: String(newQty), updatedAt: new Date() })
    .where(eq(inventoryItemsTable.id, data.inventoryItemId));

  const [movement] = await tx
    .insert(stockMovementsTable)
    .values({
      inventoryItemId: data.inventoryItemId,
      movementType: data.movementType,
      qty: String(qtyNum),
      referenceType: data.referenceType ?? null,
      referenceId: data.referenceId ?? null,
      unitPrice: data.unitPrice ?? null,
      notes: data.notes ?? null,
    })
    .returning();

  return movement;
}

/**
 * Reserve sellable stock without changing the physical quantity. The row lock
 * makes two simultaneous confirmations compete for the same available units.
 */
export async function reserveStock(
  tx: Transaction,
  inventoryItemId: number,
  qty: string | number,
) {
  const [item] = await tx.select().from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, inventoryItemId)).for("update");
  if (!item) throw Object.assign(new Error("الصنف غير موجود في المخزون"), { status: 404 });
  const amount = parseFiniteAmount(qty, "الكمية", { min: 0, allowZero: false });
  const available = Number(item.qty) - Number(item.reservedQty);
  if (available < amount) {
    throw Object.assign(new Error(`الكمية المتاحة للبيع غير كافية — المتاح ${available} والمطلوب ${amount}`), { status: 400 });
  }
  const [updated] = await tx.update(inventoryItemsTable)
    .set({ reservedQty: sql`${inventoryItemsTable.reservedQty} + ${String(amount)}`, updatedAt: new Date() })
    .where(eq(inventoryItemsTable.id, inventoryItemId)).returning();
  return updated;
}

export async function releaseStockReservation(
  tx: Transaction,
  inventoryItemId: number,
  qty: string | number,
) {
  const amount = parseFiniteAmount(qty, "الكمية", { min: 0, allowZero: false });
  const [item] = await tx.select().from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, inventoryItemId)).for("update");
  if (!item) throw Object.assign(new Error("الصنف غير موجود في المخزون"), { status: 404 });
  if (Number(item.reservedQty) < amount) {
    throw Object.assign(new Error("لا يمكن تحرير حجز أكبر من الكمية المحجوزة"), { status: 409 });
  }
  const [updated] = await tx.update(inventoryItemsTable)
    .set({ reservedQty: sql`${inventoryItemsTable.reservedQty} - ${String(amount)}`, updatedAt: new Date() })
    .where(eq(inventoryItemsTable.id, inventoryItemId)).returning();
  return updated;
}
