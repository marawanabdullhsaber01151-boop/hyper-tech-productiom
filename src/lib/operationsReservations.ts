import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import { inventoryItemsTable, operationsPlanReservationsTable, operationsPlansTable } from "../db/schema";
import { releaseStockReservation, reserveStock } from "./stock";
import { allocateConsumption, planReservationWants } from "./operationsCenterCore";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** تحرير باقي كل الحجوزات النشطة لخطة (اللي ماتصرفش منها)، وبيرجّع كام حجز اتحرر. */
export async function releasePlanReservations(tx: Tx, planId: number): Promise<number> {
  const rows = await tx.select().from(operationsPlanReservationsTable)
    .where(and(eq(operationsPlanReservationsTable.planId, planId), eq(operationsPlanReservationsTable.status, "active")));
  for (const r of rows) {
    const remaining = round3(Number(r.qty) - Number(r.consumedQty));
    if (remaining > 0) await releaseStockReservation(tx, r.inventoryItemId, remaining);
    await tx.update(operationsPlanReservationsTable)
      .set({ status: "released", releasedAt: new Date() })
      .where(eq(operationsPlanReservationsTable.id, r.id));
  }
  return rows.length;
}

/**
 * حجز الخامات المتاحة للخطة المعتمدة. بيحجز اللي متاح فعلًا لحظة الاعتماد (المتاح قد يكون قلّ من وقت التحليل)،
 * وأي خطة معتمدة قديمة لنفس أمر البيع بتتحرر حجوزاتها وتتعلّم superseded الأول.
 */
export async function reservePlanMaterials(tx: Tx, plan: { id: number; salesOrderId: number; snapshot: unknown }): Promise<{ reserved: number; items: number }> {
  const older = await tx.select({ id: operationsPlansTable.id }).from(operationsPlansTable)
    .where(and(eq(operationsPlansTable.salesOrderId, plan.salesOrderId), eq(operationsPlansTable.status, "approved"), ne(operationsPlansTable.id, plan.id)));
  for (const o of older) {
    await releasePlanReservations(tx, o.id);
    await tx.update(operationsPlansTable).set({ status: "superseded", updatedAt: new Date() }).where(eq(operationsPlansTable.id, o.id));
  }

  const snap = (plan.snapshot ?? {}) as { plan?: Parameters<typeof planReservationWants>[0] };
  const wants = planReservationWants(snap.plan ?? []);
  let reserved = 0;
  let items = 0;
  for (const w of wants) {
    const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, w.inventoryItemId)).for("update");
    if (!item) continue;
    const take = round3(Math.min(w.qty, Math.max(0, Number(item.qty) - Number(item.reservedQty))));
    if (take <= 0) continue;
    await reserveStock(tx, w.inventoryItemId, take);
    await tx.insert(operationsPlanReservationsTable).values({ planId: plan.id, inventoryItemId: w.inventoryItemId, qty: String(take) });
    reserved = round3(reserved + take);
    items += 1;
  }
  return { reserved, items };
}

/** لما التشغيل يستلم خامة من المخزن لأمر إنتاج، بنصرف من حجز الخطة المعتمدة لنفس أمر البيع (الأقدم أول) ونحرر الجزء ده. */
export async function consumePlanReservation(tx: Tx, input: { salesOrderId: number | null; inventoryItemId: number; qty: string | number }): Promise<number> {
  if (!input.salesOrderId) return 0;
  const plans = await tx.select({ id: operationsPlansTable.id }).from(operationsPlansTable)
    .where(and(eq(operationsPlansTable.salesOrderId, input.salesOrderId), eq(operationsPlansTable.status, "approved")));
  if (!plans.length) return 0;
  const rows = await tx.select().from(operationsPlanReservationsTable)
    .where(and(
      inArray(operationsPlanReservationsTable.planId, plans.map((p) => p.id)),
      eq(operationsPlanReservationsTable.inventoryItemId, input.inventoryItemId),
      eq(operationsPlanReservationsTable.status, "active"),
    ))
    .orderBy(asc(operationsPlanReservationsTable.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const takes = allocateConsumption(rows.map((r) => ({ id: r.id, remaining: round3(Number(r.qty) - Number(r.consumedQty)) })), Number(input.qty));
  let total = 0;
  for (const t of takes) {
    const r = byId.get(t.id)!;
    const consumed = round3(Number(r.consumedQty) + t.take);
    await releaseStockReservation(tx, input.inventoryItemId, t.take);
    await tx.update(operationsPlanReservationsTable)
      .set({ consumedQty: String(consumed), status: consumed >= Number(r.qty) ? "consumed" : "active" })
      .where(eq(operationsPlanReservationsTable.id, r.id));
    total = round3(total + t.take);
  }
  return total;
}
