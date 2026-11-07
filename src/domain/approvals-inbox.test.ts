/** @format */
import { describe, expect, it } from "vitest";
import { SLA_WORKING_MINUTES, cairoInstant, decideVerdict, describeImpact, rejectNoteError, slaState, workingMinutesBetween } from "./approvals-inbox";

// 2026-11-04 = الأربعاء، القاهرة UTC+2 (الصيفي انتهى 30 أكتوبر)
const at = (y: number, m: number, d: number, h: number, min = 0) => cairoInstant(y, m, d, h + min / 60);

describe("ساعات العمل", () => {
  it("ساعات عمل نفس اليوم", () => {
    expect(workingMinutesBetween(at(2026, 11, 4, 10), at(2026, 11, 4, 12))).toBe(120);
  });
  it("خارج 9–5 مابيتحسبش", () => {
    expect(workingMinutesBetween(at(2026, 11, 4, 7), at(2026, 11, 4, 9))).toBe(0);
    expect(workingMinutesBetween(at(2026, 11, 4, 16), at(2026, 11, 4, 20))).toBe(60);
  });
  it("عبر الليل: آخر ساعتين + أول ساعتين من اليوم اللي بعده", () => {
    expect(workingMinutesBetween(at(2026, 11, 4, 15), at(2026, 11, 5, 11))).toBe(120 + 120);
  });
  it("الجمعة إجازة: من الخميس 4م للسبت 10ص = ساعة + ساعة", () => {
    expect(workingMinutesBetween(at(2026, 11, 5, 16), at(2026, 11, 7, 10))).toBe(60 + 60);
  });
  it("الترتيب المعكوس = 0، وتوقيت صيفي: الأحد 4 أكتوبر 2026 (+3)", () => {
    expect(workingMinutesBetween(at(2026, 11, 4, 12), at(2026, 11, 4, 10))).toBe(0);
    expect(workingMinutesBetween(at(2026, 10, 4, 10), at(2026, 10, 4, 11))).toBe(60);
  });
});

describe("المهلة", () => {
  it("حالات المهلة", () => {
    expect(slaState(0)).toBe("ok");
    expect(slaState(SLA_WORKING_MINUTES * 0.75 - 1)).toBe("ok");
    expect(slaState(SLA_WORKING_MINUTES * 0.75)).toBe("due_soon");
    expect(slaState(SLA_WORKING_MINUTES)).toBe("overdue");
  });
});

describe("صلاحية القرار", () => {
  const base = { userId: 2, requestedBy: 1, roles: ["sales_manager"], stepRoles: ["sales_manager"], requesterIsSoleApprover: false };
  it("دور معتمد وشخص تاني = يعتمد", () => {
    expect(decideVerdict(base)).toEqual({ canApprove: true, canReject: true, block: null, selfException: false });
  });
  it("من غير الدور = مقفول", () => {
    expect(decideVerdict({ ...base, roles: ["storekeeper"] }).block).toBe("role");
  });
  it("المنشئ ما يعتمدش نفسه لكن يقدر يسحب (يرفض)", () => {
    expect(decideVerdict({ ...base, userId: 1 })).toEqual({ canApprove: false, canReject: true, block: "self", selfException: false });
  });
  it("لو هو الوحيد النشط المعتمد: بيعدّي باستثناء معلّم", () => {
    expect(decideVerdict({ ...base, userId: 1, requesterIsSoleApprover: true })).toEqual({ canApprove: true, canReject: true, block: null, selfException: true });
  });
  it("الرئيس والمدير التنفيذي يعتمدوا طلباتهم عادي (من غير استثناء معلّم)", () => {
    // الإدارة العليا تعتمد حتى لو دورها مش في خطوة السياسة (مثلاً الخطوة لمدير المبيعات أو مدير الإنتاج)
    for (const role of ["chairman", "executive_manager"]) {
      expect(decideVerdict({ ...base, userId: 9, roles: [role], stepRoles: ["production_manager"] })).toEqual({ canApprove: true, canReject: true, block: null, selfException: false });
    }
    for (const role of ["chairman", "executive_manager"]) {
      expect(decideVerdict({ ...base, userId: 1, roles: [role], stepRoles: [role] })).toEqual({ canApprove: true, canReject: true, block: null, selfException: false });
    }
  });
  it("الدور المفوَّض بيتحسب", () => {
    expect(decideVerdict({ ...base, roles: ["storekeeper", "sales_manager"] }).canApprove).toBe(true);
  });
  it("الرفض لازم سبب", () => {
    expect(rejectNoteError("")).toBe(true);
    expect(rejectNoteError("  ا ")).toBe(true);
    expect(rejectNoteError("سعر غلط")).toBe(false);
  });
});

describe("محاكي الأثر", () => {
  it("أمر بيع مؤكد: الرفض بيفك الحجز", () => {
    const r = describeImpact({ resourceType: "sales_order", amount: 1000, metadata: { originalStatus: "confirmed" }, nextStepRoles: null, itemCount: 3 });
    expect(r.approve[0]).toContain("مؤكد");
    expect(r.reject.join(" ")).toContain("الحجز المخزني على 3 بند");
  });
  it("أمر بيع مشحون: الرفض بيرجّع المخزون", () => {
    const r = describeImpact({ resourceType: "sales_order", amount: 1, metadata: { originalStatus: "shipped" }, nextStepRoles: null, itemCount: 2 });
    expect(r.reject.join(" ")).toContain("بترجع للمخزون");
  });
  it("لو فيه خطوة أعلى: الاعتماد بيصعّد بس", () => {
    const r = describeImpact({ resourceType: "sales_order", amount: 1, metadata: { originalStatus: "confirmed" }, nextStepRoles: ["chairman"], itemCount: null });
    expect(r.approve[0]).toContain("خطوة اعتماد أعلى");
  });
  it("تكلفة إنتاج وعام", () => {
    expect(describeImpact({ resourceType: "production_cost_entry", amount: 5, metadata: null, nextStepRoles: null }).reject[0]).toContain("مرفوضة");
    expect(describeImpact({ resourceType: "x", amount: 5, metadata: null, nextStepRoles: null }).approve[0]).toContain("معتمد");
  });
});
