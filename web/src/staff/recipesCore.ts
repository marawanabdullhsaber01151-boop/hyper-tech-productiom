/**
 * منطق وصفات التصنيع (خطوة 33ب). بدون واجهة عشان يتختبر لوحده.
 * لازم يتطابق مع src/routes/bom.ts وsrc/db/schema/bom.ts (السيرفر هو الحَكَم).
 */

/** نفس PERMISSIONS.bom.view: مين يشوف الوصفات. */
export const RECIPE_VIEW_ROLES = ["chairman", "hr", "hr_manager", "production_manager", "supervisor", "production_controller"] as const;
/** نفس BOM_WRITE: مين يعدّل (إنشاء/تعديل/حذف). */
export const RECIPE_WRITE_ROLES = ["chairman", "hr", "hr_manager"] as const;

export const canViewRecipes = (role: string) => (RECIPE_VIEW_ROLES as readonly string[]).includes(role);
export const canEditRecipes = (role: string) => (RECIPE_WRITE_ROLES as readonly string[]).includes(role);

export interface RecipeRow {
  id: number;
  productCode: string | null;
  productName: string;
  foundationItemId: number | null;
  outputQty: string;
  referencePrice: string | null;
  expectedProductionDays: number | null;
  isActive: boolean;
  description: string | null;
}

export interface RecipeItemRow {
  id: number;
  inventoryItemId: number | null;
  materialName: string;
  qty: string;
  unit: string;
  unitCost: string;
  isFeatured: boolean;
  featuredImageData: string | null;
  linked: boolean;
}

export interface RecipeImage { id: number; role: "primary" | "secondary"; imageData: string; sortOrder: number }

/* ───────────── أرقام (نفس شروط السيرفر) ───────────── */

const QTY = /^\d{1,9}(\.\d{1,3})?$/;
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
/** أرقام عربية-هندية (U+0660..0669) أو فاصلة عربية (U+066B) → لاتينية، عشان الموظف يكتب زي ما لوحة مفاتيحه. */
export function normalizeNumber(s: string): string {
  return s
    .trim()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u066B,]/g, ".");
}
export const isQty = (s: string) => QTY.test(s) && Number(s) > 0;
export const isMoney = (s: string) => MONEY.test(s);

/** تكلفة بالقروش (أرقام صحيحة، قاعدة E1): كمية بـ3 خانات × سعر بالقروش. */
export function lineCostPiasters(qty: string, unitCost: string): number {
  const q = normalizeNumber(qty), c = normalizeNumber(unitCost || "0");
  if (!isQty(q) || !isMoney(c)) return 0;
  const [qi = "0", qf = ""] = q.split(".");
  const [ci = "0", cf = ""] = c.split(".");
  const qtyMilli = Number(qi) * 1000 + Number(qf.padEnd(3, "0"));
  const costPiasters = Number(ci) * 100 + Number(cf.padEnd(2, "0"));
  return Math.round((qtyMilli * costPiasters) / 1000);
}

export interface CostSummary { batchPiasters: number; unitPiasters: number; unpriced: number }

/** تكلفة الدفعة (كل المكوّنات) وتكلفة الوحدة (÷ كمية الناتج) + عدد المكوّنات من غير سعر. */
export function costSummary(items: readonly Pick<RecipeItemRow, "qty" | "unitCost">[], outputQty: string): CostSummary {
  const batchPiasters = items.reduce((s, i) => s + lineCostPiasters(i.qty, i.unitCost), 0);
  const out = Number(normalizeNumber(outputQty));
  const unitPiasters = out > 0 ? Math.round(batchPiasters / out) : 0;
  const unpriced = items.filter((i) => !(Number(normalizeNumber(i.unitCost || "0")) > 0)).length;
  return { batchPiasters, unitPiasters, unpriced };
}

/** من القروش للجنيه كنص بخانتين (للعرض والمدخلات). */
export const piastersToEgp = (p: number) => (p / 100).toFixed(2);

/* ───────────── القائمة والبحث ───────────── */

export type RecipeFilter = "all" | "active" | "inactive" | "unlinked";

