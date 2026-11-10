/** @format */
// مسار التصنيع الحالي لكل وصفة (43ج): وصفة ← الصنف الأساسي ← المنتج الهندسي ← النسخة المعتمدة السارية. قراية فقط.
import { inArray } from "drizzle-orm";
import { bomRecipesTable, db, engineeringProductVersionsTable, engineeringProductsTable } from "../db";
import { pickRoutingVersions } from "./capacityCentersCore";

/** وصفة من غير ربط بصنف أساسي، أو صنف من غير منتج هندسي معتمد = مش في الخريطة (والمنادي بيتعامل معاها كـ«من غير مسار»). */
export async function loadRecipeRoutings(recipeIds: readonly number[], todayIso: string): Promise<Map<number, unknown>> {
  const out = new Map<number, unknown>();
  const ids = [...new Set(recipeIds)].filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return out;
  const recipes = await db.select({ id: bomRecipesTable.id, itemId: bomRecipesTable.foundationItemId }).from(bomRecipesTable).where(inArray(bomRecipesTable.id, ids));
  const itemIds = [...new Set(recipes.map((r) => r.itemId).filter((n): n is number => n !== null))];
  if (itemIds.length === 0) return out;
  const products = await db.select({ id: engineeringProductsTable.id, itemId: engineeringProductsTable.foundationItemId }).from(engineeringProductsTable).where(inArray(engineeringProductsTable.foundationItemId, itemIds));
  if (products.length === 0) return out;
  const versions = await db
    .select({ id: engineeringProductVersionsTable.id, productId: engineeringProductVersionsTable.productId, status: engineeringProductVersionsTable.status, effectiveFrom: engineeringProductVersionsTable.effectiveFrom, effectiveTo: engineeringProductVersionsTable.effectiveTo, routingSnapshot: engineeringProductVersionsTable.routingSnapshot })
    .from(engineeringProductVersionsTable)
    .where(inArray(engineeringProductVersionsTable.productId, products.map((p) => p.id)));
  const byProduct = pickRoutingVersions(versions, todayIso);
  const productOfItem = new Map(products.map((p) => [p.itemId, p.id]));
  for (const r of recipes) {
    const pid = r.itemId === null ? undefined : productOfItem.get(r.itemId);
    if (pid !== undefined && byProduct.has(pid)) out.set(r.id, byProduct.get(pid));
  }
  return out;
}
