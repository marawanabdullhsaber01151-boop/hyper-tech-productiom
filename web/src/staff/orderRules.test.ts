import { describe, expect, it } from "vitest";
import { canEditNeededBy, partialQtyError, stageIndex, countByStatus, createError, groupOf, isOverdue, isWaitingForRole, leastLoaded, orderActions, receiveError } from "./orderRules";

describe("إجراءات أمر الإنتاج حسب الدور والحالة", () => {
  it("الاستلام عند claimed لمدير الإنتاج بس (مش new)", () => {
    expect(orderActions("production_manager", "claimed")).toContain("receive");
    expect(orderActions("production_manager", "new")).not.toContain("receive");
    expect(orderActions("hr", "claimed")).not.toContain("receive");
  });
  it("الإلغاء للإدارة العليا ومش بعد التسليم", () => {
    expect(orderActions("executive_manager", "in_production")).toContain("cancel");
    expect(orderActions("executive_manager", "delivered_customer")).not.toContain("cancel");
    expect(orderActions("production_manager", "in_production")).not.toContain("cancel");
  });
  it("تأكيد التسليم للعميل للاتش آر، وللمخزن لمدير المخازن", () => {
    expect(orderActions("hr", "delivery_pending_customer")).toContain("confirm");
    expect(orderActions("hr", "delivery_pending_warehouse")).not.toContain("confirm");
    expect(orderActions("warehouse_manager", "delivery_pending_warehouse")).toContain("confirm");
  });
  it("التسليم بعد الاكتمال لمدير الإنتاج", () => {
    expect(orderActions("production_manager", "completed")).toContain("deliver");
    expect(orderActions("supervisor", "completed")).not.toContain("deliver");
  });
});

describe("مراحل التنفيذ", () => {
  it("المشرف ينقل الأمر للمرحلة التالية وهو قيد التنفيذ بس", () => {
    expect(orderActions("supervisor", "in_production")).toContain("advance");
    expect(orderActions("supervisor", "quality_check")).not.toContain("advance");
    expect(orderActions("hr", "in_production")).not.toContain("advance");
    expect(stageIndex(null)).toBe(0);
    expect(stageIndex("assembly_packing")).toBe(2);
    expect(stageIndex("غلط")).toBe(0);
  });
});

describe("إجراءات دورة الحياة", () => {
  it("الإرسال للتنفيذ بعد اعتماد المواد لمدير الإنتاج", () => {
    expect(orderActions("production_manager", "materials_approved")).toContain("dispatch");
    expect(orderActions("production_manager", "materials_partial")).toContain("dispatch");
    expect(orderActions("supervisor", "materials_approved")).not.toContain("dispatch");
  });
  it("التعليق والاستئناف وإعادة التشغيل والجزئي حسب الحالة", () => {
    expect(orderActions("supervisor", "in_production")).toEqual(expect.arrayContaining(["hold", "rework", "partial"]));
    expect(orderActions("supervisor", "held")).toEqual(expect.arrayContaining(["resume", "rework"]));
    expect(orderActions("supervisor", "held")).not.toContain("partial");
    expect(orderActions("supervisor", "rework")).not.toContain("rework");
    expect(orderActions("hr", "in_production")).toEqual([]);
  });
  it("التصحيح بعد الاكتمال لأدوار محددة فقط", () => {
    expect(orderActions("production_manager", "completed")).toContain("correct");
    expect(orderActions("quality_engineer", "delivered_customer")).toEqual(["correct"]);
    expect(orderActions("supervisor", "completed")).not.toContain("correct");
  });
  it("الكمية الجزئية أقل من كمية الأمر", () => {
    expect(partialQtyError("5", "10")).toBeNull();
    expect(partialQtyError("10", "10")).toBe("tooMuch");
    expect(partialQtyError("0", "10")).toBe("bad");
  });
});

describe("تعديل الموعد وفلتر الانتظار", () => {
  it("صاحب الطلب بس يعدّل، وقبل الحالة النهائية", () => {
    expect(canEditNeededBy(5, { workflowStatus: "claimed", createdById: 5 })).toBe(true);
    expect(canEditNeededBy(6, { workflowStatus: "claimed", createdById: 5 })).toBe(false);
    expect(canEditNeededBy(5, { workflowStatus: "cancelled", createdById: 5 })).toBe(false);
    expect(canEditNeededBy(undefined, { workflowStatus: "claimed", createdById: 5 })).toBe(false);
  });
  it("ينتظر إجراء الدور", () => {
    expect(isWaitingForRole("supervisor", "in_production")).toBe(true);
    expect(isWaitingForRole("hr", "in_production")).toBe(false);
    expect(isWaitingForRole("production_manager", "claimed")).toBe(true);
  });
});

describe("حسابات مساعدة", () => {
  it("التأخير بيتحسب بس لغير النهائي", () => {
    expect(isOverdue("2026-10-01", "in_production", "2026-10-20")).toBe(true);
    expect(isOverdue("2026-10-01", "delivered_customer", "2026-10-20")).toBe(false);
    expect(isOverdue("2026-10-25", "claimed", "2026-10-20")).toBe(false);
    expect(isOverdue(null, "claimed", "2026-10-20")).toBe(false);
  });
  it("الاقتراح التلقائي بياخد الأقل حِملًا", () => {
    expect(leastLoaded([{ id: 1, activeCount: 4 }, { id: 2, activeCount: 1 }, { id: 3, activeCount: 1 }])?.id).toBe(2);
    expect(leastLoaded([])).toBeUndefined();
  });
  it("تحقق الاستلام والإنشاء", () => {
    const ok = { supervisorId: "1", qcId: "2", line: "خط 1", startDate: "2026-10-27", operational: "running", pendingReason: "" };
    expect(receiveError(ok)).toBeNull();
    expect(receiveError({ ...ok, supervisorId: "" })).toBe("supervisor");
    expect(receiveError({ ...ok, operational: "pending" })).toBe("pending");
    expect(createError({ recipeId: "1", qty: "10", customer: "شركة", neededBy: "2026-11-01" })).toBeNull();
    expect(createError({ recipeId: "1", qty: "0", customer: "شركة", neededBy: "2026-11-01" })).toBe("qty");
    expect(createError({ recipeId: "1", qty: "1,5", customer: "شركة", neededBy: "2026-11-01" })).toBe("qty");
  });
  it("تجميع الحالات", () => {
    expect(countByStatus([{ workflowStatus: "new" }, { workflowStatus: "new" }, { workflowStatus: "completed" }])).toEqual({ new: 2, completed: 1 });
    expect(groupOf("claimed")).toBe("waiting");
    expect(groupOf("in_production")).toBe("inProgress");
    expect(groupOf("delivered_warehouse")).toBe("done");
  });
});
