/** @format */
// Non-database test: exercises only the zod contract and the domain
// transition-guard predicate. It does not touch PostgreSQL, so it cannot by
// itself prove the /production-workflow/:id/cancel route or the row-locked
// transaction behave correctly end to end — that requires the integration
// and E2E suites listed in docs/reports/phase-02-canonical-domain-part-3.md,
// run against a real database.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cancelWorkflowOrderSchema } from "../db/schema/production-workflow";
import { requiredReasonForCanonicalTransition } from "../domain/production-lifecycle";

// Route-level behavior (transaction rollback on missing reason, the
// USE_DEDICATED_CANCEL_ENDPOINT guard, the adjustment insert actually
// running inside the same transaction as the stock reversal) needs a real
// PostgreSQL instance and is NOT covered here — see the integration/E2E
// checklist in docs/reports/phase-02-canonical-domain-part-3.md. These two
// source-assertion checks only guard against the specific regression of
// someone quietly deleting the guard or the schema import, matching the
// existing lightweight pattern in portal-orders.test.ts.
const productionWorkflowSource = readFileSync(
  resolve(process.cwd(), "src/routes/production-workflow.ts"),
  "utf8",
);
const productionLifecycleRouteSource = readFileSync(
  resolve(process.cwd(), "src/routes/production-lifecycle.ts"),
  "utf8",
);

describe("phase 02 delivery 3 — source-level regression guards", () => {
  it("the legacy cancel route still parses cancelWorkflowOrderSchema", () => {
    expect(productionWorkflowSource).toContain(
      "cancelWorkflowOrderSchema.parse(req.body ?? {})",
    );
  });

  it("the legacy cancel route still records a lifecycle adjustment", () => {
    expect(productionWorkflowSource).toContain(
      "tx.insert(productionLifecycleAdjustmentsTable)",
    );
  });

  it("the generic lifecycle transition endpoint still blocks 'cancelled'", () => {
    expect(productionLifecycleRouteSource).toContain(
      "USE_DEDICATED_CANCEL_ENDPOINT",
    );
  });
});

describe("cancelWorkflowOrderSchema (phase 02 delivery 3)", () => {
  it("rejects a missing reason", () => {
    const result = cancelWorkflowOrderSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects an empty or whitespace-only reason", () => {
    expect(cancelWorkflowOrderSchema.safeParse({ reason: "" }).success).toBe(
      false,
    );
    expect(
      cancelWorkflowOrderSchema.safeParse({ reason: "   " }).success,
    ).toBe(false);
  });

  it("rejects a reason shorter than 3 trimmed characters", () => {
    expect(cancelWorkflowOrderSchema.safeParse({ reason: "ok" }).success).toBe(
      false,
    );
  });

  it("accepts and trims a valid reason", () => {
    const result = cancelWorkflowOrderSchema.safeParse({
      reason: "  طلب العميل تعديل الكمية  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe("طلب العميل تعديل الكمية");
    }
  });
});

describe("requiredReasonForCanonicalTransition stays consistent with the cancel route (phase 02 delivery 3)", () => {
  it("still requires a reason for every transition into cancelled", () => {
    for (const from of [
      "new",
      "claimed",
      "materials_requested",
      "materials_approved",
      "in_production",
      "quality_check",
      "completed",
    ]) {
      expect(requiredReasonForCanonicalTransition(from, "cancelled")).toBe(
        true,
      );
    }
  });
});
