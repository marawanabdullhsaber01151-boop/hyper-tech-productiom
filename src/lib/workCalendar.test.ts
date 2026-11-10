/** @format */
import { describe, expect, it } from "vitest";
import { buildCenterSchedule } from "./capacityCentersCore";
import { DEFAULT_CALENDAR, buildForecast, calendarFrom, deliveryPromise, isWorkDay, workDaysFrom } from "./operationsCapacityCore";
import { holidayIssue, holidayWindowStart, isRealDate } from "./workHolidays";

describe("تقويم العمل", () => {
  it("الافتراضي: الجمعة إجازة والباقي شغل (زي السلوك القديم)", () => {
    expect(isWorkDay("2026-11-13")).toBe(false); // جمعة
    expect(isWorkDay("2026-11-14")).toBe(true); // سبت
    expect(workDaysFrom("2026-11-12", 3)).toEqual(["2026-11-12", "2026-11-14", "2026-11-15"]);
  });
  it("إجازة أسبوعية تانية بتتخطى كمان", () => {
    const cal = calendarFrom({ offDay: 5, offDay2: "6", holidays: [] });
    expect(workDaysFrom("2026-11-12", 3, cal)).toEqual(["2026-11-12", "2026-11-15", "2026-11-16"]);
  });
  it("«من غير» أو نفس يوم الإجازة الأولى = يوم واحد بس", () => {
    expect(calendarFrom({ offDay: 5, offDay2: "none", holidays: [] }).offDays).toEqual([5]);
    expect(calendarFrom({ offDay: 5, offDay2: "5", holidays: [] }).offDays).toEqual([5]);
    expect(calendarFrom({ offDay: 5, offDay2: "x", holidays: [] }).offDays).toEqual([5]);
  });
  it("العطلة بتتخطى زي الإجازة", () => {
    const cal = calendarFrom({ offDay: 5, offDay2: "none", holidays: ["2026-11-15"] });
    expect(isWorkDay("2026-11-15", cal)).toBe(false);
    expect(workDaysFrom("2026-11-14", 2, cal)).toEqual(["2026-11-14", "2026-11-16"]);
  });
});

describe("السعة بالإعدادات", () => {
  const centers = [{ id: 1, code: "MIX", name: "الخلط", dailyMinutes: 480 }];
  const order = { id: 1, orderNumber: "WF-1", productName: "م", neededBy: null, qty: 300, status: "released", routing: [{ operationNo: 10, workCenterId: 1, setupMinutes: 0, runMinutesPerUnit: 2 }] }; // 600 دقيقة
  it("سقف 100% = 480 في اليوم، فالـ600 بتخلص في يومين", () => {
    const r = buildCenterSchedule({ orders: [order], centers, startIso: "2026-11-08", cap: 1 });
    expect(r.centers[0]?.days[0]).toMatchObject({ used: 480, capacity: 480 });
    expect(r.orders[0]?.finish).toBe("2026-11-09");
  });
  it("سقف 50% = 240 في اليوم، فالـ600 بتحتاج 3 أيام", () => {
    const r = buildCenterSchedule({ orders: [order], centers, startIso: "2026-11-08", cap: 0.5 });
    expect(r.orders[0]?.finish).toBe("2026-11-10");
  });
  it("العطلة بتأخّر التاريخ المتوقع", () => {
    const cal = calendarFrom({ offDay: 5, offDay2: "none", holidays: ["2026-11-09"] });
    const r = buildCenterSchedule({ orders: [order], centers, startIso: "2026-11-08", cap: 1, calendar: cal });
    expect(r.orders[0]?.finish).toBe("2026-11-10"); // 9 عطلة
    expect(r.centers[0]?.days.map((d) => d.date).slice(0, 3)).toEqual(["2026-11-08", "2026-11-10", "2026-11-11"]);
  });
  it("الإجمالي العام والوعد بيحترموا السقف والتقويم", () => {
    const f = buildForecast({ demands: [{ days: 2, neededBy: null }], lines: 1, startIso: "2026-11-08", cap: 1 });
    expect(f.days[0]?.capacity).toBe(1);
    const p1 = deliveryPromise({ queueDays: 0, newDays: 2, lines: 1, startIso: "2026-11-12", dueDate: null });
    const cal = calendarFrom({ offDay: 5, offDay2: "6", holidays: [] });
    const p2 = deliveryPromise({ queueDays: 0, newDays: 2, lines: 1, startIso: "2026-11-12", dueDate: null, calendar: cal });
    expect(p2.likely > p1.likely).toBe(true);
    expect(DEFAULT_CALENDAR.offDays).toEqual([5]);
  });
});

describe("تحقق العطلات", () => {
  it("تاريخ حقيقي بس", () => {
    expect(isRealDate("2026-11-09")).toBe(true);
    for (const x of ["2026-02-30", "2026-13-01", "9/11/2026", "", "2026-1-1"]) expect(isRealDate(x)).toBe(false);
  });
  it("السبب حرفين على الأقل، والتاريخ مش بعيد أوي", () => {
    const today = "2026-11-09";
    expect(holidayIssue("2026-12-25", "عيد", today)).toBeNull();
    expect(holidayIssue("2026-12-25", "ع", today)).not.toBeNull();
    expect(holidayIssue("2026-12-25", "x".repeat(121), today)).not.toBeNull();
    expect(holidayIssue("2024-01-01", "قديم", today)).not.toBeNull();
    expect(holidayIssue("2030-01-01", "بعيد", today)).not.toBeNull();
    expect(holidayIssue("2026-02-30", "غلط", today)).not.toBeNull();
  });
  it("القايمة بتبدأ من 30 يوم فاتت", () => {
    expect(holidayWindowStart("2026-11-09")).toBe("2026-10-10");
  });
});
