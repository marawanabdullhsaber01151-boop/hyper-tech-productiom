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
});
