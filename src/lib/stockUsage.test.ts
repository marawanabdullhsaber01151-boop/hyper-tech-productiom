import { describe, expect, it } from "vitest";
import { canSeeRecipeQty, shapeUsage } from "./stockUsage";

const bom = [
  { recipeId: 1, productName: "كيس 5 كجم", qty: "0.5", unit: "كجم" },
  { recipeId: 1, productName: "كيس 5 كجم", qty: "0.1", unit: "كجم" },
  { recipeId: 2, productName: "جركن", qty: "2", unit: "كجم" },
];
const orders = [
  { id: 10, orderNumber: "PO-1", productName: "كيس 5 كجم", qty: "100", workflowStatus: "in_production", bomRecipeId: 1 },
  { id: 11, orderNumber: "PO-2", productName: "جركن", qty: "50", workflowStatus: "closed", bomRecipeId: 2 },
  { id: 12, orderNumber: "PO-3", productName: "غريب", qty: "5", workflowStatus: "new", bomRecipeId: 99 },
  { id: 13, orderNumber: "PO-4", productName: "بدون وصفة", qty: "5", workflowStatus: "new", bomRecipeId: null },
];

describe("استخدام الخامة في الوصفات والإنتاج", () => {
  it("الوصفة بتتعدّ مرة واحدة وأوامر الإنتاج النشطة المرتبطة بس", () => {
    const u = shapeUsage("chairman", bom, orders);
    expect(u.recipes.map((r) => r.recipeId)).toEqual([1, 2]);
    expect(u.production.map((p) => p.orderNumber)).toEqual(["PO-1"]);
  });
  it("كمية الوصفة بتظهر للمسموح لهم بالوصفات بس", () => {
    expect(canSeeRecipeQty("chairman")).toBe(true);
    expect(canSeeRecipeQty("storekeeper")).toBe(false);
    expect(shapeUsage("chairman", bom, orders).recipes[0]).toHaveProperty("qty");
    expect(shapeUsage("storekeeper", bom, orders).recipes[0]).not.toHaveProperty("qty");
  });
  it("مفيش وصفات ← قايمتين فاضيين", () => {
    expect(shapeUsage("storekeeper", [], orders)).toEqual({ recipes: [], production: [] });
  });
});
