/** @format */
import { describe, expect, it } from "vitest";
import { describeAudit, formatAuditTime } from "./auditNarrative";

const base = { resourceType: "x", resourceId: 7, actorName: "أحمد", createdAt: new Date("2026-10-12T05:13:00Z") };

describe("سجل التدقيق بالعربي", () => {
  it("الوقت بتوقيت القاهرة لحد الدقيقة", () => {
    expect(formatAuditTime(new Date("2026-10-12T05:13:00Z"))).toBe("2026/10/12 08:13 ص");
    expect(formatAuditTime(new Date("2026-10-12T17:05:00Z"))).toBe("2026/10/12 08:05 م");
  });
  it("حدث معروف باسم الشركة", () => {
    const s = describeAudit({ ...base, actionKey: "portal.application.approved", afterData: { application: { companyName: "النور" } } });
    expect(s).toBe("أحمد وافق على طلب انضمام «النور»");
  });
  it("مسار خام بيتحوّل لجملة", () => {
    const s = describeAudit({ ...base, actionKey: "post /api/v1/portal-companies/7/members/3/suspend" }, { companies: new Map([[7, "الأمل"]]) });
    expect(s).toBe("أحمد أوقف موظف في شركة «الأمل»");
  });
  it("حدث مرفوض بيتعلّم، ومجهول بيتكتب بشكل مفهوم", () => {
    expect(describeAudit({ ...base, actionKey: "sales.delete", decision: "rejected" })).toContain("ماتنفّذش");
    expect(describeAudit({ ...base, actionKey: "post /foundation/items/4" })).toContain("بيانات الأساس");
  });
  it("الدور بيظهر جنب الاسم لو متوفر", () => {
    expect(describeAudit({ ...base, actionKey: "sales.approve", actorRoleLabel: "مدير المبيعات" })).toBe("أحمد (مدير المبيعات) اعتمد أمر بيع");
  });
  it("أحداث الإنتاج والمشتريات بجمل مفهومة، ومفيش مفتاح تقني بيظهر", () => {
    expect(describeAudit({ ...base, actionKey: "production.stoppage.start" })).toBe("أحمد سجّل توقف ماكينة");
    expect(describeAudit({ ...base, actionKey: "purchases.approved" })).toBe("أحمد اعتمد أمر شراء");
    expect(describeAudit({ ...base, actionKey: "purchases.partially_received" })).toBe("أحمد غيّر حالة أمر شراء");
    expect(describeAudit({ ...base, actionKey: "production.lifecycle.completed" })).toBe("أحمد غيّر مرحلة أمر إنتاج");
    expect(describeAudit({ ...base, actionKey: "zzz.unknown.thing" })).toBe("أحمد نفّذ إجراء في النظام");
    expect(describeAudit({ ...base, actionKey: "zzz.unknown.thing" })).not.toContain("zzz");
  });
});
