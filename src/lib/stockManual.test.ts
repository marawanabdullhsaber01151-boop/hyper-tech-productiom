import { describe, expect, it } from "vitest";
import { foundationTypeToCategory, withManualReference } from "./stockManual";

describe("withManualReference", () => {
  it("تسوية بسبب: مرجعها الصنف نفسه", () => {
    expect(withManualReference({ inventoryItemId: 7, referenceType: "adjustment", notes: "جرد" }).referenceId).toBe(7);
  });
  it("تسوية من غير سبب: مرفوضة بـ400", () => {
    for (const notes of [undefined, null, "", "   "]) {
      expect(() => withManualReference({ inventoryItemId: 7, referenceType: "adjustment", notes })).toThrowError(/سبب/);
    }
    try {
      withManualReference({ inventoryItemId: 7, referenceType: "adjustment" });
    } catch (e) {
      expect((e as { status?: number }).status).toBe(400);
    }
  });
  it("رقم مرجعي موجود أو نوع تاني: ما بيتغيّرش", () => {
    const a = { inventoryItemId: 7, referenceType: "adjustment", referenceId: 99, notes: "x" };
    expect(withManualReference(a)).toBe(a);
    const b = { inventoryItemId: 7, referenceType: "purchase", referenceId: null, notes: null };
    expect(withManualReference(b)).toBe(b);
  });
});

describe("foundationTypeToCategory", () => {
  it("بيطابق الأنواع المعروفة وغير المعروف خامة", () => {
    expect(foundationTypeToCategory("finished_good")).toBe("finished_good");
    expect(foundationTypeToCategory("wip")).toBe("wip");
    expect(foundationTypeToCategory("packaging")).toBe("raw_material");
    expect(foundationTypeToCategory("???")).toBe("raw_material");
  });
});
