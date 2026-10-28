/** @format */
import { describe, expect, it } from "vitest";
import { MATERIALS_DECIDE_ROLES, checkMaterialsDecision } from "./warehouseDecisionCore";

const requested = [
  { inventoryItemId: 1, materialName: "نحاس", requestedQty: "10.000" },
  { inventoryItemId: 2, materialName: "بلاستيك", requestedQty: "5.000" },
  { inventoryItemId: null, materialName: "ملصق (يدوي)", requestedQty: "2.000" },
];
const enough = { 1: 20, 2: 9 };
const short = { 1: 20, 2: 3 };

describe("قرار المخزن على الخامات", () => {
  it("الرفض من غير سبب مرفوض، وبسبب مقبول", () => {
    expect(checkMaterialsDecision({ action: "reject", requested, availableById: enough })).toMatchObject({ ok: false, code: "REJECT_NEEDS_REASON" });
    expect(checkMaterialsDecision({ action: "reject", comment: " ab ", requested, availableById: enough })).toMatchObject({ ok: false, code: "REJECT_NEEDS_REASON" });
    expect(checkMaterialsDecision({ action: "reject", comment: "الخامة تالفة", requested, availableById: short })).toEqual({ ok: true });
  });
  it("الاعتماد الكامل بيتمنع مع نقص، والرسالة بتسمّي المادة الناقصة", () => {
    const r = checkMaterialsDecision({ action: "approve", requested, availableById: short });
    expect(r).toMatchObject({ ok: false, code: "SHORTAGE_BLOCKS_APPROVE" });
    expect((r as { message: string }).message).toContain("بلاستيك");
    expect((r as { message: string }).message).not.toContain("نحاس");
    expect(checkMaterialsDecision({ action: "approve", requested, availableById: enough })).toEqual({ ok: true });
  });
  it("الاعتماد الكامل: المتاح يساوي المطلوب بالظبط يعدّي", () => {
    expect(checkMaterialsDecision({ action: "approve", requested, availableById: { 1: 10, 2: 5 } })).toEqual({ ok: true });
  });
  it("الجزئي: لازم كمية لكل مادة مرتبطة، والمادة اليدوية مش مطلوبة", () => {
    expect(checkMaterialsDecision({ action: "partial", requested, availableById: short })).toMatchObject({ ok: false, code: "PARTIAL_NEEDS_DECISIONS" });
    expect(checkMaterialsDecision({ action: "partial", requested, availableById: short, decisions: [{ inventoryItemId: 1, materialName: "نحاس", approvedQty: "10" }] })).toMatchObject({ ok: false, code: "PARTIAL_NEEDS_DECISIONS" });
    expect(checkMaterialsDecision({ action: "partial", requested, availableById: short, decisions: [{ inventoryItemId: 1, materialName: "نحاس", approvedQty: "10" }, { inventoryItemId: 2, materialName: "بلاستيك", approvedQty: "3" }] })).toEqual({ ok: true });
  });
  it("الجزئي: كمية سالبة أو حروف أو أكبر من المطلوب أو من المتاح مرفوضة", () => {
    const base = { action: "partial" as const, requested, availableById: short };
    const mk = (a: string, b: string) => [{ inventoryItemId: 1, materialName: "نحاس", approvedQty: a }, { inventoryItemId: 2, materialName: "بلاستيك", approvedQty: b }];
    expect(checkMaterialsDecision({ ...base, decisions: mk("-1", "1") })).toMatchObject({ code: "PARTIAL_QTY_INVALID" });
    expect(checkMaterialsDecision({ ...base, decisions: mk("abc", "1") })).toMatchObject({ code: "PARTIAL_QTY_INVALID" });
    expect(checkMaterialsDecision({ ...base, decisions: mk("11", "1") })).toMatchObject({ code: "PARTIAL_OVER_REQUESTED" });
    expect(checkMaterialsDecision({ ...base, decisions: mk("5", "4") })).toMatchObject({ code: "PARTIAL_OVER_AVAILABLE" });
  });
  it("الجزئي: كله أصفار مرفوض (المفروض رفض بسبب)", () => {
    expect(checkMaterialsDecision({ action: "partial", requested, availableById: short, decisions: [{ inventoryItemId: 1, materialName: "نحاس", approvedQty: "0" }, { inventoryItemId: 2, materialName: "بلاستيك", approvedQty: "0.000" }] })).toMatchObject({ ok: false, code: "PARTIAL_ALL_ZERO" });
  });
  it("الأدوار: بتتطابق مع صلاحية productionWorkflow.warehouseAction الافتراضية", () => {
    expect(MATERIALS_DECIDE_ROLES).toContain("storekeeper");
    expect(MATERIALS_DECIDE_ROLES).not.toContain("production_manager");
  });
});
