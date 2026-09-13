import { describe, expect, it } from "vitest";
import {
  compareDecimalQuantities,
  divideDecimalQuantities,
  maxZeroDecimalQuantity,
  multiplyDecimalQuantities,
  subtractDecimalQuantities,
} from "./decimal-quantity";

describe("decimal quantity arithmetic", () => {
  it("does not use binary floating point for BOM quantities", () => {
    expect(multiplyDecimalQuantities("0.1", "0.2")).toBe("0.02");
    expect(divideDecimalQuantities("1", "3")).toBe("0.333333");
    expect(subtractDecimalQuantities("10.000", "2.125")).toBe("7.875");
  });

  it("keeps shortages non-negative and compares exact decimal values", () => {
    expect(maxZeroDecimalQuantity("-0.001")).toBe("0");
    expect(compareDecimalQuantities("2.500", "2.5")).toBe(0);
    expect(compareDecimalQuantities("2.501", "2.5")).toBe(1);
  });
});