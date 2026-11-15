/** @format */
// متوسط التكلفة المرجّح (49ب). بيتحدّث من المشتريات المقبولة بعد الفحص بس، قبل ما الحركة تزوّد الكمية.
// (مش في applyStockMovement: مرتجع البيع بيدخل بسعر البيع، وده مش تكلفة.)
import { eq } from "drizzle-orm";
import { inventoryItemsTable } from "../db";
import { weightedAvgCost } from "./ledgerAutoCore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = any;

export async function updateAverageCost(tx: Exec, inventoryItemId: number, inQty: string, price: string): Promise<void> {
  const [item] = await tx
    .select({ qty: inventoryItemsTable.qty, avgCost: inventoryItemsTable.avgCost })
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, inventoryItemId))
    .for("update");
  if (!item) return;
  const next = weightedAvgCost(String(item.qty), String(item.avgCost), inQty, price);
  if (next === String(item.avgCost)) return;
  await tx.update(inventoryItemsTable).set({ avgCost: next }).where(eq(inventoryItemsTable.id, inventoryItemId));
}
