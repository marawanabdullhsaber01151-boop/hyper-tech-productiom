import { describe, expect, it } from "vitest";
import {
  canEditRecipes, canViewRecipes, costSummary, filterRecipes, imageError, isMoney, isQty, itemError, itemPayload, lineCostPiasters, moveImage, normalizeNumber,
  piastersToEgp, recipeError, recipePayload, recipeStats, secondaryIds, unlinkedItems, type RecipeRow,
} from "./recipesCore";

const row = (o: Partial<RecipeRow>): RecipeRow => ({ id: 1, productCode: "FG-1", productName: "قميص", foundationItemId: 5, outputQty: "1", referencePrice: null, expectedProductionDays: null, isActive: true, description: null, ...o });

describe("recipesCore — الصلاحيات", () => {
  it("المشاهدة والتعديل زي السيرفر", () => {
    expect(canViewRecipes("supervisor")).toBe(true);
    expect(canEditRecipes("supervisor")).toBe(false);
    expect(canEditRecipes("hr_manager")).toBe(true);
    expect(canViewRecipes("storekeeper")).toBe(false);
  });
});

describe("recipesCore — الأرقام", () => {
  it("بتحوّل الأرقام العربية والفاصلة", () => {
    expect(normalizeNumber(" ١٢٫٥ ")).toBe("12.5");
    expect(normalizeNumber("3,25")).toBe("3.25");
  });
  it("الكمية: موجبة وبـ3 خانات، والمبلغ بخانتين", () => {
    expect(isQty("0.001")).toBe(true);
    expect(isQty("0")).toBe(false);
    expect(isQty("1.2345")).toBe(false);
    expect(isMoney("0")).toBe(true);
    expect(isMoney("1.234")).toBe(false);
  });
  it("تكلفة السطر بالقروش من غير أخطاء فاصلة عائمة", () => {
    expect(lineCostPiasters("0.1", "0.2")).toBe(2);
    expect(lineCostPiasters("3", "12.50")).toBe(3750);
    expect(lineCostPiasters("2.5", "10")).toBe(2500);
    expect(lineCostPiasters("abc", "10")).toBe(0);
    expect(lineCostPiasters("1.005", "1000")).toBe(100500);
  });
  it("ملخص التكلفة: الدفعة والوحدة وغير المسعّر", () => {
    const s = costSummary([{ qty: "2", unitCost: "10" }, { qty: "1", unitCost: "0" }], "4");
    expect(s).toEqual({ batchPiasters: 2000, unitPiasters: 500, unpriced: 1 });
    expect(piastersToEgp(s.unitPiasters)).toBe("5.00");
    expect(costSummary([], "0")).toEqual({ batchPiasters: 0, unitPiasters: 0, unpriced: 0 });
  });
});

describe("recipesCore — القائمة", () => {
  const rows = [row({ id: 1 }), row({ id: 2, productName: "بنطلون", productCode: "FG-2", isActive: false }), row({ id: 3, productName: "جاكت", productCode: null, foundationItemId: null })];
  it("الإحصائيات", () => expect(recipeStats(rows)).toEqual({ total: 3, active: 2, inactive: 1, unlinked: 1 }));
  it("البحث بالاسم والكود والفلتر", () => {
    expect(filterRecipes(rows, "fg-2", "all").map((r) => r.id)).toEqual([2]);
    expect(filterRecipes(rows, "", "inactive").map((r) => r.id)).toEqual([2]);
    expect(filterRecipes(rows, "", "unlinked").map((r) => r.id)).toEqual([3]);
    expect(filterRecipes(rows, "جاكت", "active").map((r) => r.id)).toEqual([3]);
  });
});

describe("recipesCore — نموذج الوصفة", () => {
  const ok = { foundationItemId: "5", description: "", outputQty: "12", referencePrice: "", expectedDays: "" };
  it("بيشترط المنتج للإنشاء بس", () => {
    expect(recipeError({ ...ok, foundationItemId: "" }, true)).toBe("product");
    expect(recipeError({ ...ok, foundationItemId: "" }, false)).toBeNull();
  });
  it("بيمسك الأرقام الغلط", () => {
    expect(recipeError({ ...ok, outputQty: "0" }, true)).toBe("outputQty");
    expect(recipeError({ ...ok, referencePrice: "1.234" }, true)).toBe("referencePrice");
    expect(recipeError({ ...ok, expectedDays: "0" }, true)).toBe("days");
    expect(recipeError(ok, true)).toBeNull();
  });
  it("الحمولة: null للفاضي وأرقام لاتينية", () => {
    expect(recipePayload({ ...ok, outputQty: "١٢", referencePrice: "٥٫٥", expectedDays: "٣" }, true)).toMatchObject({ foundationItemId: 5, outputQty: "12", referencePrice: "5.5", expectedProductionDays: 3 });
    expect(recipePayload(ok, false)).toEqual({ description: null, outputQty: "12", referencePrice: null, expectedProductionDays: null });
  });
});

describe("recipesCore — نموذج المكوّن", () => {
  const ok = { inventoryItemId: "7", materialName: "", qty: "2", unit: "متر", unitCost: "", isFeatured: false, featuredImageData: "data:image/png;base64,AA" };
  it("لازم صنف مخزون أو اسم", () => {
    expect(itemError({ ...ok, inventoryItemId: "" })).toBe("material");
    expect(itemError({ ...ok, inventoryItemId: "", materialName: "خيط" })).toBeNull();
  });
  it("الكمية والوحدة والسعر", () => {
    expect(itemError({ ...ok, qty: "0" })).toBe("qty");
    expect(itemError({ ...ok, unit: " " })).toBe("unit");
    expect(itemError({ ...ok, unitCost: "-1" })).toBe("unitCost");
    expect(itemError(ok)).toBeNull();
  });
  it("الصورة بتتبعت للمميز بس", () => {
    expect(itemPayload(ok).featuredImageData).toBeNull();
    expect(itemPayload({ ...ok, isFeatured: true }).featuredImageData).toContain("data:image");
    expect(itemPayload(ok)).toMatchObject({ inventoryItemId: 7, unitCost: "0" });
  });
  it("بيحدد المكوّنات غير المربوطة", () => {
    expect(unlinkedItems([{ linked: true, materialName: "أ" }, { linked: false, materialName: "ب" }]).map((i) => i.materialName)).toEqual(["ب"]);
  });
});

describe("recipesCore — الصور", () => {
  it("النوع والحجم", () => {
    expect(imageError({ type: "image/gif", size: 10 })).toBe("type");
    expect(imageError({ type: "image/png", size: 2 * 1024 * 1024 + 1 })).toBe("size");
    expect(imageError({ type: "image/webp", size: 1000 })).toBeNull();
  });
  it("تحريك الترتيب", () => {
    expect(moveImage([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveImage([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
    expect(moveImage([1, 2, 3], 9, 1)).toEqual([1, 2, 3]);
  });
  it("ترتيب الفرعية حسب sortOrder", () => {
    expect(secondaryIds([{ id: 1, role: "primary", imageData: "", sortOrder: 0 }, { id: 5, role: "secondary", imageData: "", sortOrder: 2 }, { id: 4, role: "secondary", imageData: "", sortOrder: 1 }])).toEqual([4, 5]);
  });
});
