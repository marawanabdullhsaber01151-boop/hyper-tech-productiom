import { describe, expect, it } from "vitest";
import {
  OPERATIONS_CONTROL_ACTIONS,
  OPERATIONS_CONTROL_ROLES,
  canDispatchPlan,
  isPlanningOnlyEnabled,
} from "./operations-control-policy";

describe("Operations Control planning boundary", () => {
  it("defines the complete action set without duplicate keys", () => {
    const actions = Object.values(OPERATIONS_CONTROL_ACTIONS);

    expect(actions).toHaveLength(7);
    expect(new Set(actions).size).toBe(actions.length);
    expect(actions).toContain("operations.analysis.run");
    expect(actions).toContain("operations.plan.dispatch");
  });

  it("keeps dispatch unavailable to operations_manager by default", () => {
    expect(OPERATIONS_CONTROL_ROLES.planDispatch).not.toContain("operations_manager");
    expect(
      canDispatchPlan({
        role: "operations_manager",
        planningOnly: true,
        planApproved: true,
      }),
    ).toBe(false);
  });

  it("fails closed when the planning-only setting is missing", () => {
    expect(isPlanningOnlyEnabled(undefined)).toBe(true);
    expect(isPlanningOnlyEnabled(null)).toBe(true);
    expect(isPlanningOnlyEnabled("true")).toBe(true);
    expect(isPlanningOnlyEnabled("false")).toBe(false);
  });

  it("requires both an approved plan and the planning boundary being off", () => {
    expect(
      canDispatchPlan({
        role: "chairman",
        planningOnly: true,
        planApproved: true,
      }),
    ).toBe(false);
    expect(
      canDispatchPlan({
        role: "chairman",
        planningOnly: false,
        planApproved: false,
      }),
    ).toBe(false);
    expect(
      canDispatchPlan({
        role: "chairman",
        planningOnly: false,
        planApproved: true,
      }),
    ).toBe(true);
  });
});