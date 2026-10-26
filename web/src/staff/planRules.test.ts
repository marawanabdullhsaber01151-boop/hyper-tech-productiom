import { describe, expect, it } from "vitest";
import { canSubmitPlan, planDecisionAccess, planTone } from "./planRules";

describe("قواعد اعتماد الخطط", () => {
  it("الإرسال من مسودة لأدوار التشغيل بس", () => {
    expect(canSubmitPlan({ status: "draft", approvalLevel: 1 }, { role: "operations_manager", userId: 1 })).toBe(true);
    expect(canSubmitPlan({ status: "submitted", approvalLevel: 1 }, { role: "operations_manager", userId: 1 })).toBe(false);
    expect(canSubmitPlan({ status: "draft", approvalLevel: 1 }, { role: "storekeeper", userId: 1 })).toBe(false);
  });
  it("مدير التشغيل مايعتمدش خطة مستوى 1، والمدير التنفيذي يعتمد إلا لو هو اللي رفعها", () => {
    const p = { status: "submitted", approvalLevel: 1, submittedBy: 5 };
    expect(planDecisionAccess(p, { role: "operations_manager", userId: 5 })).toEqual({ approve: false, reject: false, needsNote: false });
    expect(planDecisionAccess(p, { role: "executive_manager", userId: 6 }).approve).toBe(true);
    expect(planDecisionAccess(p, { role: "executive_manager", userId: 5 })).toMatchObject({ approve: false, reject: true });
  });
  it("المستوى 2 للرئيس بس، والمستوى 3 بيطلب سبب", () => {
    expect(planDecisionAccess({ status: "submitted", approvalLevel: 2, submittedBy: 1 }, { role: "executive_manager", userId: 2 }).approve).toBe(false);
    expect(planDecisionAccess({ status: "submitted", approvalLevel: 3, submittedBy: 1 }, { role: "chairman", userId: 2 })).toEqual({ approve: true, reject: true, needsNote: true });
  });
  it("حالة غير مرسلة مفيهاش قرار، والألوان واضحة", () => {
    expect(planDecisionAccess({ status: "approved", approvalLevel: 1 }, { role: "chairman", userId: 1 }).approve).toBe(false);
    expect(planTone("approved")).toBe("success");
    expect(planTone("rejected")).toBe("danger");
  });
});
