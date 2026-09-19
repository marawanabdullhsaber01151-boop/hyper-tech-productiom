/** @format */
import { describe, expect, it } from "vitest";
import {
  isAllowedEngineeringVersionTransition,
  assertAllowedEngineeringVersionTransition,
  isEngineeringVersionEditable,
  assertEngineeringVersionEditable,
  validateBomComponentShape,
  validateRoutingStepShape,
  findDuplicateOperationNumbers,
  detectBomCycle,
  summarizeManufacturabilityIssues,
} from "./engineering-governance";

describe("engineering version status machine (phase 04 delivery 1)", () => {
  it("allows the documented governance flow", () => {
    expect(isAllowedEngineeringVersionTransition("draft", "in_review")).toBe(true);
    expect(isAllowedEngineeringVersionTransition("in_review", "approved")).toBe(true);
    expect(isAllowedEngineeringVersionTransition("in_review", "draft")).toBe(true);
    expect(isAllowedEngineeringVersionTransition("approved", "released")).toBe(true);
    expect(isAllowedEngineeringVersionTransition("approved", "in_review")).toBe(true);
    expect(isAllowedEngineeringVersionTransition("released", "superseded")).toBe(true);
    expect(isAllowedEngineeringVersionTransition("released", "retired")).toBe(true);
    expect(isAllowedEngineeringVersionTransition("superseded", "retired")).toBe(true);
  });

  it("rejects skipping review or editing after release", () => {
    expect(isAllowedEngineeringVersionTransition("draft", "approved")).toBe(false);
    expect(isAllowedEngineeringVersionTransition("released", "draft")).toBe(false);
    expect(isAllowedEngineeringVersionTransition("retired", "released")).toBe(false);
  });

  it("assertAllowedEngineeringVersionTransition throws 409 INVALID_STATUS_TRANSITION", () => {
    try {
      assertAllowedEngineeringVersionTransition("draft", "approved");
      expect.unreachable();
    } catch (err) {
      expect((err as { status?: number }).status).toBe(409);
      expect((err as { code?: string }).code).toBe("INVALID_STATUS_TRANSITION");
    }
  });
});

describe("engineering version immutability (phase 04 delivery 1)", () => {
  it("only draft and in_review are editable", () => {
    expect(isEngineeringVersionEditable("draft")).toBe(true);
    expect(isEngineeringVersionEditable("in_review")).toBe(true);
    expect(isEngineeringVersionEditable("approved")).toBe(false);
    expect(isEngineeringVersionEditable("released")).toBe(false);
    expect(isEngineeringVersionEditable("superseded")).toBe(false);
    expect(isEngineeringVersionEditable("retired")).toBe(false);
  });

  it("assertEngineeringVersionEditable throws 409 VERSION_NOT_EDITABLE for a released version", () => {
    try {
      assertEngineeringVersionEditable("released");
      expect.unreachable();
    } catch (err) {
      expect((err as { status?: number }).status).toBe(409);
      expect((err as { code?: string }).code).toBe("VERSION_NOT_EDITABLE");
    }
  });
});

