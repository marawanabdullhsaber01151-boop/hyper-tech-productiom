import { describe, expect, it } from "vitest";
import {
  findFoundationIntegrityIssues,
  summarizeFoundationIssues,
} from "./foundation-reconciliation";

describe("Foundation reconciliation", () => {
  it("distinguishes safe missing links from broken references", () => {
    const issues = findFoundationIntegrityIssues({
      inventory: [
        {
          id: 1,
          code: "RAW-1",
          foundationItemId: null,
          foundationItemExists: false,
          foundationCode: null,
        },
        {
          id: 2,
          code: "RAW-2",
          foundationItemId: 99,
          foundationItemExists: false,
          foundationCode: null,
        },
      ],
      conversions: [],
      locations: [],
      workCenters: [],
      machines: [],
    });

    expect(issues.map((item) => [item.code, item.severity])).toEqual([
      ["inventory_missing_foundation_link", "warning"],
      ["inventory_foundation_missing", "blocker"],
    ]);
  });

  it("detects conversion errors and location cycles", () => {
    const issues = findFoundationIntegrityIssues({
      inventory: [],
      conversions: [
        { id: 1, itemId: 1, fromUnit: "kg", toUnit: "kg", factor: "0" },
      ],
      locations: [
        { id: 10, parentId: 11 },
        { id: 11, parentId: 10 },
      ],
      workCenters: [],
      machines: [],
    });

    expect(issues.map((item) => item.code)).toEqual([
      "conversion_invalid",
      "location_cycle",
      "location_cycle",
    ]);
  });

  it("summarizes by severity and code", () => {
    const summary = summarizeFoundationIssues([
      {
        code: "inventory_missing_foundation_link",
        severity: "warning",
        entityType: "inventory_item",
        entityId: 1,
        message: "missing",
      },
      {
        code: "machine_work_center_missing",
        severity: "blocker",
        entityType: "machine",
        entityId: 2,
        message: "missing",
      },
    ]);

    expect(summary).toEqual({
      total: 2,
      blockers: 1,
      warnings: 1,
      byCode: {
        inventory_missing_foundation_link: 1,
        machine_work_center_missing: 1,
      },
    });
  });
});