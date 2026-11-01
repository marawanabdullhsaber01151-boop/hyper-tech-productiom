/** @format */
// حراس خطوة 33ب: وصفات التصنيع. (من غير قاعدة بيانات: تحقق المدخلات + فحص ثابت لتسلسل المسارات.)
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { insertBomRecipeItemSchema, insertBomRecipeSchema } from "../db/schema/bom";

const source = readFileSync(resolve(process.cwd(), "src/routes/bom.ts"), "utf8");
const handler = (start: string, len = 2200) => {
  const i = source.indexOf(start);
  expect(i, `${start} موجود`).toBeGreaterThan(-1);
  return source.slice(i, i + len);
};

describe("خطوة 33ب — تحقق أرقام الوصفة", () => {
  const base = { recipeId: 1, materialName: "قماش" };
  it.each(["1", "0.5", "12.345", "100"])("الكمية %s مقبولة", (qty) => {
    expect(insertBomRecipeItemSchema.safeParse({ ...base, qty }).success).toBe(true);
  });
  it.each(["", "0", "0.000", "-1", "abc", "1.2345", "1e3", "١٢"])("الكمية «%s» مرفوضة", (qty) => {
    expect(insertBomRecipeItemSchema.safeParse({ ...base, qty }).success).toBe(false);
  });
  it("سعر الوحدة: خانتين عشريتين بالكتير وغير سالب", () => {
    expect(insertBomRecipeItemSchema.safeParse({ ...base, qty: "1", unitCost: "12.50" }).success).toBe(true);
    expect(insertBomRecipeItemSchema.safeParse({ ...base, qty: "1", unitCost: "12.505" }).success).toBe(false);
    expect(insertBomRecipeItemSchema.safeParse({ ...base, qty: "1", unitCost: "-3" }).success).toBe(false);
  });
  it("كمية ناتج الوصفة لازم تبقى موجبة وسعر المرجع اختياري", () => {
    expect(insertBomRecipeSchema.safeParse({ productName: "م", outputQty: "0" }).success).toBe(false);
    expect(insertBomRecipeSchema.safeParse({ productName: "م", outputQty: "10", referencePrice: null }).success).toBe(true);
    expect(insertBomRecipeSchema.safeParse({ productName: "م", referencePrice: "x" }).success).toBe(false);
  });
});

describe("خطوة 33ب — تسلسل المسارات", () => {
  it("lookups متسجّل قبل /bom/:id وقبل items/all", () => {
    // نثبّت على تسجيل المسار الفعلي (router.get) مش على نص التعليقات اللي بتذكر المسار.
    const l = source.indexOf('router.get(\n  "/bom/lookups"');
    const byId = source.indexOf('router.get(\n  "/bom/:id"');
    const all = source.indexOf('router.get(\n  "/bom/items/all"');
    expect(l).toBeGreaterThan(-1);
    expect(byId).toBeGreaterThan(-1);
    expect(l).toBeLessThan(byId);
    expect(l).toBeLessThan(all);
  });
  it("lookups مفيهوش أسعار ولا كميات مخزون", () => {
    const body = handler('"/bom/lookups"', 1400);
    expect(body).not.toMatch(/unitPrice|qty|reservedQty|unitCost/);
  });
  it("حذف المكوّن بيتأكد إنه تبع الوصفة اللي في المسار", () => {
    const body = handler('router.delete(\n  "/bom/:id/items/:itemId"');
    expect(body).toContain("eq(bomRecipeItemsTable.recipeId, recipeId)");
    expect(body).toContain("bom.item.delete");
  });
  it("تعديل المكوّن: مسار PATCH بقفل صف وملكية وتدقيق", () => {
    const body = handler('router.patch(\n  "/bom/:id/items/:itemId"');
    expect(body).toContain('.for("update")');
    expect(body).toContain("eq(bomRecipeItemsTable.recipeId, recipeId)");
    expect(body).toContain("bom.item.update");
  });
  it("إضافة مكوّن: الوصفة لازم موجودة (404) في نفس المعاملة", () => {
    const body = handler('router.post(\n  "/bom/:id/items"');
    expect(body).toContain("db.transaction");
    expect(body).toContain("الوصفة غير موجودة");
    expect(body).toContain("bom.item.add");
  });
  it("مسح الوصفة المستخدمة مرفوض 409 والتدقيق في نفس المعاملة", () => {
    const body = handler('router.delete(\n  "/bom/:id",', 3200);
    expect(body).toContain("recipeUsage(tx, id)");
    expect(body).toContain("status: 409");
    expect(body).toContain("bom.recipe.delete");
    expect(body).toContain("executor: tx");
  });
  it("تعديل الوصفة بقفل صف وتدقيق قبل/بعد", () => {
    const body = handler('router.patch(\n  "/bom/:id",', 2600);
    expect(body).toContain('.for("update")');
    expect(body).toContain("bom.recipe.update");
  });
  it("كل استخدامات الوصفة اللي بتمنع الحذف متغطية", () => {
    const body = handler("async function recipeUsage", 1200);
    for (const t of ["productionOrdersTable", "productionWorkflowOrdersTable", "productionRequestsTable", "portalPriceInquiriesTable"]) expect(body).toContain(t);
  });
  it("كل كتابة صور بتتسجّل", () => {
    for (const k of ["bom.image.primary", "bom.image.secondary", "bom.image.delete"]) expect(source).toContain(k);
  });
});
