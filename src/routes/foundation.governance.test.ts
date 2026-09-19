/** @format */
// Same lightweight, dependency-free pattern as
// production-workflow.cancel-reason.test.ts and
// foundation.inactivation.test.ts: guards against the specific regression
// of someone quietly removing a route or a guard, not a substitute for the
// real integration/E2E checklist in
// docs/reports/phase-03-foundation-part-3.md, which needs a real database.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/routes/foundation.ts"),
  "utf8",
);

describe("phase 03 delivery 3 — governed master data route wiring", () => {
  it.each([
    "/foundation/items/:id/history",
    "/foundation/items/:id/impact",
    "/foundation/items/duplicates",
    "/foundation/items/:id/aliases",
    "/foundation/items/:id/request-change",
    "/foundation/items/:id/approve",
    "/foundation/items/:id/reject",
    "/foundation/items/import",
    "/foundation/items/export",
  ])("route %s is still registered", (path) => {
    expect(source).toContain(`"${path}"`);
  });

  it("approve/reject stay restricted to APPROVAL_ROLES, not the wider FOUNDATION_ROLES", () => {
    const approveIndex = source.indexOf('"/foundation/items/:id/approve"');
    const rejectIndex = source.indexOf('"/foundation/items/:id/reject"');
    expect(approveIndex).toBeGreaterThan(-1);
    expect(rejectIndex).toBeGreaterThan(-1);
    // The line registering each route must mention APPROVAL_ROLES, not just
    // FOUNDATION_ROLES, on the same line as the route path.
    const approveLine = source.slice(approveIndex - 40, approveIndex + 120);
    const rejectLine = source.slice(rejectIndex - 40, rejectIndex + 120);
    expect(approveLine).toContain("APPROVAL_ROLES");
    expect(rejectLine).toContain("APPROVAL_ROLES");
  });

  it("a critical-field PATCH on an active item is still refused before any write", () => {
    expect(source).toContain("USE_REQUEST_CHANGE_ENDPOINT");
    expect(source).toContain("isCriticalFoundationItemChange");
  });

  it("the PATCH handler still records a version snapshot inside the same transaction as the update", () => {
    const patchIndex = source.indexOf('router.patch("/foundation/items/:id"');
    expect(patchIndex).toBeGreaterThan(-1);
    // Wide enough to comfortably outlast the USE_REQUEST_CHANGE_ENDPOINT and
    // inactivation-impact guard blocks that sit between the route
    // registration and db.transaction(...) — a previous, narrower window
    // (1800 chars) broke this exact test the first time either guard block
    // grew, with no change to the actual behavior being checked. Sliced to
    // the next route registration instead of a fixed length so it can't
    // happen again the same way.
    const nextRouteIndex = source.indexOf("router.", patchIndex + 40);
    const patchBody = source.slice(patchIndex, nextRouteIndex > -1 ? nextRouteIndex : patchIndex + 4000);
    const txIndex = patchBody.indexOf("db.transaction");
    const versionIndex = patchBody.indexOf("recordFoundationItemVersion");
    const updateIndex = patchBody.indexOf(".update(foundationItemsTable)");
    expect(txIndex).toBeGreaterThan(-1);
    expect(versionIndex).toBeGreaterThan(txIndex);
    expect(updateIndex).toBeGreaterThan(versionIndex);
  });

  it("import is capped and dry-run defaults to true", () => {
    expect(source).toContain("MAX_IMPORT_ROWS = 500");
    expect(source).toContain('body.dryRun !== false');
  });
});
