import { describe, expect, it } from "vitest";
import {
  foundationConversionSchema,
  foundationLocationSchema,
  foundationShiftSchema,
} from "./foundation";

describe("Foundation validation", () => {
  it("rejects zero and same-unit conversions", () => {
    expect(() =>
      foundationConversionSchema.parse({
        itemId: 1,
        fromUnit: "kg",
        toUnit: "kg",
        factor: "0",
      }),
    ).toThrow();
  });

  it("accepts a positive conversion factor", () => {
    expect(
      foundationConversionSchema.parse({
        itemId: 1,
        fromUnit: "box",
        toUnit: "piece",
        factor: "12",
      }).factor,
    ).toBe("12");
  });

  it("rejects impossible shift times", () => {
    expect(() =>
      foundationShiftSchema.parse({
        code: "NIGHT",
        name: "Night",
        startTime: "25:00",
        endTime: "08:00",
      }),
    ).toThrow();
  });

  it("uses the API field name for location type", () => {
    expect(
      foundationLocationSchema.parse({
        code: "WH-1",
        name: "Main warehouse",
        locationType: "warehouse",
      }).locationType,
    ).toBe("warehouse");
  });
});