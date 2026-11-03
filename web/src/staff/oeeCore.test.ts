import { describe, expect, it } from "vitest";
import { canReadOee, canWriteStoppage, oeeTone, openMinutes, pctLabel, presetRange, rangeError, stoppagePayload, stoppageError } from "./oeeCore";

describe("التوقفات والكفاءة", () => {
  it("الصلاحيات: القراءة أوسع من الكتابة", () => {
    expect(canWriteStoppage("supervisor")).toBe(true);
    expect(canWriteStoppage("executive_manager")).toBe(false);
    expect(canReadOee("executive_manager")).toBe(true);
    expect(canReadOee("storekeeper")).toBe(false);
  });
  it("الفترات الجاهزة شاملة اليوم", () => {
    const now = new Date(2026, 10, 3, 12);
    expect(presetRange("today", now)).toEqual({ from: "2026-11-03", to: "2026-11-03" });
    expect(presetRange("week", now)).toEqual({ from: "2026-10-28", to: "2026-11-03" });
    expect(presetRange("month", now)).toEqual({ from: "2026-10-05", to: "2026-11-03" });
  });
  it("فترة معكوسة أو ناقصة مرفوضة", () => {
    expect(rangeError("2026-11-03", "2026-11-01")).toBe("range");
    expect(rangeError("", "2026-11-01")).toBe("range");
    expect(rangeError("2026-11-01", "2026-11-03")).toBeNull();
  });
  it("القيمة الناقصة بتظهر شرطة مش صفر", () => {
    expect(pctLabel(null)).toBe("—");
    expect(pctLabel(0)).toBe("0%");
    expect(pctLabel(87.5)).toBe("87.5%");
    expect(oeeTone(null)).toBe("neutral");
    expect(oeeTone(90)).toBe("success");
    expect(oeeTone(70)).toBe("warn");
    expect(oeeTone(30)).toBe("danger");
  });
  it("طلب بدء التوقف", () => {
    expect(stoppagePayload(3, "mechanical_failure", "  ")).toEqual({ machineId: 3, reasonCode: "mechanical_failure" });
    expect(stoppagePayload(3, "other", " سير مقطوع ")).toEqual({ machineId: 3, reasonCode: "other", notes: "سير مقطوع" });
    expect(stoppageError("x", ["other"])).toBe("reason");
    expect(stoppageError("other", ["other"])).toBeNull();
  });
  it("مدة التوقف المفتوح", () => {
    expect(openMinutes("2026-11-03T10:00:00Z", Date.parse("2026-11-03T10:45:30Z"))).toBe(45);
    expect(openMinutes("2026-11-03T10:00:00Z", Date.parse("2026-11-03T09:00:00Z"))).toBe(0);
  });
});
