/** @format */
// Route-level behavior (the actual 409 on a real dependency, the override
// path, concurrency) needs a real PostgreSQL instance — see the checklist in
// docs/reports/phase-03-foundation-part-2.md. This file only guards against
// the three PATCH handlers silently losing their call into the impact
// checker, same lightweight pattern as
// src/routes/production-workflow.cancel-reason.test.ts (phase 02 delivery 3).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/routes/foundation.ts"),
  "utf8",
);

describe("phase 03 delivery 1 — foundation inactivation guard wiring", () => {
  it.each([
    ["item", "checkItemInactivationImpact"],
    ["location", "checkLocationInactivationImpact"],
    ["work center", "checkWorkCenterInactivationImpact"],
  ])("the %s PATCH handler still calls %s", (_label, fnName) => {
    expect(source).toContain(fnName);
  });

  it("never spreads overrideReason into a persisted row", () => {
    // overrideReason must stay a request-only instruction; this asserts the
    // db.update(...).set({ ...data, ... }) calls (data comes only from the
    // zod entity schemas, which never declare overrideReason) are unchanged
    // in shape rather than someone widening `data` to include it.
    expect(source).not.toMatch(/overrideReason[^\n]*\.set\(/);
    expect(source).toContain("readOverrideReason(req)");
  });
});
