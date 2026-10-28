import { describe, expect, it } from "vitest";
import { MATERIALS_DECIDE_ROLES, PREPARE_ONLY_ROLES, decisionBody, defaultMode, defaultQty, materialsError, shortageOf, type CheckedMaterial } from "./materialsRules";

const cu: CheckedMaterial = { inventoryItemId: 1, materialName: "نحاس", requestedQty: "10.000", availableQty: "20.000", unit: "كجم", sufficient: true };
const pl: CheckedMaterial = { inventoryItemId: 2, materialName: "بلاستيك", requestedQty: "5.000", availableQty: "3.000", unit: "كجم", sufficient: false };

describe("قواعد قرار الخامات", () => {
  it("الكمية المقترحة هي الأقل بين المطلوب والمتاح، والنقص يتحسب", () => {
    expect(defaultQty(cu)).toBe("10.000");
    expect(defaultQty(pl)).toBe("3.000");
    expect(shortageOf(pl)).toBe(2);
    expect(shortageOf(cu)).toBe(0);
  });
  it("القرار الافتراضي: اعتماد كامل لو متوفر، وجزئي لو فيه نقص", () => {
    expect(defaultMode([cu])).toBe("approve");
    expect(defaultMode([cu, pl])).toBe("partial");
  });
  it("الرفض لازم له سبب 3 أحرف", () => {
    expect(materialsError({ mode: "reject", comment: " ab", list: [cu], qtys: {} }).code).toBe("reason");
    expect(materialsError({ mode: "reject", comment: "تالف", list: [cu], qtys: {} }).code).toBeNull();
  });
  it("الاعتماد الكامل يتمنع مع نقص ويسمّي المادة", () => {
    expect(materialsError({ mode: "approve", comment: "", list: [cu, pl], qtys: {} })).toEqual({ code: "shortage", names: ["بلاستيك"] });
    expect(materialsError({ mode: "approve", comment: "", list: [cu], qtys: {} }).code).toBeNull();
  });
  it("الجزئي: كمية غلط، أكبر من المطلوب، أكبر من المتاح، كله أصفار", () => {
    const e = (q1: string, q2: string) => materialsError({ mode: "partial", comment: "", list: [cu, pl], qtys: { 1: q1, 2: q2 } });
    expect(e("x", "1").code).toBe("qtyBad");
    expect(e("-1", "1").code).toBe("qtyBad");
    expect(e("11", "1")).toEqual({ code: "qtyOverReq", names: ["نحاس"] });
    expect(e("5", "4")).toEqual({ code: "qtyOverAvail", names: ["بلاستيك"] });
    expect(e("0", "0.000").code).toBe("allZero");
    expect(e("10", "3").code).toBeNull();
  });
  it("جسم الطلب: الكامل والرفض بدون كميات، والجزئي بكمية لكل مادة", () => {
    expect(decisionBody({ mode: "approve", comment: " ", list: [cu], qtys: {} })).toEqual({ action: "approve", comment: undefined });
    expect(decisionBody({ mode: "reject", comment: " تالف ", list: [cu], qtys: {} })).toEqual({ action: "reject", comment: "تالف" });
    expect(decisionBody({ mode: "partial", comment: "", list: [cu, pl], qtys: { 1: "10", 2: " 3 " } })).toEqual({
      action: "partial",
      comment: undefined,
      materialDecisions: [
        { materialName: "نحاس", inventoryItemId: 1, approvedQty: "10", unit: "كجم" },
        { materialName: "بلاستيك", inventoryItemId: 2, approvedQty: "3", unit: "كجم" },
      ],
    });
  });
  it("الأدوار", () => {
    expect(MATERIALS_DECIDE_ROLES).toContain("storekeeper");
    expect(MATERIALS_DECIDE_ROLES).not.toContain("production_manager");
    expect(PREPARE_ONLY_ROLES).toEqual(["warehouse_manager", "storekeeper"]);
  });
});
