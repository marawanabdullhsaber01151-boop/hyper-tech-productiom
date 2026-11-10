import { describe, expect, it } from "vitest";
import { daysLeft, emptyForm, formEstimate, formFromQuote, formIssues, lineEstimate, statusTone, toPayload, type Quote } from "./quotesCore";

const base = { customerId: "5", validUntil: "2026-12-01", notes: "", lines: [{ key: 1, bomRecipeId: "7", qty: "100", unitPrice: "12.5" }] };

describe("quotesCore", () => {
  it("نموذج سليم من غير مشاكل", () => expect(formIssues(base)).toEqual([]));
  it("نموذج فاضي بيطلّع العميل والمنتج والكمية والسعر", () => {
    expect(formIssues(emptyForm("2026-12-01")).sort()).toEqual(["customer", "price", "product", "qty"]);
  });
  it("منتج متكرر وسعر صفر وكمية بصفر", () => {
    const f = { ...base, lines: [base.lines[0]!, { key: 2, bomRecipeId: "7", qty: "0", unitPrice: "0" }] };
    expect(formIssues(f).sort()).toEqual(["duplicate", "price", "qty"]);
  });
  it("بدون سطور وتاريخ ناقص", () => {
    expect(formIssues({ ...base, lines: [], validUntil: "" }).sort()).toEqual(["date", "noLines"]);
  });
  it("الحمولة أرقام صحيحة ونصوص مقصوصة", () => {
    expect(toPayload({ ...base, notes: "  ملاحظة  " })).toEqual({ portalCustomerId: 5, validUntil: "2026-12-01", notes: "ملاحظة", lines: [{ bomRecipeId: 7, qty: "100", unitPrice: "12.5" }] });
  });
  it("التقدير لأقرب قرش", () => {
    expect(lineEstimate("3", "0.335")).toBe(1.01);
    expect(formEstimate({ ...base, lines: [...base.lines, { key: 2, bomRecipeId: "8", qty: "2", unitPrice: "1.1" }] })).toBe(1252.2);
    expect(lineEstimate("x", "1")).toBe(0);
  });
  it("الألوان والأيام", () => {
    expect(statusTone("ordered")).toBe("success");
    expect(statusTone("expired")).toBe("warn");
    expect(daysLeft("2026-11-20", "2026-11-10")).toBe(10);
    expect(daysLeft("2026-11-09", "2026-11-10")).toBe(-1);
  });
  it("التعديل بيرجّع نفس بيانات العرض", () => {
    const q = { portalCustomerId: 5, validUntil: "2026-12-01", notes: null, lines: [{ bomRecipeId: 7, productName: "س", qty: "100", unitPrice: "12.50" }] } as unknown as Quote;
    expect(formFromQuote(q).lines[0]).toEqual({ key: 1, bomRecipeId: "7", qty: "100", unitPrice: "12.50" });
  });
});
