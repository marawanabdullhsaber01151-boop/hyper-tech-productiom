import { describe, expect, it } from "vitest";
import { focusOf, parseRevisionReason, pipelineSegments, unresolvedFrom, type Kpis } from "./operationsCore";
import { OPERATIONS_ROLES } from "./staffRoles";

const calm: Kpis = { activeCases: 0, atRisk: 0, slaBreached: 0, waitingSales: 0, unassigned: 0, readyToConvert: 0, awaitingClaim: 0, requisitionsPending: 0, transfersPending: 0, exceptionsOpen: 0, overdueOrders: 0 };

describe("الخطوة الأهم", () => {
  it("الهدوء لو مفيش حاجة", () => {
    expect(focusOf(calm)).toEqual({ kind: "calm", count: 0 });
  });
  it("المهلة قبل التحويل قبل الاستلام قبل الاستثناءات قبل الاحتياجات قبل المبيعات قبل غير المعيّنة", () => {
    expect(focusOf({ ...calm, slaBreached: 2, readyToConvert: 5 }).kind).toBe("sla");
    expect(focusOf({ ...calm, readyToConvert: 5, awaitingClaim: 1 }).kind).toBe("convert");
    expect(focusOf({ ...calm, awaitingClaim: 1, exceptionsOpen: 3 })).toEqual({ kind: "claim", count: 1 });
    expect(focusOf({ ...calm, exceptionsOpen: 3, requisitionsPending: 2 }).kind).toBe("exceptions");
    expect(focusOf({ ...calm, requisitionsPending: 2, waitingSales: 1 }).kind).toBe("requisitions");
    expect(focusOf({ ...calm, waitingSales: 1, unassigned: 4 }).kind).toBe("waiting");
    expect(focusOf({ ...calm, unassigned: 4 }).kind).toBe("unassigned");
  });
});

describe("شريط المراحل", () => {
  it("بيشيل الأصفار وبيحسب النسب", () => {
    const s = pipelineSegments({ received: 1, under_validation: 3, converted: 9 });
    expect(s.map((x) => x.status)).toEqual(["received", "under_validation"]);
    expect(s.map((x) => x.pct)).toEqual([25, 75]);
  });
  it("فاضي لو مفيش حالات نشطة", () => {
    expect(pipelineSegments({ converted: 4 })).toEqual([]);
  });
});

describe("سجل النسخ", () => {
  it("بيفصل الكود عن الملاحظة", () => {
    expect(parseRevisionReason("sales_clarification_requested: السعر ناقص")).toEqual({ code: "sales_clarification_requested", note: "السعر ناقص" });
    expect(parseRevisionReason("validation_started")).toEqual({ code: "validation_started", note: "" });
    expect(parseRevisionReason(null)).toEqual({ code: "", note: "" });
  });
});

describe("بنود التحويل الناقصة", () => {
  it("بتقرا التفاصيل الصحيحة وتتجاهل الباقي", () => {
    expect(unresolvedFrom([{ lineId: 1, productName: "س", reason: "none" }, 5, null])).toEqual([{ lineId: 1, productName: "س", reason: "none" }]);
    expect(unresolvedFrom(undefined)).toEqual([]);
  });
});

describe("الصلاحيات", () => {
  it("أدوار الصفحة (فحص مطابقتها للسيرفر والتسجيل في src/lib/operationsCenterCore.test.ts)", () => {
    expect([...OPERATIONS_ROLES]).toEqual(["chairman", "executive_manager", "operations_manager"]);
  });
});
