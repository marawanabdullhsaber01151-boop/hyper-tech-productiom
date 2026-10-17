/** @format */

import { describe, expect, it } from "vitest";
import { resolveTrustProxy } from "./trustProxy";

describe("resolveTrustProxy", () => {
  it("افتراضيًا: بروكسي واحد على Vercel/الإنتاج، ولا شيء محليًا", () => {
    expect(resolveTrustProxy({ NODE_ENV: "production" })).toBe(1);
    expect(resolveTrustProxy({ VERCEL: "1" })).toBe(1);
    expect(resolveTrustProxy({ NODE_ENV: "development" })).toBe(false);
    expect(resolveTrustProxy({})).toBe(false);
  });
  it("بيحترم القيمة الصريحة", () => {
    expect(resolveTrustProxy({ TRUST_PROXY: "2" })).toBe(2);
    expect(resolveTrustProxy({ TRUST_PROXY: "false", NODE_ENV: "production" })).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: "loopback, 10.0.0.0/8" })).toBe("loopback, 10.0.0.0/8");
  });
  it("بيرفض true لأنه بيصدّق أي هيدر من العميل", () => {
    expect(() => resolveTrustProxy({ TRUST_PROXY: "true" })).toThrow();
    expect(() => resolveTrustProxy({ TRUST_PROXY: "99" })).toThrow();
  });
});
