import { describe, expect, it } from "vitest";
import { availableTabs, countByStatus, defectSuggestions, directorError, isPositiveQty, ncrOrderOk, partialQtyError, requestActions, canCloseNcr, canCreateRequest } from "./productionRules";

describe("إجراءات طلب الإنتاج حسب الدور والحالة", () => {
  it("المخزن بيقرر بس لما الطلب بانتظاره", () => {
    expect(requestActions("storekeeper", "pending_warehouse")).toEqual(["warehouse_approve", "warehouse_partial", "warehouse_reject"]);
    expect(requestActions("storekeeper", "pending_director")).toEqual([]);
  });
  it("الإدارة بتقرر بعد المخزن، والمشرف يقدر يلغي بس", () => {
    expect(requestActions("production_manager", "pending_director")).toEqual(["director", "cancel"]);
    expect(requestActions("supervisor", "pending_director")).toEqual(["cancel"]);
    expect(requestActions("supervisor", "approved")).toEqual([]);
  });
  it("رئيس المجلس بيعمل كل حاجة", () => {
    expect(requestActions("chairman", "pending_warehouse")).toContain("cancel");
    expect(requestActions("chairman", "pending_warehouse")).toContain("warehouse_reject");
  });
  it("إنشاء الطلب والتبويبات", () => {
    expect(canCreateRequest("supervisor")).toBe(true);
    expect(canCreateRequest("storekeeper")).toBe(false);
    expect(availableTabs("storekeeper")).toEqual(["requests"]);
    expect(availableTabs("production_quality_controller")).toEqual(["orders", "inspect", "quality", "trace"]);
    expect(availableTabs("raw_material_quality_controller")).toEqual(["orders"]);
    expect(availableTabs("supervisor")).toEqual(["requests", "orders", "quality", "trace"]);
    expect(availableTabs("sales_manager")).toEqual(["orders"]);
    expect(availableTabs("online_seller")).toEqual([]);
    expect(canCloseNcr("supervisor")).toBe(false);
    expect(canCloseNcr("production_quality_controller")).toBe(true);
  });
});

describe("الكميات وقرار الإدارة", () => {
  it("الكمية موجبة بحد أقصى 4 خانات عشرية", () => {
    expect(isPositiveQty("12.5")).toBe(true);
    expect(isPositiveQty("0")).toBe(false);
    expect(isPositiveQty("1e3")).toBe(false);
    expect(isPositiveQty("1.23456")).toBe(false);
    expect(isPositiveQty("")).toBe(false);
  });
  it("الكمية الجزئية", () => {
    expect(partialQtyError("5", "10")).toBeNull();
    expect(partialQtyError("10", "10")).toBeNull();
    expect(partialQtyError("11", "10")).toBe("tooMuch");
    expect(partialQtyError("x", "10")).toBe("bad");
  });
  it("الاستثنائي يحتاج كمية والرفض يحتاج سبب", () => {
    expect(directorError("override", "", "")).toBe("qty");
    expect(directorError("override", "4", "")).toBeNull();
    expect(directorError("reject", "", "ab")).toBe("comment");
    expect(directorError("reject", "", "مواد ناقصة")).toBeNull();
    expect(directorError("approve", "", "")).toBeNull();
    expect(directorError("noted", "", "")).toBeNull();
  });
});

describe("أدوات الجودة", () => {
  it("عدّ الحالات", () => {
    expect(countByStatus([{ status: "a" }, { status: "b" }, { status: "a" }])).toEqual({ a: 2, b: 1 });
  });
  it("أوامر ينفع نفتح عليها NCR", () => {
    expect(ncrOrderOk("in_production")).toBe(true);
    expect(ncrOrderOk("new")).toBe(false);
  });
  it("اقتراح أكواد العيوب بالأكثر استخدامًا", () => {
    expect(defectSuggestions([{ defectCode: "خدش" }, { defectCode: "كسر" }, { defectCode: "خدش" }, { defectCode: " " }])).toEqual(["خدش", "كسر"]);
  });
});
