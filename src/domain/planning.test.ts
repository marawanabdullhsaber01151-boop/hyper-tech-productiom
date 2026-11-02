import { describe, expect, it } from "vitest";
import {
  buildPlanningRunKey,
  buildReleaseImpact,
  calculatePlanningRequirement,
  ceilDecimalToThree,
  evaluateCapacity,
  explodeBomLines,
  type ExplodeRecipe,
  mergeCapacityLoads,
} from "./planning";

describe("planning domain", () => {
  it("does not count reserved or quarantined stock as freely available", () => {
    const result = calculatePlanningRequirement({
      grossQty: "100", availableQty: "100", reservedQty: "20",
      quarantineQty: "10", openSupplyQty: "0", leadDays: 0, requiredBy: "2026-09-20",
    });
    expect(result.freeAvailableQty).toBe("70");
    expect(result.netQty).toBe("30");
    expect(result.shortageCode).toBe("reserved_or_quarantined");
  });

  it("is deterministic and independent from object key order", () => {
    expect(buildPlanningRunKey({ b: 2, a: 1 })).toBe(buildPlanningRunKey({ a: 1, b: 2 }));
  });

  it("detects capacity overload with an actionable explanation", () => {
    expect(evaluateCapacity(600, 480)).toMatchObject({
      overloadMinutes: 120, status: "overloaded",
    });
  });

  it("merges overlapping loads before calculating the calendar", () => {
    const merged = mergeCapacityLoads([
      { workCenterId: 7, loadDate: "2026-09-20", requiredMinutes: 300, availableMinutes: 480 },
      { workCenterId: 7, loadDate: "2026-09-20", requiredMinutes: 250, availableMinutes: 480 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ requiredMinutes: 550, availableMinutes: 480 });
  });

  it("keeps release preview explicit about live isolation", () => {
    expect(buildReleaseImpact({ shortageCount: 1, overloadedCount: 0, requirementCount: 4 }).liveReservationsChanged).toBe(false);
  });
});

const recipe = (o: Partial<ExplodeRecipe> & { id: number }): ExplodeRecipe => ({
  productName: "بطارية", productCode: "FG-1", outputQty: "10", isActive: true,
  items: [
    { id: 1, inventoryItemId: 7, materialName: "رصاص", qty: "20", unit: "kg" },
    { id: 2, inventoryItemId: 8, materialName: "حمض", qty: "5", unit: "لتر" },
  ],
  ...o,
});

describe("explodeBomLines — فرد الوصفات", () => {
  it("بيحسب الاحتياج = كمية الدفعة × المطلوب ÷ الناتج", () => {
    const { demands, blockers } = explodeBomLines([{ bomRecipeId: 1, qty: "25", requiredBy: "2026-12-01" }], [recipe({ id: 1 })]);
    expect(blockers).toEqual([]);
    expect(demands.map((d) => [d.inventoryItemId, d.grossQty])).toEqual([[7, "50"], [8, "12.5"]]);
    expect(demands[0]!.sources[0]).toMatchObject({ recipeId: 1, lineNo: 1, producedQty: "25", perBatchQty: "20", outputQty: "10" });
  });
  it("بيجمّع نفس الخامة من وصفتين ويحفظ مصدر كل جزء وأبكر تاريخ", () => {
    const r2 = recipe({ id: 2, productName: "شاحن", outputQty: "1", items: [{ id: 9, inventoryItemId: 7, materialName: "رصاص", qty: "3", unit: "kg" }] });
    const { demands } = explodeBomLines([
      { bomRecipeId: 1, qty: "10", requiredBy: "2026-12-10" },
      { bomRecipeId: 2, qty: "4", requiredBy: "2026-12-05" },
    ], [recipe({ id: 1 }), r2]);
    const lead = demands.find((d) => d.inventoryItemId === 7)!;
    expect(lead.grossQty).toBe("32");
    expect(lead.requiredBy).toBe("2026-12-05");
    expect(lead.sources.map((s) => s.productName)).toEqual(["بطارية", "شاحن"]);
  });
  it("بيقرّب لأعلى لـ3 خانات (مفيش طلب أقل من اللازم)", () => {
    const r = recipe({ id: 3, outputQty: "3", items: [{ id: 1, inventoryItemId: 7, materialName: "رصاص", qty: "1", unit: "kg" }] });
    expect(explodeBomLines([{ bomRecipeId: 3, qty: "1", requiredBy: "2026-12-01" }], [r]).demands[0]!.grossQty).toBe("0.334");
    expect(ceilDecimalToThree("2.5")).toBe("2.5");
    expect(ceilDecimalToThree("2.000001")).toBe("2.001");
    expect(ceilDecimalToThree("10")).toBe("10");
  });
  it("المكوّن غير المربوط والوصفة الموقوفة والفاضية والمفقودة = blockers مش تخمين", () => {
    const unlinked = recipe({ id: 4, items: [{ id: 1, inventoryItemId: null, materialName: "غلاف", qty: "1", unit: "قطعة" }] });
    const { demands, blockers } = explodeBomLines([
      { bomRecipeId: 4, qty: "5", requiredBy: "2026-12-01" },
      { bomRecipeId: 5, qty: "5", requiredBy: "2026-12-01" },
      { bomRecipeId: 6, qty: "5", requiredBy: "2026-12-01" },
      { bomRecipeId: 99, qty: "5", requiredBy: "2026-12-01" },
    ], [unlinked, recipe({ id: 5, isActive: false }), recipe({ id: 6, items: [] })]);
    expect(demands).toEqual([]);
    expect(blockers.map((b) => b.code).sort()).toEqual(["item_unlinked", "recipe_empty", "recipe_inactive", "recipe_missing"]);
    expect(blockers.find((b) => b.code === "item_unlinked")!.message).toContain("غلاف");
  });
  it("نفس الـblocker مش بيتكرر لو الوصفة في سطرين", () => {
    const unlinked = recipe({ id: 4, items: [{ id: 1, inventoryItemId: null, materialName: "غلاف", qty: "1", unit: "قطعة" }] });
    const { blockers } = explodeBomLines([
      { bomRecipeId: 4, qty: "5", requiredBy: "2026-12-01" },
      { bomRecipeId: 4, qty: "7", requiredBy: "2026-12-02" },
    ], [unlinked]);
    expect(blockers).toHaveLength(1);
  });
});