describe("BOM component validation", () => {
  it("flags a component with both a foundation item and a sub-assembly", () => {
    const issues = validateBomComponentShape(
      { componentType: "raw_material", foundationItemId: 1, subAssemblyProductId: 2, qty: 1, unit: "kg" },
      1,
    );
    expect(issues.map((i) => i.code)).toContain("COMPONENT_SOURCE_AMBIGUOUS");
  });

  it("flags a component with neither source", () => {
    const issues = validateBomComponentShape(
      { componentType: "raw_material", qty: 1, unit: "kg" },
      1,
    );
    expect(issues.map((i) => i.code)).toContain("COMPONENT_SOURCE_AMBIGUOUS");
  });

  it("flags zero/negative quantity, missing unit, and out-of-range scrap", () => {
    const issues = validateBomComponentShape(
      { componentType: "raw_material", foundationItemId: 1, qty: 0, unit: "", scrapFactorPct: 150 },
      1,
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("IMPOSSIBLE_QUANTITY");
    expect(codes).toContain("MISSING_UNIT");
    expect(codes).toContain("INVALID_SCRAP_FACTOR");
  });

  it("passes a well-formed component with no issues", () => {
    const issues = validateBomComponentShape(
      { componentType: "raw_material", foundationItemId: 1, qty: 2.5, unit: "kg", scrapFactorPct: 2 },
      1,
    );
    expect(issues).toEqual([]);
  });
});

describe("routing step validation", () => {
  it("flags a missing work center", () => {
    const issues = validateRoutingStepShape({
      operationNo: 10, workCenterId: null, setupMinutes: 5, runMinutesPerUnit: 1, workersRequired: 1,
    });
    expect(issues.map((i) => i.code)).toContain("MISSING_WORK_CENTER");
  });

  it("flags negative time and invalid worker count", () => {
    const issues = validateRoutingStepShape({
      operationNo: 10, workCenterId: 1, setupMinutes: -1, runMinutesPerUnit: -2, workersRequired: 0,
    });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("NEGATIVE_TIME");
    expect(codes).toContain("INVALID_WORKER_COUNT");
  });

  it("passes a well-formed step", () => {
    const issues = validateRoutingStepShape({
      operationNo: 10, workCenterId: 1, setupMinutes: 5, runMinutesPerUnit: 1.5, workersRequired: 2,
    });
    expect(issues).toEqual([]);
  });
});

describe("findDuplicateOperationNumbers", () => {
  it("finds duplicated operation numbers, each once", () => {
    const dupes = findDuplicateOperationNumbers([
      { operationNo: 10, workCenterId: 1, setupMinutes: 0, runMinutesPerUnit: 0, workersRequired: 1 },
      { operationNo: 20, workCenterId: 1, setupMinutes: 0, runMinutesPerUnit: 0, workersRequired: 1 },
      { operationNo: 10, workCenterId: 1, setupMinutes: 0, runMinutesPerUnit: 0, workersRequired: 1 },
      { operationNo: 10, workCenterId: 1, setupMinutes: 0, runMinutesPerUnit: 0, workersRequired: 1 },
    ]);
    expect(dupes).toEqual([10]);
  });

  it("returns an empty array when every operation number is unique", () => {
    expect(
      findDuplicateOperationNumbers([
        { operationNo: 10, workCenterId: 1, setupMinutes: 0, runMinutesPerUnit: 0, workersRequired: 1 },
        { operationNo: 20, workCenterId: 1, setupMinutes: 0, runMinutesPerUnit: 0, workersRequired: 1 },
      ]),
    ).toEqual([]);
  });
});

describe("detectBomCycle", () => {
  it("returns null for an acyclic graph", () => {
    const edges = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
    ];
    expect(detectBomCycle(edges, 1)).toBeNull();
  });

  it("detects a direct cycle (A contains A)", () => {
    const edges = [{ from: 1, to: 1 }];
    expect(detectBomCycle(edges, 1)).toEqual([1, 1]);
  });

  it("detects an indirect cycle (A -> B -> C -> A)", () => {
    const edges = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 1 },
    ];
    const cycle = detectBomCycle(edges, 1);
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe(1);
    expect(cycle![cycle!.length - 1]).toBe(1);
  });

  it("does not false-positive on a diamond (A -> B, A -> C, B -> D, C -> D)", () => {
    const edges = [
      { from: 1, to: 2 },
      { from: 1, to: 3 },
      { from: 2, to: 4 },
      { from: 3, to: 4 },
    ];
    expect(detectBomCycle(edges, 1)).toBeNull();
  });
});

describe("summarizeManufacturabilityIssues", () => {
  it("passes only when there are zero errors, regardless of warnings", () => {
    expect(
      summarizeManufacturabilityIssues([
        { severity: "warning", code: "W", message: "w" },
      ]),
    ).toEqual({ passed: true, errorCount: 0, warningCount: 1 });
    expect(
      summarizeManufacturabilityIssues([
        { severity: "error", code: "E", message: "e" },
      ]),
    ).toEqual({ passed: false, errorCount: 1, warningCount: 0 });
  });

  it("passes with zero issues", () => {
    expect(summarizeManufacturabilityIssues([])).toEqual({
      passed: true,
      errorCount: 0,
      warningCount: 0,
    });
  });
});
