import { describe, expect, it } from "vitest";
import { breakdownText, cartonsToPieces, qtyBreakdown } from "./qtyBreakdown";

describe("qtyBreakdown", () => {
  it("مضاعف كامل", () => {
    expect(qtyBreakdown(36, 12)).toEqual({ cartons: 3, loose: 0, pieces: 36, per: 12 });
  });
  it("كراتين وباقي", () => {
    expect(qtyBreakdown(41, 12)).toEqual({ cartons: 3, loose: 5, pieces: 41, per: 12 });
  });
  it("أقل من كرتونة أو من غير كرتونة صالحة: null", () => {
    expect(qtyBreakdown(11, 12)).toBeNull();
    expect(qtyBreakdown(36, null)).toBeNull();
    expect(qtyBreakdown(36, 1)).toBeNull();
    expect(qtyBreakdown(36.5, 12)).toBeNull();
  });
  it("النص بيذكر الكراتين والقطع وعدد القطع في الكرتونة", () => {
    const full = breakdownText(qtyBreakdown(36, 12)!);
    expect(full).toContain("3");
    expect(full).toContain("12");
    expect(full).not.toContain("+");
    const part = breakdownText(qtyBreakdown(41, 12)!);
    expect(part).toContain("+");
    expect(part).toContain("5");
  });
  it("تحويل الكراتين لقطع", () => {
    expect(cartonsToPieces(3, 12)).toBe(36);
  });
});
