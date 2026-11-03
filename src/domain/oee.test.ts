/** @format */
import { describe, expect, it } from "vitest";
import { addDaysIso, cairoDayStart, calcOee, isIsoDate, overlapMinutes, reportRange, shiftNetMinutes, stoppageMinutes, workingDays } from "./oee";

describe("calcOee", () => {
  it("حالة مثالية بدون توقف وبكفاءة كاملة", () => {
    const r = calcOee({ plannedMinutes: 480, downtimeMinutes: 0, idealMinutes: 480, good: 100, scrap: 0, rework: 0 });
    expect(r).toMatchObject({ availability: 100, performance: 100, quality: 100, oee: 100, runMinutes: 480 });
  });
  it("مثال محسوب: إتاحة 90%، أداء 80%، جودة 95%", () => {
    // مخطط 480، توقف 48 → إتاحة 90%. تشغيل 432، معياري 345.6 → أداء 80%. 95 جيد من 100 → جودة 95%
    const r = calcOee({ plannedMinutes: 480, downtimeMinutes: 48, idealMinutes: 345.6, good: 95, scrap: 3, rework: 2 });
    expect(r.availability).toBe(90);
    expect(r.performance).toBe(80);
    expect(r.quality).toBe(95);
    expect(r.oee).toBe(68.4);
  });
  it("الأداء مايعدّيش 100% حتى لو الزمن المعياري أكبر من الفعلي", () => {
    expect(calcOee({ plannedMinutes: 100, downtimeMinutes: 0, idealMinutes: 500, good: 10, scrap: 0, rework: 0 }).performance).toBe(100);
  });
  it("مفيش زمن معياري أو إنتاج: الأداء والـOEE null مش صفر ولا تخمين", () => {
    const noIdeal = calcOee({ plannedMinutes: 480, downtimeMinutes: 60, idealMinutes: null, good: 50, scrap: 0, rework: 0 });
    expect(noIdeal.availability).toBe(87.5);
    expect(noIdeal.performance).toBeNull();
    expect(noIdeal.oee).toBeNull();
    const noOutput = calcOee({ plannedMinutes: 480, downtimeMinutes: 60, idealMinutes: 0, good: 0, scrap: 0, rework: 0 });
    expect(noOutput.quality).toBeNull();
    expect(noOutput.oee).toBeNull();
  });
  it("توقف أكبر من المخطط بيتقص، ومفيش وقت مخطط = null", () => {
    expect(calcOee({ plannedMinutes: 100, downtimeMinutes: 500, idealMinutes: 0, good: 0, scrap: 0, rework: 0 })).toMatchObject({ availability: 0, runMinutes: 0, downtimeMinutes: 100 });
    expect(calcOee({ plannedMinutes: 0, downtimeMinutes: 0, idealMinutes: 0, good: 0, scrap: 0, rework: 0 }).availability).toBeNull();
  });
});

describe("التوقف والفترات", () => {
  const d = (s: string) => new Date(s);
  it("التداخل مع الفترة، والمفتوح لحد دلوقتي", () => {
    const from = d("2026-11-01T00:00:00Z"), to = d("2026-11-02T00:00:00Z"), now = d("2026-11-03T00:00:00Z");
    expect(overlapMinutes(d("2026-11-01T10:00:00Z"), d("2026-11-01T11:30:00Z"), from, to, now)).toBe(90);
    expect(overlapMinutes(d("2026-10-31T23:00:00Z"), d("2026-11-01T01:00:00Z"), from, to, now)).toBe(60);
    expect(overlapMinutes(d("2026-11-01T22:00:00Z"), null, from, to, now)).toBe(120);
    expect(overlapMinutes(d("2026-11-05T00:00:00Z"), null, from, to, now)).toBe(0);
  });
  it("مدة التوقف تقريب لفوق وأقل دقيقة", () => {
    expect(stoppageMinutes(d("2026-11-01T10:00:00Z"), d("2026-11-01T10:00:10Z"))).toBe(1);
    expect(stoppageMinutes(d("2026-11-01T10:00:00Z"), d("2026-11-01T10:10:01Z"))).toBe(11);
  });
  it("أيام الشغل بتستثني الجمعة، والمدخلات الغلط صفر", () => {
    expect(workingDays("2026-11-01", "2026-11-07")).toBe(6); // الأحد 1 نوفمبر 2026 → السبت 7، فيها جمعة 6
    expect(workingDays("2026-11-01", "2026-11-07", false)).toBe(7);
    expect(workingDays("2026-11-07", "2026-11-01")).toBe(0);
    expect(workingDays("x", "y")).toBe(0);
  });
  it("حدود التقرير: شاملة آخر يوم، ومحدودة بسنة، وبتوقيت القاهرة", () => {
    const r = reportRange("2026-11-01", "2026-11-02")!;
    expect((r.to.getTime() - r.from.getTime()) / 3600000).toBe(48);
    expect(reportRange("2026-11-02", "2026-11-01")).toBeNull();
    expect(reportRange("2024-01-01", "2026-01-01")).toBeNull();
    expect(isIsoDate("2026-02-30")).toBe(false);
    // نوفمبر: التوقيت الشتوي (UTC+2) فبداية اليوم 22:00 UTC اليوم اللي قبله
    expect(cairoDayStart("2026-11-10").toISOString()).toBe("2026-11-09T22:00:00.000Z");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("دقايق الوردية بتعدّي منتصف الليل", () => {
    expect(shiftNetMinutes("08:00", "16:00", 60)).toBe(420);
    expect(shiftNetMinutes("22:00", "06:00", 60)).toBe(420);
    expect(shiftNetMinutes("xx", "06:00", 0)).toBe(0);
  });
});
