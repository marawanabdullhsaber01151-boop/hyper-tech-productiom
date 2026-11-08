import { describe, expect, it } from "vitest";
import { defaultRange, displayCell, exportFileName, rangeProblem, reportQuery, STATUS_FILTERS } from "./reportsCore";

describe("فترة التقرير", () => {
  it("بتتحقق من الشكل والترتيب والحد الأقصى", () => {
    expect(rangeProblem("2026-11-01", "2026-11-07")).toBeNull();
    expect(rangeProblem("2026-11-07", "2026-11-07")).toBeNull();
    expect(rangeProblem("", "2026-11-07")).toBe("format");
    expect(rangeProblem("2026-13-01", "2026-13-02")).toBe("format");
    expect(rangeProblem("2026-11-08", "2026-11-07")).toBe("order");
    expect(rangeProblem("2025-11-08", "2026-11-07")).toBeNull();
    expect(rangeProblem("2025-01-01", "2026-11-07")).toBe("long");
  });
  it("الافتراضي آخر 30 يوم وبينتهي النهارده", () => {
    expect(defaultRange(new Date(2026, 10, 7))).toEqual({ from: "2026-10-09", to: "2026-11-07" });
  });
});

describe("طلب التقرير والتصدير", () => {
  it("المخزون من غير فترة، والباقي بفترة وحالة وصيغة", () => {
    expect(reportQuery({ needsRange: false }, "2026-11-01", "2026-11-07", "")).toEqual({});
    expect(reportQuery({ needsRange: true }, "2026-11-01", "2026-11-07", "paid", "xlsx")).toEqual({ from: "2026-11-01", to: "2026-11-07", status: "paid", format: "xlsx" });
  });
  it("اسم الملف زي السيرفر", () => {
    expect(exportFileName("sales", { needsRange: true }, "2026-11-01", "2026-11-07", "xlsx")).toBe("report-sales_2026-11-01_2026-11-07.xlsx");
    expect(exportFileName("inventory", { needsRange: false }, "", "", "csv")).toBe("report-inventory.csv");
  });
  it("فلاتر الحالة", () => {
    expect(STATUS_FILTERS.inventory).toEqual([]);
    expect(STATUS_FILTERS.sales).not.toContain("draft");
  });
});

describe("تنسيق الخلايا", () => {
  it("مبلغ بخانتين وكمية بحد 3 وصحيح", () => {
    expect(displayCell("money", "1234.5")).toBe("1,234.50");
    expect(displayCell("qty", 10.5)).toBe("10.5");
    expect(displayCell("qty", 1234.56789)).toBe("1,234.568");
    expect(displayCell("int", 69.4)).toBe("69");
    expect(displayCell("text", "شركة")).toBe("شركة");
  });
  it("الفاضي والفاسد", () => {
    expect(displayCell("money", null)).toBe("");
    expect(displayCell("money", "abc")).toBe("abc");
    expect(displayCell("qty", "")).toBe("");
  });
});
