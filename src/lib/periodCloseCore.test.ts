import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLOSE_DAY, canClose, canReopen, closeBodySchema, closeDayFrom, closeDueDate, isLate, periodDueNow, reopenBodySchema, taskDedupeKey, taskDueAt, type PeriodLite,
} from "./periodCloseCore";

const P = (id: number, year: number, month: number, status = "open"): PeriodLite => {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const m = String(month).padStart(2, "0");
  return { id, year, month, startsOn: `${year}-${m}-01`, endsOn: `${year}-${m}-${last}`, status };
};

describe("يوم الإقفال", () => {
  it("الافتراضي 5 والقيمة التالفة أو برّه 1–28 بترجع 5", () => {
    expect(DEFAULT_CLOSE_DAY).toBe(5);
    for (const v of [undefined, null, "", "abc", "0", "29", "-1", "5.5"]) expect(closeDayFrom(v as string), String(v)).toBe(5);
    expect(closeDayFrom("1")).toBe(1);
    expect(closeDayFrom("28")).toBe(28);
    expect(closeDayFrom("10")).toBe(10);
  });
  it("موعد الإقفال في الشهر اللي بعده، وديسمبر بيعدّي للسنة الجاية", () => {
    expect(closeDueDate(2026, 10, 5)).toBe("2026-11-05");
    expect(closeDueDate(2026, 12, 5)).toBe("2027-01-05");
  });
  it("الفترة المطلوبة دلوقتي: بعد يوم الإقفال بس، ويناير بيرجع لديسمبر", () => {
    expect(periodDueNow("2026-11-04", 5)).toBeNull();
    expect(periodDueNow("2026-11-05", 5)).toEqual({ year: 2026, month: 10 });
    expect(periodDueNow("2026-11-20", 5)).toEqual({ year: 2026, month: 10 });
    expect(periodDueNow("2027-01-06", 5)).toEqual({ year: 2026, month: 12 });
  });
  it("المتأخرة: مفتوحة وعدّى موعدها بس", () => {
    expect(isLate(P(1, 2026, 10), 5, "2026-11-06")).toBe(true);
    expect(isLate(P(1, 2026, 10), 5, "2026-11-05")).toBe(false);
    expect(isLate(P(1, 2026, 10, "closed"), 5, "2026-12-01")).toBe(false);
  });
});

describe("قواعد الإقفال", () => {
  it("مينفعش قبل ما الشهر يخلص (حتى آخر يوم فيه)", () => {
    const r = canClose(P(1, 2026, 11), [P(1, 2026, 11)], "2026-11-30");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_ENDED");
    expect(canClose(P(1, 2026, 11), [P(1, 2026, 11)], "2026-12-01").ok).toBe(true);
  });
  it("لازم بالترتيب: فترة أقدم مفتوحة بتمنع", () => {
    const all = [P(1, 2026, 9), P(2, 2026, 10)];
    const r = canClose(all[1]!, all, "2026-11-10");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EARLIER_OPEN");
    expect(canClose(all[0]!, all, "2026-11-10").ok).toBe(true);
  });
  it("فترة أحدث مفتوحة مبتمنعش، والمقفولة مبتتقفلش تاني", () => {
    const all = [P(1, 2026, 9), P(2, 2026, 10)];
    expect(canClose(all[0]!, all, "2026-11-10").ok).toBe(true);
    const r = canClose(P(3, 2026, 9, "closed"), [], "2026-11-10");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ALREADY_CLOSED");
  });
});

describe("قواعد إعادة الفتح", () => {
  it("بالعكس: مينفعش لو في فترة أحدث مقفولة", () => {
    const all = [P(1, 2026, 8, "closed"), P(2, 2026, 9, "closed")];
    const r = canReopen(all[0]!, all);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LATER_CLOSED");
    expect(canReopen(all[1]!, all).ok).toBe(true);
  });
  it("فترة مفتوحة مينفعش تتفتح", () => {
    const r = canReopen(P(1, 2026, 9), []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_CLOSED");
  });
  it("فترة أحدث مفتوحة مبتمنعش الفتح", () => {
    const all = [P(1, 2026, 9, "closed"), P(2, 2026, 10)];
    expect(canReopen(all[0]!, all).ok).toBe(true);
  });
});

describe("المدخلات والمهمة", () => {
  it("السبب مطلوب 3 حروف على الأقل عند الفتح، والملاحظة اختيارية عند الإقفال", () => {
    expect(reopenBodySchema.safeParse({ reason: "غل" }).success).toBe(false);
    expect(reopenBodySchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(reopenBodySchema.safeParse({ reason: "قيد ناقص" }).success).toBe(true);
    expect(closeBodySchema.safeParse({}).success).toBe(true);
    expect(closeBodySchema.safeParse({ note: "x".repeat(301) }).success).toBe(false);
  });
  it("مفتاح المهمة فيه رقم مرات الفتح، والموعد آخر يوم الإقفال بتوقيت القاهرة", () => {
    expect(taskDedupeKey(2026, 10, 0)).toBe("gl_period:2026-10:0");
    expect(taskDedupeKey(2026, 10, 1)).not.toBe(taskDedupeKey(2026, 10, 0));
    expect(taskDueAt(2026, 10, 5).toISOString()).toBe("2026-11-05T21:00:00.000Z");
  });
});
