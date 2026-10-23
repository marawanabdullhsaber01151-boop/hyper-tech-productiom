import { describe, expect, it } from "vitest";
import { isCatalogPriceOverride } from "./salesPricing";

describe("isCatalogPriceOverride", () => {
  it("نفس السعر بصيغ مختلفة = مش تعديل", () => {
    expect(isCatalogPriceOverride("10", "10.00")).toBe(false);
    expect(isCatalogPriceOverride("10.50", "10.5")).toBe(false);
  });
  it("سعر فاضي أو صفر = استخدم سعر الصنف (مش تعديل)", () => {
    expect(isCatalogPriceOverride("", "25.00")).toBe(false);
    expect(isCatalogPriceOverride("0", "25.00")).toBe(false);
    expect(isCatalogPriceOverride("0.00", "25.00")).toBe(false);
  });
  it("سعر مختلف فعلًا = تعديل", () => {
    expect(isCatalogPriceOverride("20", "25.00")).toBe(true);
    expect(isCatalogPriceOverride("25.01", "25.00")).toBe(true);
  });
});
