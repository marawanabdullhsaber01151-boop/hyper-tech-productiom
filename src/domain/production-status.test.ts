import { describe, expect, it } from "vitest";
import {
  assertProductionTransition,
  canTransitionProduction,
  isProductionStatus,
} from "./production-status";

describe("canonical production domain", () => {
  it("recognizes only canonical statuses", () => {
    expect(isProductionStatus("new")).toBe(true);
    expect(isProductionStatus("planned")).toBe(false);
  });

  it("allows the approved workflow path", () => {
    expect(canTransitionProduction("awaiting_operations_claim", "claimed")).toBe(true);
    expect(canTransitionProduction("claimed", "materials_requested")).toBe(true);
    expect(canTransitionProduction("new", "pending_supervisor")).toBe(false);
    expect(canTransitionProduction("materials_approved", "in_production")).toBe(
      true,
    );
    expect(canTransitionProduction("completed", "new")).toBe(false);
  });

  it("rejects invalid transitions as conflicts", () => {
    expect(() => assertProductionTransition("delivered_customer", "new")).toThrow(
      "انتقال حالة الإنتاج غير مسموح",
    );
    try {
      assertProductionTransition("delivered_customer", "new");
    } catch (error) {
      expect(error).toMatchObject({
        status: 409,
        code: "INVALID_PRODUCTION_TRANSITION",
      });
    }
  });
});