export function filterRecipes(rows: readonly RecipeRow[], search: string, filter: RecipeFilter): RecipeRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter === "active" && !r.isActive) return false;
    if (filter === "inactive" && r.isActive) return false;
    if (filter === "unlinked" && r.foundationItemId !== null) return false;
    return !q || r.productName.toLowerCase().includes(q) || (r.productCode ?? "").toLowerCase().includes(q);
  });
}

export function recipeStats(rows: readonly RecipeRow[]) {
  return {
    total: rows.length,
    active: rows.filter((r) => r.isActive).length,
    inactive: rows.filter((r) => !r.isActive).length,
    unlinked: rows.filter((r) => r.foundationItemId === null).length,
  };
}

/* ───────────── نموذج الوصفة ───────────── */

export interface RecipeForm { foundationItemId: string; description: string; outputQty: string; referencePrice: string; expectedDays: string }
export type RecipeFormError = "product" | "outputQty" | "referencePrice" | "days" | null;

export function recipeError(f: RecipeForm, needsProduct: boolean): RecipeFormError {
  if (needsProduct && !f.foundationItemId) return "product";
  if (!isQty(normalizeNumber(f.outputQty))) return "outputQty";
  if (f.referencePrice.trim() && !isMoney(normalizeNumber(f.referencePrice))) return "referencePrice";
  if (f.expectedDays.trim() && !/^[1-9]\d{0,3}$/.test(normalizeNumber(f.expectedDays))) return "days";
  return null;
}

export function recipePayload(f: RecipeForm, includeProduct: boolean) {
  return {
    ...(includeProduct ? { foundationItemId: Number(f.foundationItemId), productName: "-" } : {}),
    description: f.description.trim() || null,
    outputQty: normalizeNumber(f.outputQty),
    referencePrice: f.referencePrice.trim() ? normalizeNumber(f.referencePrice) : null,
    expectedProductionDays: f.expectedDays.trim() ? Number(normalizeNumber(f.expectedDays)) : null,
  };
}

/* ───────────── نموذج المكوّن ───────────── */

export interface ItemForm { inventoryItemId: string; materialName: string; qty: string; unit: string; unitCost: string; isFeatured: boolean; featuredImageData: string | null }
export type ItemFormError = "material" | "qty" | "unit" | "unitCost" | null;

export function itemError(f: ItemForm): ItemFormError {
  if (!f.inventoryItemId && !f.materialName.trim()) return "material";
  if (!isQty(normalizeNumber(f.qty))) return "qty";
  if (!f.unit.trim() || f.unit.trim().length > 20) return "unit";
  if (f.unitCost.trim() && !isMoney(normalizeNumber(f.unitCost))) return "unitCost";
  return null;
}

export function itemPayload(f: ItemForm) {
  return {
    inventoryItemId: f.inventoryItemId ? Number(f.inventoryItemId) : null,
    materialName: f.materialName.trim(),
    qty: normalizeNumber(f.qty),
    unit: f.unit.trim(),
    unitCost: f.unitCost.trim() ? normalizeNumber(f.unitCost) : "0",
    isFeatured: f.isFeatured,
    featuredImageData: f.isFeatured ? f.featuredImageData : null,
  };
}

/** مكوّنات مش مربوطة بالمخزون: أمر الإنتاج مش هيتأكد وهي موجودة (قاعدة السيرفر). */
export const unlinkedItems = (items: readonly Pick<RecipeItemRow, "linked" | "materialName">[]) => items.filter((i) => !i.linked);

/* ───────────── الصور ───────────── */

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export function imageError(file: { type: string; size: number }): "type" | "size" | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size > MAX_IMAGE_BYTES) return "size";
  return null;
}

/** ترتيب الصور الفرعية بعد تحريك واحدة خانة لفوق/تحت (يرجّع نفس الترتيب لو مفيش حركة ممكنة). */
export function moveImage(ids: readonly number[], id: number, dir: -1 | 1): number[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const out = [...ids];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export const secondaryIds = (images: readonly RecipeImage[]) => images.filter((i) => i.role === "secondary").sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.id);

/** أسماء مفصولة بالفاصلة العربية للعرض في الرسائل. */
export const joinNames = (names: readonly string[]) => names.join("\u060C ");
