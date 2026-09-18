/** @format */

import { describe, expect, it } from "vitest";
import { resolveFinalPrice } from "./priceInquiry";

describe("resolveFinalPrice (Phase 6)", () => {
  it("uses the suggested price as-is when sales sends without changing it", () => {
    expect(resolveFinalPrice("120.50", undefined)).toBe("120.50");
    expect(resolveFinalPrice("120.50", null)).toBe("120.50");
    expect(resolveFinalPrice("120.50", "")).toBe("120.50");
  });

  it("uses sales' override when one is provided, even if different from suggested", () => {
    expect(resolveFinalPrice("120.50", "99.00")).toBe("99.00");
  });

  it("uses sales' override even when there was no suggested price at all", () => {
    expect(resolveFinalPrice(null, "150.00")).toBe("150.00");
  });

  it("returns null when there is neither a suggestion nor an override", () => {
    expect(resolveFinalPrice(null, undefined)).toBeNull();
  });
});
