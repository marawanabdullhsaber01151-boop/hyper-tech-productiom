import { describe, expect, it } from "vitest";
import {
  addDaysISO, canApprovePlan, canPlan, canSavePreview, duplicateRecipes, emptyLine, explodePayload, lineError, linesValid, normalizeQty, pendingShortages, requisitionsBlockedReason, runActions, runPayload, todayISO,
  type LineDraft, type Preview, type RunDetail,
} from "./planningCore";

const TODAY = "2026-11-02";
const line = (p: Partial<LineDraft> = {}): LineDraft => ({ key: 1, recipeId: "5", qty: "10", requiredBy: "2026-11-20", ...p });
const demand = (id: number, by: string, total = "3.000") => ({
  inventoryItemId: id, code: null, name: `خامة ${id}`, unit: "kg", grossQty: "10.000", requiredBy: by,
  sources: [], stock: { onHand: "5", reserved: "1", quarantine: "0" }, openSupply: { purchaseOrders: "2", requisitions: "1", total },
  result: { freeAvailableQty: "4", netQty: "3", status: "shortage" as const, shortageCode: "x", explanation: "e" },
});
const preview = (over: Partial<Preview> = {}): Preview => ({ demands: [demand(1, "2026-11-10"), demand(2, "2026-11-25")], blockers: [], summary: { demandCount: 2, shortageCount: 2, blockerCount: 0 }, ...over });

describe("planningCore: الأدوار", () => {
  it("التخطيط لأدوار التخطيط، الاعتماد للرئيس ومدير الإنتاج بس", () => {
    expect(canPlan("production_controller")).toBe(true);
    expect(canPlan("sales_manager")).toBe(false);
    expect(canApprovePlan("production_manager")).toBe(true);
    expect(canApprovePlan("warehouse_manager")).toBe(false);
  });
});

describe("planningCore: السطور", () => {
  it("تاريخ اليوم وإضافة الأيام", () => {
    expect(todayISO(new Date(2026, 10, 2))).toBe("2026-11-02");
    expect(addDaysISO("2026-11-25", 10)).toBe("2026-12-05");
    expect(emptyLine(0, TODAY).requiredBy).toBe("2026-11-16");
  });
  it("الأرقام العربية والفاصلة العربية", () => {
    expect(normalizeQty("١٢٫٥")).toBe("12.5");
  });
  it("أخطاء السطر", () => {
    expect(lineError(line(), TODAY)).toBeNull();
    expect(lineError(line({ recipeId: "" }), TODAY)).toBe("recipe");
    expect(lineError(line({ qty: "0" }), TODAY)).toBe("qty");
    expect(lineError(line({ qty: "1.2345" }), TODAY)).toBe("qty");
    expect(lineError(line({ qty: "abc" }), TODAY)).toBe("qty");
    expect(lineError(line({ requiredBy: "2026-11-01" }), TODAY)).toBe("date");
    expect(lineError(line({ requiredBy: "" }), TODAY)).toBe("date");
  });
  it("صلاحية المجموعة وتكرار الوصفة", () => {
    expect(linesValid([], TODAY)).toBe(false);
    expect(linesValid([line(), line({ key: 2, qty: "x" })], TODAY)).toBe(false);
    expect(duplicateRecipes([line(), line({ key: 2 }), line({ key: 3, recipeId: "6" })])).toEqual(["5"]);
  });
  it("جسم الفرد", () => {
    expect(explodePayload([line({ qty: "١٠" })])).toEqual({ lines: [{ bomRecipeId: 5, qty: "10", requiredBy: "2026-11-20" }] });
  });
});

describe("planningCore: المعاينة وحفظ السيناريو", () => {
  it("الحفظ ممنوع مع blockers أو من غير احتياجات", () => {
    expect(canSavePreview(null)).toBe(false);
    expect(canSavePreview(preview())).toBe(true);
    expect(canSavePreview(preview({ blockers: [{ code: "item_unlinked", recipeId: 1, productName: "م", materialName: "غلاف", message: "m" }] }))).toBe(false);
    expect(canSavePreview(preview({ demands: [] }))).toBe(false);
  });
  it("جسم السيناريو: الأفق لأبعد تاريخ والتوريد المفتوح من المعاينة", () => {
    const b = runPayload(preview(), { scenarioCode: "  ", sourceType: "manual", today: TODAY });
    expect(b.scenarioCode).toBe("baseline");
    expect(b.horizonStart).toBe(TODAY);
    expect(b.horizonEnd).toBe("2026-11-25");
    expect(b.demands.length).toBe(2);
    expect(b.demands[0]).toMatchObject({ sourceType: "manual", inventoryItemId: 1, openSupplyQty: "3.000", grossQty: "10.000" });
  });
});

const run = (over: Partial<RunDetail> = {}): RunDetail => ({
  id: 1, runKey: "k", scenarioCode: "s", status: "draft", horizonStart: TODAY, horizonEnd: TODAY, createdAt: TODAY,
  summary: { demandCount: 2, shortageCount: 2, overloadedCount: 0 }, inputs: [], capacityLoads: [], requisitions: [],
  shortageMessages: [
    { id: 1, materialRequirementId: 10, code: "c", message: "m", explanation: "e", recommendedAction: "r" },
    { id: 2, materialRequirementId: 11, code: "c", message: "m", explanation: "e", recommendedAction: "r" },
  ],
  ...over,
});

describe("planningCore: السيناريوهات المحفوظة", () => {
  it("الإجراءات حسب الدور والحالة", () => {
    expect(runActions("production_manager", run())).toEqual(["approve"]);
    expect(runActions("production_controller", run())).toEqual([]);
    expect(runActions("production_manager", run({ status: "approved" }))).toEqual(["release", "requisitions"]);
    expect(runActions("production_controller", run({ status: "approved" }))).toEqual(["requisitions"]);
    expect(runActions("production_manager", run({ status: "released" }))).toEqual(["requisitions"]);
  });
  it("العجز المتبقي من غير طلب شراء", () => {
    const r = run({ status: "approved", requisitions: [{ id: 1, number: "PR-1", materialRequirementId: 10, requestedQty: "3", status: "draft" }] });
    expect(pendingShortages(r).map((s) => s.id)).toEqual([2]);
    expect(runActions("production_controller", run({ status: "approved", requisitions: [r.requisitions[0]!, { ...r.requisitions[0]!, id: 2, materialRequirementId: 11 }] }))).toEqual([]);
  });
  it("سبب قفل الطلبات", () => {
    expect(requisitionsBlockedReason(run())).toBe("notApproved");
    expect(requisitionsBlockedReason(run({ status: "approved" }))).toBeNull();
    expect(requisitionsBlockedReason(run({ shortageMessages: [] }))).toBe("noShortage");
  });
});
