import { describe, expect, it } from "vitest";
import { toPortalOrderItem } from "./portal-orders";

describe("portal order status", () => {
  it("returns the production workflow status without replacing it", () => {
    expect(
      toPortalOrderItem({
        id: 17,
        orderNumber: "PO-0017",
        productName: "منتج تجريبي",
        qty: "12",
        unit: "قطعة",
        workflowStatus: "in_production",
      }),
    ).toEqual({
      id: 17,
      orderNumber: "PO-0017",
      productName: "منتج تجريبي",
      qty: "12",
      unit: "قطعة",
      workflowStatus: "in_production",
    });
  });
});