/** @format */

import {
  db,
  inventoryItemsTable,
  bomRecipeItemsTable,
  bomRecipesTable,
} from "../db";
import { eq } from "drizzle-orm";

/**
 * ✅ تطبيع آمن فقط: تجاهل الفراغات الزائدة واختلاف حالة الأحرف — من غير أي "فهم ذكي" للكلمات
 * (بالظبط زي ما تم الاتفاق عليه: "مستوى التقريب الصحيح اللي مش يعمل أي غلطات أو لخبطة خالص")
 */
export function normalizeMaterialName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * يتحقق هل اسم مكوّن مكتوب يدويًا (غير مرتبط بالمخزون) بقى متوفرًا الآن
 * عن طريق مطابقة آمنة مع أسماء أصناف المخزون الحقيقية.
 */
export async function isMaterialNameAvailableInInventory(
  materialName: string,
): Promise<boolean> {
  const target = normalizeMaterialName(materialName);
  const items = await db
    .select({ name: inventoryItemsTable.name })
    .from(inventoryItemsTable);
  return items.some((i) => normalizeMaterialName(i.name) === target);
}

export type EnrichedBomItem = {
  id: number;
  recipeId: number;
  inventoryItemId: number | null;
  materialName: string;
  qty: string;
  unit: string;
  unitCost: string | null;
  linked: boolean; // ✅ مرتبط بصنف حقيقي في المخزون (inventoryItemId موجود)
  available: boolean; // ✅ متوفر حاليًا (مرتبط، أو اسمه مطابق لصنف موجود بالمخزون)
};

/**
 * يرجّع مكوّنات وصفة تصنيع، وكل مكوّن مُذيَّل بحالته الحقيقية:
 * linked = مرتبط فعليًا بصنف مخزون، available = ظاهر متوفر حاليًا (مرتبط أو الاسم بقى موجود بالمخزون).
 */
export async function getEnrichedBomItems(
  recipeId: number,
): Promise<EnrichedBomItem[]> {
  const items = await db
    .select()
    .from(bomRecipeItemsTable)
    .where(eq(bomRecipeItemsTable.recipeId, recipeId));
  const inventoryItems = await db
    .select({ id: inventoryItemsTable.id, name: inventoryItemsTable.name })
    .from(inventoryItemsTable);
  const normalizedNames = new Set(
    inventoryItems.map((i) => normalizeMaterialName(i.name)),
  );

  return items.map((item) => {
    const linked = item.inventoryItemId !== null;
    const available =
      linked || normalizedNames.has(normalizeMaterialName(item.materialName));
    return { ...item, linked, available };
  });
}

/**
 * يرجّع أسماء المكوّنات غير المرتبطة بصنف حقيقي في المخزون — تُستخدم لمنع
 * تأكيد أمر الإنتاج طالما فيه مكوّن واحد على الأقل مش مرتبط بعد.
 */
export async function getUnlinkedBomItemNames(
  recipeId: number,
): Promise<string[]> {
  const items = await db
    .select()
    .from(bomRecipeItemsTable)
    .where(eq(bomRecipeItemsTable.recipeId, recipeId));
  return items
    .filter((i) => i.inventoryItemId === null)
    .map((i) => i.materialName);
}

export type RequiredMaterial = {
  inventoryItemId: number;
  materialName: string;
  requestedQty: string;
  unit: string;
  availableQty: string;
  sufficient: boolean;
};

/**
 * يحسب المواد الخام المطلوبة فعليًا لتنفيذ أمر إنتاج بكمية معينة، بناءً على وصفة التصنيع
 * (مطلوب × كمية الأمر ÷ حجم دفعة الوصفة)، ويقارنها تلقائيًا بالمتاح في المخزون الآن.
 * تُستخدم هذه القائمة تلقائيًا بدل الإدخال اليدوي — كل مكوّنات الوصفة لازم تكون مرتبطة
 * بالمخزون بالفعل (ممنوع إنشاء أمر إنتاج من غير كده أصلاً).
 */
export async function computeRequiredMaterialsForOrder(
  bomRecipeId: number,
  orderQty: number,
): Promise<RequiredMaterial[]> {
  const [recipe] = await db
    .select()
    .from(bomRecipesTable)
    .where(eq(bomRecipesTable.id, bomRecipeId))
    .limit(1);
  if (!recipe) return [];
  const batchSize = Number(recipe.outputQty) || 1;
  const scale = orderQty / batchSize;

  const items = await db
    .select()
    .from(bomRecipeItemsTable)
    .where(eq(bomRecipeItemsTable.recipeId, bomRecipeId));
  const inventoryItems = await db.select().from(inventoryItemsTable);
  const invById = new Map(inventoryItems.map((i) => [i.id, i]));

  return items
    .filter((i) => i.inventoryItemId !== null)
    .map((i) => {
      const inv = invById.get(i.inventoryItemId!);
      const requestedQty = Number(i.qty) * scale;
      const availableQty = inv ? Number(inv.qty) : 0;
      return {
        inventoryItemId: i.inventoryItemId!,
        materialName: i.materialName,
        requestedQty: requestedQty.toFixed(3),
        unit: i.unit,
        availableQty: availableQty.toFixed(3),
        sufficient: availableQty >= requestedQty,
      };
    });
}
