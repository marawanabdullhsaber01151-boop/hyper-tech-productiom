/** @format */
import { describe, expect, it } from "vitest";
import {
  activeBlockers,
  assertInactivationAllowed,
  isInactivationBlocked,
  type InactivationImpact,
} from "./foundation-inactivation";

const clean: InactivationImpact = {
  entityType: "location",
  entityId: 1,
  blockers: [
    { type: "child_locations", count: 0, label: "مواقع فرعية" },
    { type: "work_centers", count: 0, label: "مراكز عمل" },
  ],
};

const withBlockers: InactivationImpact = {
  entityType: "location",
  entityId: 2,
  blockers: [
    { type: "child_locations", count: 0, label: "مواقع فرعية" },
    { type: "work_centers", count: 3, label: "مراكز عمل" },
  ],
};

describe("foundation inactivation guard (phase 03 delivery 1)", () => {
  it("is not blocked when every blocker count is zero", () => {
    expect(isInactivationBlocked(clean)).toBe(false);
    expect(activeBlockers(clean)).toEqual([]);
    expect(() => assertInactivationAllowed(clean, null)).not.toThrow();
  });

  it("is blocked when at least one blocker count is positive", () => {
    expect(isInactivationBlocked(withBlockers)).toBe(true);
    expect(activeBlockers(withBlockers)).toEqual([
      { type: "work_centers", count: 3, label: "مراكز عمل" },
    ]);
  });

  it("throws a 409 INACTIVATION_BLOCKED error with the blockers as details, and no reason", () => {
    try {
      assertInactivationAllowed(withBlockers, null);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(409);
      expect((err as { code?: string }).code).toBe("INACTIVATION_BLOCKED");
      expect((err as { details?: unknown }).details).toEqual(
        activeBlockers(withBlockers),
      );
    }
  });

  it("throws when the override reason is only whitespace", () => {
    expect(() => assertInactivationAllowed(withBlockers, "   ")).toThrow();
  });

  it("throws when the override reason is shorter than 3 trimmed characters", () => {
    expect(() => assertInactivationAllowed(withBlockers, "ok")).toThrow();
  });

  it("allows the transition when a real override reason is supplied", () => {
    expect(() =>
      assertInactivationAllowed(withBlockers, "  نقل المراكز يدويًا  "),
    ).not.toThrow();
  });
});
