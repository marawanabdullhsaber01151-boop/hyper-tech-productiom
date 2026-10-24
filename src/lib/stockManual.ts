/** @format */
const badRequest = (message: string, status = 400) => Object.assign(new Error(message), { status });

/** نوع الأصناف في البيانات الأساسية ← تصنيف المخزون. */
export const FOUNDATION_TYPE_TO_CATEGORY: Record<string, "raw_material" | "wip" | "finished_good"> = {
  raw_material: "raw_material",
  wip: "wip",
  finished_good: "finished_good",
  packaging: "raw_material",
  consumable: "raw_material",
};
export const foundationTypeToCategory = (t: string) => FOUNDATION_TYPE_TO_CATEGORY[t] ?? "raw_material";

/**
 * الحركة اليدوية («تسوية/جرد»): الخطة بتشترط إن كل حركة ليها مصدر ورقم مرجعي، بس الحركة اليدوية مالهاش أمر شراء ولا فاتورة.
 * فبنخلّي مرجعها الصنف نفسه، وبنشترط سبب مكتوب (ده اللي بيفسّر الحركة في السجل).
 * أي نوع تاني (شراء/بيع/إنتاج) لازم يجيله رقمه المرجعي زي ما هو.
 */
export function withManualReference<T extends { referenceType?: string | null; referenceId?: number | null; inventoryItemId: number; notes?: string | null }>(data: T): T & { referenceId?: number | null } {
  if (data.referenceType !== "adjustment" || data.referenceId) return data;
  if (!data.notes || !data.notes.trim()) {
    throw badRequest("اكتب سبب الحركة (مثلًا: استلام من مورّد، جرد، تالف) عشان تتسجّل في السجل");
  }
  return { ...data, referenceId: data.inventoryItemId };
}
