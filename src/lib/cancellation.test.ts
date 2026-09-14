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
