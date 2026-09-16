import { describe, expect, it } from "vitest";
import {
  assertCanonicalProductionTransition,
  buildProductionOrderSnapshot,
  findProductionConformanceIssues,
  hashProductionSnapshot,
  requiredReasonForCanonicalTransition,
  stableSnapshotJson,
} from "./production-lifecycle";

describe("phase 02 canonical production lifecycle", () => {
  it("keeps snapshot hashing stable when object key order changes", () => {
    const first = buildProductionOrderSnapshot({
      productName: "منتج أ",
      bomRecipeId: 7,
      qty: "12.500",
      unit: "وحدة",
      neededBy: "2026-09-30",
      priority: "high",
      customerRequirement: { customer: "عميل", note: null },
    });
    const second = {
      priority: first.priority,
      dueDate: first.dueDate,
      quantity: first.quantity,
      customerRequirement: first.customerRequirement,
      product: first.product,
    };

    expect(stableSnapshotJson(first)).toBe(stableSnapshotJson(second));
    expect(hashProductionSnapshot(first)).toHaveLength(64);
  });

  it("supports controlled hold and rework paths but rejects terminal bypasses", () => {
    expect(() =>
      assertCanonicalProductionTransition("in_production", "held"),
    ).not.toThrow();
    expect(() =>
      assertCanonicalProductionTransition("quality_check", "rework"),
    ).not.toThrow();
    expect(() =>
      assertCanonicalProductionTransition("delivered_customer", "new"),
    ).toThrow();
    expect(requiredReasonForCanonicalTransition("in_production", "held")).toBe(
      true,
    );
    expect(requiredReasonForCanonicalTransition("quality_check", "completed")).toBe(
      false,
    );
  });

  it("reports broken event sequences and missing canonical identity", () => {
    expect(
      findProductionConformanceIssues(
        {
          id: 1,
          workflowStatus: "quality_check",
          lifecycleRevision: 3,
          snapshotHash: null,
          canonicalSourceType: "production_request",
          canonicalSourceId: null,
        },
        [0, 2],
      ),
    ).toEqual(
      expect.arrayContaining([
        "MISSING_SNAPSHOT_HASH",
        "SOURCE_ID_MISSING",
        "EVENT_REVISION_MISMATCH",
        "EVENT_REVISION_GAP",
      ]),
    );
  });
});