import { describe, expect, it } from "vitest";
import { approveBlocked, canApproveEngineering, canDecideChange, canEditEngineering, changeError, changePayload, componentError, componentPayload, decideBlockReason, decisionReasonOk, isEditableStatus, machinesFor, nextLineNo, nextOperationNo, operationError, operationPayload, productError, routingRunTotal, versionActions, versionPayload, type ComponentForm, type OperationForm } from "./engineeringCore";

const C = (o: Partial<ComponentForm> = {}): ComponentForm => ({ lineNo: 1, componentType: "raw_material", itemId: "5", subProductId: "", qty: "2.5", unit: "kg", scrap: "", alternateGroup: "", notes: "", ...o });
const O = (o: Partial<OperationForm> = {}): OperationForm => ({ operationNo: "10", name: "تجميع", workCenterId: "", machineId: "", setupMinutes: "", runMinutes: "", workers: "", qualityPoint: false, safety: "", ...o });

describe("أدوار الهندسة", () => {
  it("التحرير لأربعة أدوار، والاعتماد لثلاثة (مش مسؤول التحكم)", () => {
    expect(canEditEngineering("production_controller")).toBe(true);
    expect(canApproveEngineering("production_controller")).toBe(false);
    expect(canApproveEngineering("production_quality_controller")).toBe(true);
    expect(canEditEngineering("supervisor")).toBe(false);
  });
});

describe("إجراءات الإصدار حسب الدور والحالة", () => {
  const v = (status: string, validationStatus = "not_validated") => ({ status, validationStatus });
  it("المسودة: المحرر يفحص ويرسل للمراجعة بس", () => {
    expect(versionActions("production_controller", v("draft"))).toEqual(["validate", "submitReview"]);
  });
  it("قيد المراجعة: المعتمد يعتمد، والمحرر مالوش اعتماد", () => {
    expect(versionActions("production_manager", v("in_review"))).toEqual(["validate", "approve"]);
    expect(versionActions("production_controller", v("in_review"))).toEqual(["validate"]);
  });
  it("المعتمد يصدر، والمُصدر يُستبدل أو يُوقف، والمستبدل يُوقف", () => {
    expect(versionActions("chairman", v("approved"))).toEqual(["release"]);
    expect(versionActions("chairman", v("released"))).toEqual(["supersede", "retire"]);
    expect(versionActions("chairman", v("superseded"))).toEqual(["retire"]);
    expect(versionActions("chairman", v("retired"))).toEqual([]);
  });
  it("الإصدار المجمّد مفيش عليه تعديل", () => {
    expect(isEditableStatus("released")).toBe(false);
    expect(isEditableStatus("in_review")).toBe(true);
  });
  it("الاعتماد مقفول بدون فحص ناجح", () => {
    expect(approveBlocked(v("in_review", "not_validated"))).toBe(true);
    expect(approveBlocked(v("in_review", "failed"))).toBe(true);
    expect(approveBlocked(v("in_review", "passed"))).toBe(false);
  });
});

describe("الترقيم التلقائي", () => {
  it("رقم السطر = أكبر + 1، والعملية بخطوة 10", () => {
    expect(nextLineNo([])).toBe(1);
    expect(nextLineNo([{ lineNo: 1 }, { lineNo: 4 }])).toBe(5);
    expect(nextOperationNo([])).toBe(10);
    expect(nextOperationNo([{ operationNo: 10 }, { operationNo: 20 }])).toBe(30);
    expect(nextOperationNo([{ operationNo: 15 }])).toBe(20);
  });
});

describe("مكوّن الإصدار", () => {
  it("لازم مصدر واحد: صنف للخامة ومنتج فرعي للتجميعة", () => {
    expect(componentError(C({ itemId: "" }))).toBe("source");
    expect(componentError(C({ componentType: "sub_assembly", itemId: "5", subProductId: "" }))).toBe("source");
    expect(componentError(C({ componentType: "sub_assembly", subProductId: "3" }))).toBeNull();
  });
  it("الكمية موجبة بحد أقصى 4 خانات عشرية، والهالك 0–100", () => {
    for (const q of ["", "0", "-1", "1e3", "1.23456", "abc"]) expect(componentError(C({ qty: q }))).toBe("qty");
    expect(componentError(C({ unit: "" }))).toBe("unit");
    expect(componentError(C({ scrap: "101" }))).toBe("scrap");
    expect(componentError(C({ scrap: "x" }))).toBe("scrap");
    expect(componentError(C({ scrap: "2.5" }))).toBeNull();
  });
  it("الجسم يبعت مصدر واحد بس، والبديل يتعلّم تلقائي", () => {
    expect(componentPayload(C())).toEqual({ lineNo: 1, componentType: "raw_material", foundationItemId: 5, qty: "2.5", unit: "kg", scrapFactorPct: "0", isAlternate: false });
    const sub = componentPayload(C({ componentType: "sub_assembly", subProductId: "3", itemId: "5" }));
    expect(sub).toMatchObject({ subAssemblyProductId: 3 });
    expect("foundationItemId" in sub).toBe(false);
    expect(componentPayload(C({ componentType: "substitute", alternateGroup: " A " }))).toMatchObject({ isAlternate: true, alternateGroup: "A" });
  });
});

