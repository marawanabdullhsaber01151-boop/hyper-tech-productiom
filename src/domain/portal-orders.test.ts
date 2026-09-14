import { describe, expect, it } from "vitest";
import { computeBatchRollupStatus, toPortalOrderItem } from "./portal-orders";

describe("portal order status", () => {
  it("returns the production workflow status without replacing it, plus Phase 3 fields defaulted to null when absent", () => {
    expect(
      toPortalOrderItem({
        id: 17,
        orderNumber: "PO-0017",
        productName: "منتج تجريبي",
        qty: "12",
        unit: "قطعة",
        workflowStatus: "in_production",
        neededBy: null,
        suggestedDueDate: null,
        referenceUnitPrice: null,
        referenceLineTotal: null,
        suggestedDeliveryMethod: null,
        cancelledAt: null,
        cancelReason: null,
      }),
    ).toEqual({
      id: 17,
      orderNumber: "PO-0017",
      productName: "منتج تجريبي",
      qty: "12",
      unit: "قطعة",
      workflowStatus: "in_production",
      neededBy: null,
      suggestedDueDate: null,
      referenceUnitPrice: null,
      referenceLineTotal: null,
      suggestedDeliveryMethod: null,
      cancelledAt: null,
      cancelReason: null,
    });
  });

  it("passes through Phase 3 reference pricing and due-date fields when present", () => {
    const result = toPortalOrderItem({
      id: 18,
      orderNumber: "PO-0018",
      productName: "منتج تجريبي",
      qty: "5",
      unit: "قطعة",
      workflowStatus: "new",
      neededBy: "2026-10-01",
      suggestedDueDate: "2026-10-01",
      referenceUnitPrice: "100.00",
      referenceLineTotal: "500.00",
      suggestedDeliveryMethod: "warehouse",
      cancelledAt: null,
      cancelReason: null,
    });
    expect(result.referenceLineTotal).toBe("500.00");
    expect(result.suggestedDeliveryMethod).toBe("warehouse");
  });
});

describe("batch rollup status", () => {
  it("reports pending_review when there are no items yet", () => {
    expect(
      computeBatchRollupStatus({ itemStatuses: [], hasReview: false }),
    ).toBe("pending_review");
  });

  it("reports all_cancelled only when every item is cancelled", () => {
    expect(
      computeBatchRollupStatus({
        itemStatuses: ["cancelled", "cancelled"],
        hasReview: false,
      }),
    ).toBe("all_cancelled");
  });

  it("reports needs_attention when any item is rejected or cancelled but not all", () => {
    expect(
      computeBatchRollupStatus({
        itemStatuses: ["materials_rejected", "in_production"],
        hasReview: true,
      }),
    ).toBe("needs_attention");
  });

  it("reports all_completed when every item reached a successful terminal state", () => {
    expect(
      computeBatchRollupStatus({
        itemStatuses: ["completed", "delivered_customer"],
        hasReview: true,
      }),
    ).toBe("all_completed");
  });

  it("reports pending_review when nothing terminal/rejected yet and no staff review exists", () => {
    expect(
      computeBatchRollupStatus({
        itemStatuses: ["new", "new"],
        hasReview: false,
      }),
    ).toBe("pending_review");
  });

  it("reports in_progress once reviewed and still moving, with nothing rejected/cancelled/terminal", () => {
    expect(
      computeBatchRollupStatus({
        itemStatuses: ["in_production", "quality_check"],
        hasReview: true,
      }),
    ).toBe("in_progress");
  });
});
