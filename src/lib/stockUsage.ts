import { PERMISSIONS } from "./permissions";

/** مراحل أمر الإنتاج اللي لسه شغّالة (الخامة فيها ممكن تتصرف أو تتحجز). */
export const ACTIVE_PRODUCTION_STATUSES = ["new", "materials_requested", "materials_approved", "materials_partial", "in_production", "quality_check"] as const;

/** مين يشوف الإجمالي المسموح في صفحة المخزون: المخازن والمشتريات والإدارة. */
export const STOCK_USAGE_ROLES = ["chairman", "executive_manager", "warehouse_manager", "storekeeper", "purchasing_manager", "buyer"] as const;

/** كمية الخامة جوه الوصفة سر تصنيع: بتظهر بس للأدوار اللي مسموح لها بالوصفات أصلًا. */
export const canSeeRecipeQty = (role: string): boolean => (PERMISSIONS.bom.view as readonly string[]).includes(role);

export interface BomUsageRow {
  recipeId: number;
  productName: string;
  qty: string;
  unit: string | null;
}
export interface ProductionUsageRow {
  id: number;
  orderNumber: string;
  productName: string;
  qty: string;
  workflowStatus: string;
  bomRecipeId: number | null;
}

/** بيجمّع استخدام الخامة: الوصفات (من غير تكرار) وأوامر الإنتاج النشطة المرتبطة بيها. */
export function shapeUsage(role: string, bom: BomUsageRow[], orders: ProductionUsageRow[]) {
  const seeQty = canSeeRecipeQty(role);
  const seen = new Set<number>();
  const recipes = [] as Array<{ recipeId: number; productName: string; unit: string | null; qty?: string }>;
  for (const b of bom) {
    if (seen.has(b.recipeId)) continue;
    seen.add(b.recipeId);
    recipes.push(seeQty ? { recipeId: b.recipeId, productName: b.productName, unit: b.unit, qty: b.qty } : { recipeId: b.recipeId, productName: b.productName, unit: b.unit });
  }
  const active = new Set<string>(ACTIVE_PRODUCTION_STATUSES);
  const production = orders
    .filter((o) => o.bomRecipeId !== null && seen.has(o.bomRecipeId) && active.has(o.workflowStatus))
    .map((o) => ({ id: o.id, orderNumber: o.orderNumber, productName: o.productName, qty: o.qty, status: o.workflowStatus }));
  return { recipes, production };
}
