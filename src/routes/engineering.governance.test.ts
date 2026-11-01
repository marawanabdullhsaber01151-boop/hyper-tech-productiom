/** @format */
// Same lightweight, dependency-free pattern used throughout this
// conversation (production-workflow.cancel-reason.test.ts,
// foundation.inactivation.test.ts, foundation.governance.test.ts): guards
// against a specific regression, not a substitute for the real
// integration/E2E checklist in
// docs/reports/phase-04-engineering-part-1.md, which needs a real database.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/routes/engineering.ts"),
  "utf8",
);

describe("phase 04 delivery 1 — engineering governance route wiring", () => {
  it.each([
    "/engineering/product-versions/:id/components",
    "/engineering/product-versions/:id/validate",
    "/engineering/product-versions/:id/submit-review",
    "/engineering/product-versions/:id/release",
    "/engineering/product-versions/:id/supersede",
    "/engineering/change-requests/:id/impact",
  ])("route %s is still registered", (path) => {
    expect(source).toContain(`"${path}"`);
  });

  it("adding a component or a routing operation still resets validationStatus", () => {
    const occurrences = source.split('validationStatus: "not_validated"').length - 1;
    // Component create, component delete, routing-operation create: three
    // call sites must invalidate a stale "passed" result.
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it("approve still requires a passing, non-stale validation before writing", () => {
    const approveIndex = source.indexOf('"/engineering/bom-versions/:id/approve"');
    expect(approveIndex).toBeGreaterThan(-1);
    const approveBody = source.slice(approveIndex, approveIndex + 1400);
    expect(approveBody).toContain('validationStatus !== "passed"');
    expect(approveBody).toContain("VALIDATION_REQUIRED");
    const updateIndex = approveBody.indexOf(".update(engineeringProductVersionsTable)");
    const checkIndex = approveBody.indexOf('validationStatus !== "passed"');
    expect(updateIndex).toBeGreaterThan(checkIndex);
  });

  it("release still freezes the snapshot inside the same transaction as the status write", () => {
    expect(source).toContain("freezeVersionSnapshot");
    expect(source).toContain("db.transaction");
  });

  it("adding a routing operation to a non-editable version is still refused before any write", () => {
    // مسار الإضافة (POST) بالذات: المسار نفسه عليه كمان GET للقراءة (خطوة 33أ).
    const opIndex = source.indexOf('router.post("/engineering/routings/:versionId/operations"');
    expect(opIndex).toBeGreaterThan(-1);
    const opBody = source.slice(opIndex, opIndex + 1500);
    const editableCheckIndex = opBody.indexOf("assertEngineeringVersionEditable");
    const insertIndex = opBody.indexOf(".insert(engineeringRoutingsTable)");
    expect(editableCheckIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(editableCheckIndex);
  });

  it("approve/release/supersede stay restricted to engineeringApprovalRoles", () => {
    for (const path of [
      '"/engineering/bom-versions/:id/approve"',
      '"/engineering/product-versions/:id/release"',
      '"/engineering/product-versions/:id/supersede"',
    ]) {
      const index = source.indexOf(path);
      expect(index).toBeGreaterThan(-1);
      const line = source.slice(index, index + 160);
      expect(line).toContain("engineeringApprovalRoles");
    }
  });

  it("change-request impact never claims production-order impact is known", () => {
    const impactIndex = source.indexOf('"/engineering/change-requests/:id/impact"');
    expect(impactIndex).toBeGreaterThan(-1);
    const impactBody = source.slice(impactIndex, impactIndex + 900);
    expect(impactBody).toContain("productionOrderImpact");
    expect(impactBody).not.toMatch(/productionOrderImpact:\s*\[/);
  });

  it("الخطوة 33أ: طلب التغيير بترقيم تسلسلي جوّه معاملة، والقرار بفصل مهام وقفل صف", () => {
    expect(source).not.toContain("ECR-${Date.now()}");
    const create = source.slice(source.indexOf('router.post("/engineering/change-requests"'), source.indexOf('router.patch("/engineering/change-requests/:id/decide"'));
    expect(create).toContain('nextPhase0Number(tx, "engineering_change_request")');
    expect(create).toContain("db.transaction");
    const decide = source.slice(source.indexOf('router.patch("/engineering/change-requests/:id/decide"'), source.indexOf("// Phase 04 (delivery 1): real, computable change-impact"));
    expect(decide).toContain("requireRole(...engineeringApprovalRoles)");
    expect(decide).toContain('.for("update")');
    expect(decide).toContain('cr.status !== "open"');
    expect(decide).toContain("cr.requestedBy === req.user!.userId");
    expect(decide).toContain("executor: tx");
  });

  it("الخطوة 33أ: قايمة الاختيار بتجيب حقول التعريف بس (بدون أسعار أو مخزون)", () => {
    const at = source.indexOf('"/engineering/lookups"');
    expect(at).toBeGreaterThan(-1);
    const body = source.slice(at, source.indexOf('router.get("/engineering/products"'));
    expect(body).not.toMatch(/price|cost|minStock|supplier|qty/i);
    expect(body).toContain("requireRole(...engineeringRoles)");
  });

  it("الخطوة 33أ: انتقالات الحالة بشرط على الحالة الحالية (مفيش انتقال مزدوج)", () => {
    for (const path of ['"/engineering/product-versions/:id/submit-review"', '"/engineering/bom-versions/:id/approve"', '"/engineering/product-versions/:id/supersede"', '"/engineering/product-versions/:id/retire"']) {
      const at = source.indexOf(path);
      expect(at).toBeGreaterThan(-1);
      expect(source.slice(at, at + 2200)).toContain("engineeringProductVersionsTable.status, version.status");
    }
  });
});
