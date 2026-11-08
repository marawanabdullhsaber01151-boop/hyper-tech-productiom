/** @format */
// تحويل الكرتونة لمجموعة وصفات بالاستعلام الواحد (الخطوة 42ب): بيستخدمه السلة وتأكيد الطلب وقايمة المنتجات.
import { and, eq, inArray } from "drizzle-orm";
import { bomRecipesTable, db, foundationItemsTable, foundationUnitConversionsTable } from "../db";
import { toCartonConversion, type CartonConversion } from "./cartonConversion";

/** خريطة (رقم الوصفة ← تحويل الكرتونة الصالح). الوصفة اللي مالهاش كرتونة صالحة مابتظهرش في الخريطة. */
export async function loadCartonConversions(recipeIds: readonly number[], executor: typeof db = db): Promise<Map<number, CartonConversion>> {
  const out = new Map<number, CartonConversion>();
  if (!recipeIds.length) return out;
  const rows = await executor
    .select({ recipeId: bomRecipesTable.id, fromUnit: foundationUnitConversionsTable.fromUnit, factor: foundationUnitConversionsTable.factor })
    .from(bomRecipesTable)
    .innerJoin(foundationItemsTable, eq(foundationItemsTable.id, bomRecipesTable.foundationItemId))
    .innerJoin(
      foundationUnitConversionsTable,
      and(eq(foundationUnitConversionsTable.itemId, foundationItemsTable.id), eq(foundationUnitConversionsTable.toUnit, foundationItemsTable.baseUnit)),
    )
    .where(inArray(bomRecipesTable.id, [...recipeIds]));
  for (const r of rows) {
    const conv = toCartonConversion(r);
    if (conv && !out.has(r.recipeId)) out.set(r.recipeId, conv);
  }
  return out;
}
