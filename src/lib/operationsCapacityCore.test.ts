import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPACITY_CAP, buildForecast, deliveryPromise, isWorkDay, orderDemandDays, remainingFraction, workDaysFrom } from "./operationsCapacityCore";
import { composeOpsDigest } from "./operationsDigestCore";
import { computeBaseDurationDays } from "./dueDateSuggestion.core";

describe("أيام العمل", () => {
  it("الجمعة إجازة والسبت يوم عمل", () => {
    expect(isWorkDay("2026-10-30")).toBe(false); // جمعة
    expect(isWorkDay("2026-10-31")).toBe(true); // سبت
    expect(workDaysFrom("2026-10-29", 4)).toEqual(["2026-10-29", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("طلب الأمر على المصنع", () => {
  it("بيستخدم نفس صيغة مدة اقتراح تاريخ البوابة، مضروبة في المتبقي حسب المرحلة", () => {
    const base = computeBaseDurationDays({ expectedProductionDays: 4, qty: 20, outputQty: 10 });
    expect(base).toBe(6);
    expect(orderDemandDays({ expectedProductionDays: 4, qty: 20, outputQty: 10, status: "in_production" })).toBe(3);
    expect(orderDemandDays({ expectedProductionDays: null, qty: 1, outputQty: 1, status: "claimed" })).toBe(5);
    expect(remainingFraction("completed")).toBe(0);
    expect(remainingFraction("unknown_status")).toBe(1);
  });
});

describe("توقّع الحمل", () => {
  it("بيجدول الأقرب موعدًا أول وبيحترم سقف 85% لكل خط", () => {
    const f = buildForecast({ demands: [{ days: 3, neededBy: "2026-11-02" }, { days: 2, neededBy: "2026-10-29" }], lines: 1, startIso: "2026-10-26" });
    expect(f.days[0]?.capacity).toBe(CAPACITY_CAP);
    expect(f.days[0]?.load).toBe(1);
    expect(f.queueDays).toBe(5);
    expect(f.lateOrders).toBe(0);
    expect(f.days.some((d) => d.date === "2026-10-30")).toBe(false);
  });
  it("أمر موعده قريب وطلبه كبير بيتعلّم متأخر، ومن غير طلب الحمل صفر", () => {
    const f = buildForecast({ demands: [{ days: 10, neededBy: "2026-10-27" }], lines: 1, startIso: "2026-10-26" });
    expect(f.lateOrders).toBe(1);
    expect(buildForecast({ demands: [], lines: 2, startIso: "2026-10-26" }).utilization).toBe(0);
  });
  it("زيادة الخطوط بتقلّل التحميل", () => {
    const d = [{ days: 8, neededBy: null }];
    expect(buildForecast({ demands: d, lines: 4, startIso: "2026-10-26" }).overloadedDays).toBeLessThan(buildForecast({ demands: d, lines: 1, startIso: "2026-10-26" }).overloadedDays);
  });
});

describe("وعد التسليم", () => {
  it("نطاق مرتب (أقرب ≤ أرجح ≤ أبعد) وحكم حسب الموعد", () => {
    const base = { queueDays: 5, newDays: 5, lines: 2, startIso: "2026-10-26" };
    const p = deliveryPromise({ ...base, dueDate: "2026-11-10" });
    expect(p.earliest <= p.likely && p.likely <= p.latest).toBe(true);
    expect(p.verdict).toBe("ok");
    expect(deliveryPromise({ ...base, dueDate: "2026-11-02" }).verdict).toBe("tight");
    expect(deliveryPromise({ ...base, dueDate: "2026-10-27" }).verdict).toBe("late");
    expect(deliveryPromise({ ...base, dueDate: null }).verdict).toBe("none");
  });
});

describe("الملخص اليومي للتشغيل", () => {
  const zero = { activeCases: 0, atRiskCases: 0, unassigned: 0, awaitingClaim: 0, requisitionsPending: 0, transfersPending: 0, overdueOrders: 0, plansWaiting: 0, utilization: 0.4, overloadedDays: 0, lateOrders: 0 };
  it("لو مفيش حاجة بيطمّن", () => {
    const d = composeOpsDigest(zero);
    expect(d.attention).toBe(0);
    expect(d.title).toContain("تمام");
  });
  it("بيرتّب الأهم الأول وبيعد البنود", () => {
    const d = composeOpsDigest({ ...zero, atRiskCases: 2, plansWaiting: 1, transfersPending: 3 });
    expect(d.attention).toBe(3);
    expect(d.body.split("\n")[1]).toContain("معرّضة للتأخير");
    expect(d.body).toContain("40%");
  });
});

describe("الربط", () => {
  it("المسارات محروسة، والملخص على نفس الـcron من غير cron جديد، واقتراح البوابة لسه بيصدّر نفس الدوال", () => {
    const center = readFileSync("src/routes/operations-center.ts", "utf8");
    expect(center).toContain("/operations-center/capacity");
    expect(center).toContain("/operations-center/cases/:id/promise");
    expect(center.match(/OPERATIONS_MANAGER_PERMISSIONS\.caseView/g)!.length).toBeGreaterThanOrEqual(4);
    expect(readFileSync("src/routes/health.ts", "utf8")).toContain("sendOperationsDigest");
    expect((JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: unknown[] }).crons).toHaveLength(2);
    expect(readFileSync("src/lib/dueDateSuggestion.ts", "utf8")).toContain("export { DEFAULT_BASE_DAYS");
    expect(readFileSync("src/lib/operationsDigest.ts", "utf8")).toContain("OPS_DIGEST_DEDUPE_HOURS");
  });
});
