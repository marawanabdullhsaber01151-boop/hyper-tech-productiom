import { describe, expect, it } from "vitest";
import { cartonHint } from "./cartonCore";

describe("cartonHint", () => {
  it("٣ قطع ناقصة تكمّل كرتونة", () => {
    expect(cartonHint(9, 12, 1)).toEqual({ add: 3, total: 12, cartons: 1 });
    expect(cartonHint(25, 12, 1)).toEqual({ add: 11, total: 36, cartons: 3 });
  });
  it("مضاعف كامل: مفيش اقتراح", () => {
    expect(cartonHint(24, 12, 1)).toBeNull();
  });
  it("من غير كرتونة صالحة: مفيش اقتراح", () => {
    expect(cartonHint(9, null, 1)).toBeNull();
    expect(cartonHint(9, 1, 1)).toBeNull();
    expect(cartonHint(9, 12.5, 1)).toBeNull();
  });
  it("أقل من الحد الأدنى أو كمية فاسدة: مفيش اقتراح (التحقق من الحد الأدنى شغل تاني)", () => {
    expect(cartonHint(5, 12, 10)).toBeNull();
    expect(cartonHint(0, 12, 1)).toBeNull();
    expect(cartonHint(NaN, 12, 1)).toBeNull();
    expect(cartonHint(2.5, 12, 1)).toBeNull();
  });
});
