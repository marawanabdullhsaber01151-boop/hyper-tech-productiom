import { describe, expect, it } from "vitest";
import { assertCancellable, isCancellableStatus } from "./cancellation";

describe("pre-production cancellation guard", () => {
  it("allows cancellation while a line has not yet entered production", () => {
    for (const status of [
      "new",
      "awaiting_operations_claim",
      "claimed",
      "pending_supervisor",
      "materials_requested",
      "materials_rejected",
    ]) {
      expect(isCancellableStatus(status)).toBe(true);
      expect(() => assertCancellable(status)).not.toThrow();
    }
  });

  it("blocks cancellation once materials are approved or later, with no exception", () => {
    for (const status of [
      "materials_approved",
      "materials_partial",
      "in_production",
      "quality_check",
      "delivery_pending_customer",
      "delivery_pending_warehouse",
      "completed",
    ]) {
      expect(isCancellableStatus(status)).toBe(false);
      expect(() => assertCancellable(status)).toThrow(
        /لا يمكن إلغاء هذا الصنف/,
      );
    }
  });

  it("treats an already-cancelled line as no longer cancellable (no double-cancel)", () => {
    expect(isCancellableStatus("cancelled")).toBe(false);
  });

  it("has no bypass for unknown/future status strings — fails closed", () => {
    // أي حالة مستقبلية مش موجودة صراحة في القايمة البيضاء لازم تتمنع
    // تلقائيًا، مش تتسمح بالغلط. الحماية دي "fail closed" مش "fail open".
    expect(isCancellableStatus("some_future_status_not_yet_defined")).toBe(
      false,
    );
  });
});


import { decideCompanyCancel } from "./cancellation";

describe("company cancel decision (Plan 02)", () => {
  it("early stages are a normal cancel", () => {
    expect(decideCompanyCancel("awaiting_operations_claim", null)).toEqual({ allowed: true, late: false });
  });
  it("production stages are a late cancel, still allowed", () => {
    expect(decideCompanyCancel("in_production", null)).toEqual({ allowed: true, late: true });
    expect(decideCompanyCancel("packaging", "")).toEqual({ allowed: true, late: true });
  });
  it("finished orders can never be cancelled", () => {
    for (const s of ["cancelled", "completed", "closed", "shipped", "delivered"]) {
      expect(decideCompanyCancel(s, null)).toEqual({ allowed: false, reason: "finished" });
    }
  });
  it("honours a configured last stage", () => {
    expect(decideCompanyCancel("claimed", "in_production")).toEqual({ allowed: true, late: false });
    expect(decideCompanyCancel("in_production", "in_production")).toEqual({ allowed: true, late: true });
    expect(decideCompanyCancel("packaging", "in_production")).toEqual({ allowed: false, reason: "beyond_company_limit" });
  });
});