describe("عملية مسار التشغيل", () => {
  it("رقم العملية موجب وغير مكرر، والاسم مطلوب", () => {
    for (const n of ["", "0", "-5", "1.5", "x"]) expect(operationError(O({ operationNo: n }))).toBe("operationNo");
    expect(operationError(O(), [10, 20])).toBe("operationNo");
    expect(operationError(O({ name: " " }))).toBe("name");
    expect(operationError(O())).toBeNull();
  });
  it("الأزمنة والعمال أرقام صحيحة", () => {
    expect(operationError(O({ setupMinutes: "1.5" }))).toBe("setup");
    expect(operationError(O({ runMinutes: "abc" }))).toBe("run");
    expect(operationError(O({ workers: "0" }))).toBe("workers");
    expect(operationError(O({ setupMinutes: "15", runMinutes: "2.5", workers: "3" }))).toBeNull();
  });
  it("الجسم: الافتراضيات والاختياري", () => {
    expect(operationPayload(O())).toEqual({ operationNo: 10, name: "تجميع", setupMinutes: 0, runMinutesPerUnit: "0", workersRequired: 1, qualityPoint: false });
    expect(operationPayload(O({ workCenterId: "2", machineId: "7", qualityPoint: true, safety: " نظارات " }))).toMatchObject({ workCenterId: 2, machineId: 7, qualityPoint: true, safetyInstructions: "نظارات" });
  });
  it("الماكينات بتتفلتر على مركز العمل، وإجمالي التشغيل", () => {
    const m = [{ id: 1, workCenterId: 2 }, { id: 2, workCenterId: 3 }, { id: 3, workCenterId: null }];
    expect(machinesFor(m, "2").map((x) => x.id)).toEqual([1]);
    expect(machinesFor(m, "").length).toBe(3);
    expect(routingRunTotal([{ runMinutesPerUnit: "1.5" }, { runMinutesPerUnit: "0.25" }])).toBe(1.75);
  });
});

describe("منتج وإصدار وطلب تغيير", () => {
  it("المنتج: كود واسم ووحدة", () => {
    expect(productError({ code: "", name: "x", productType: "finished", baseUnit: "قطعة", description: "" })).toBe("code");
    expect(productError({ code: "A", name: " ", productType: "finished", baseUnit: "قطعة", description: "" })).toBe("name");
    expect(productError({ code: "A", name: "x", productType: "finished", baseUnit: "", description: "" })).toBe("unit");
  });
  it("الإصدار الجديد مسودة فاضية (القوائم من الجداول مش من الـsnapshot)", () => {
    expect(versionPayload(" V1.0 ", "", "")).toEqual({ version: "V1.0", bomSnapshot: [], routingSnapshot: [], specifications: {} });
  });
  it("طلب التغيير: منتج وعنوان وسبب", () => {
    expect(changeError({ productId: "", versionId: "", title: "t", reason: "r", impact: "" })).toBe("product");
    expect(changeError({ productId: "1", versionId: "", title: "", reason: "r", impact: "" })).toBe("title");
    expect(changeError({ productId: "1", versionId: "", title: "t", reason: " ", impact: "" })).toBe("reason");
    expect(changePayload({ productId: "1", versionId: "4", title: " t ", reason: " r ", impact: "" })).toEqual({ productId: 1, productVersionId: 4, title: "t", reason: "r" });
  });
  it("البت: دور اعتماد + مفتوح + مش صاحب الطلب", () => {
    const c = { status: "open", requestedBy: 7 };
    expect(canDecideChange("production_manager", 8, c)).toBe(true);
    expect(canDecideChange("production_manager", 7, c)).toBe(false);
    expect(canDecideChange("production_controller", 8, c)).toBe(false);
    expect(canDecideChange("production_manager", 8, { status: "approved", requestedBy: 7 })).toBe(false);
    expect(decideBlockReason("production_manager", 7, c)).toBe("own");
    expect(decideBlockReason("production_manager", 8, { status: "rejected", requestedBy: 7 })).toBe("closed");
    expect(decideBlockReason("production_controller", 7, c)).toBeNull();
    expect(decisionReasonOk("ab")).toBe(false);
    expect(decisionReasonOk("سبب كافي")).toBe(true);
  });
});
