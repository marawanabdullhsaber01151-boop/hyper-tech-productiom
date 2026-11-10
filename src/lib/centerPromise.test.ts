/** @format */
import { describe, expect, it } from "vitest";
import { hasUsableRouting, pickRoutingVersions } from "./capacityCentersCore";

const routing = [{ operationNo: 10, workCenterId: 1, setupMinutes: 0, runMinutesPerUnit: 2 }];

describe("اختيار نسخة المسار", () => {
  const v = (id: number, over: object = {}) => ({ id, productId: 1, status: "released", effectiveFrom: null, effectiveTo: null, routingSnapshot: [`r${id}`], ...over });
  it("المعتمدة السارية بس، والأحدث بداية سريان تكسب", () => {
    const m = pickRoutingVersions([v(1), v(2, { effectiveFrom: "2026-10-01" }), v(3, { status: "draft" }), v(4, { effectiveFrom: "2027-01-01" }), v(5, { effectiveTo: "2026-01-01" })], "2026-11-08");
    expect(m.get(1)).toEqual(["r2"]);
  });
  it("لو التاريخين متساويين الأكبر رقمًا، ومنتجين منفصلين", () => {
    const m = pickRoutingVersions([v(1), v(2), v(3, { productId: 2 })], "2026-11-08");
    expect(m.get(1)).toEqual(["r2"]);
    expect(m.get(2)).toEqual(["r3"]);
  });
  it("منتج من غير نسخة معتمدة مش موجود", () => {
    expect(pickRoutingVersions([v(1, { status: "draft" })], "2026-11-08").size).toBe(0);
  });
});

describe("المسار الصالح", () => {
  it("لازم عملية بدقايق على مركز معروف", () => {
    const ids = new Set([1]);
    expect(hasUsableRouting(routing, 10, ids)).toBe(true);
    expect(hasUsableRouting([], 10, ids)).toBe(false);
    expect(hasUsableRouting(routing, 10, new Set([9]))).toBe(false);
    expect(hasUsableRouting([{ operationNo: 1, workCenterId: 1 }], 10, ids)).toBe(false);
  });
});
