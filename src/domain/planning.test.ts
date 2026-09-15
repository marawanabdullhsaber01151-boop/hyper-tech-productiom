import { describe, expect, it } from "vitest";
import {
  buildPlanningRunKey,
  buildReleaseImpact,
  calculatePlanningRequirement,
  evaluateCapacity,
  mergeCapacityLoads,
} from "./planning";

describe("planning domain", () => {
  it("does not count reserved or quarantined stock as freely available", () => {
    const result = calculatePlanningRequirement({
      grossQty: "100", availableQty: "100", reservedQty: "20",
      quarantineQty: "10", openSupplyQty: "0", leadDays: 0, requiredBy: "2026-09-20",
    });
    expect(result.freeAvailableQty).toBe("70");
    expect(result.netQty).toBe("30");
    expect(result.shortageCode).toBe("reserved_or_quarantined");
  });

  it("is deterministic and independent from object key order", () => {
    expect(buildPlanningRunKey({ b: 2, a: 1 })).toBe(buildPlanningRunKey({ a: 1, b: 2 }));
  });

  it("detects capacity overload with an actionable explanation", () => {
    expect(evaluateCapacity(600, 480)).toMatchObject({
      overloadMinutes: 120, status: "overloaded",
    });
  });

  it("merges overlapping loads before calculating the calendar", () => {
    const merged = mergeCapacityLoads([
      { workCenterId: 7, loadDate: "2026-09-20", requiredMinutes: 300, availableMinutes: 480 },
      { workCenterId: 7, loadDate: "2026-09-20", requiredMinutes: 250, availableMinutes: 480 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ requiredMinutes: 550, availableMinutes: 480 });
  });

  it("keeps release preview explicit about live isolation", () => {
    expect(buildReleaseImpact({ shortageCount: 1, overloadedCount: 0, requirementCount: 4 }).liveReservationsChanged).toBe(false);
  });
});