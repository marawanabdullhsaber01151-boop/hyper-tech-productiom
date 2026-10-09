import { describe, expect, it } from "vitest";
import { isV2Enabled } from "./departments";

describe("isV2Enabled", () => {
  it("false لما المتغير فاضي", () => {
    expect(isV2Enabled("orders", undefined)).toBe(false);
    expect(isV2Enabled("orders", "")).toBe(false);
  });
  it("بيطابق اسم الصفحة بالظبط", () => {
    expect(isV2Enabled("orders", "team, orders")).toBe(true);
    expect(isV2Enabled("order", "orders")).toBe(false);
  });
  it("* بيشغّل الكل", () => {
    expect(isV2Enabled("anything", "*")).toBe(true);
  });
});
