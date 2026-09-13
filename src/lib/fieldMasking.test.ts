import { describe, expect, it } from "vitest";
import { maskFields } from "./fieldMasking";

describe("field masking", () => {
  it("keeps sensitive fields for an allowed role", () => {
    expect(maskFields("inventory_items", { unitPrice: "10", supplierId: 2 }, "chairman"))
      .toEqual({ unitPrice: "10", supplierId: 2 });
  });

  it("removes sensitive fields for an unallowed role", () => {
    expect(maskFields("inventory_items", { unitPrice: "10", supplierId: 2 }, "online_seller"))
      .toEqual({});
  });
});