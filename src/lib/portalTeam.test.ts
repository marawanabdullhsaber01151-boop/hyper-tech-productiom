import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://hyper:hyper@localhost:5432/hyper_test";
});
const { generateTempPassword, sanitizeLimits } = await import("./portalTeam");

describe("team helpers", () => {
  it("temp passwords are 10 chars without look-alikes", () => {
    for (let i = 0; i < 50; i += 1) expect(generateTempPassword()).toMatch(/^[A-HJ-NP-Za-km-z2-9]{10}$/);
  });
  it("sanitizeLimits keeps only known positive numbers", () => {
    expect(
      sanitizeLimits({ maxQtyPerLine: 10, maxLinesPerOrder: -1, hack: 5, maxOrdersPerDay: "3", maxOrderValue: 0 }),
    ).toEqual({ maxQtyPerLine: 10 });
    expect(sanitizeLimits(null)).toEqual({});
  });
});
