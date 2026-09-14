import { describe, expect, it } from "vitest";
import { maskFields } from "./fieldMasking";
import { maskProductionWorkflowPayload } from "./fieldMasking";

describe("field masking", () => {
  it("keeps sensitive fields for an allowed role", () => {
    expect(maskFields("inventory_items", { unitPrice: "10", supplierId: 2 }, "chairman"))
      .toEqual({ unitPrice: "10", supplierId: 2 });
  });

  it("removes sensitive fields for an unallowed role", () => {
    expect(maskFields("inventory_items", { unitPrice: "10", supplierId: 2 }, "online_seller"))
      .toEqual({});
  });

  it.each([
    "production_manager",
    "supervisor",
    "production_controller",
    "production_quality_controller",
  ])("removes customer identity from the raw production response for %s", (role) => {
    const body = {
      data: {
        orderNumber: "PO-0041",
        customerName: "عميل سري",
        customerPhone: "01000000000",
        customerEmail: "secret@example.com",
        customerAddress: "عنوان سري",
        portalCustomerId: 77,
        salesOrderId: 501,
        salesOrderRef: "SO-2609-0001",
        createdById: 88,
        createdByName: "عميل سري (عبر البوابة)",
      },
      children: [
        { orderNumber: "PO-0041-1", customerName: "عميل سري" },
      ],
    };

    const rawResponse = maskProductionWorkflowPayload(body, role);
    expect(rawResponse).toEqual({
      data: { orderNumber: "PO-0041" },
      children: [{ orderNumber: "PO-0041-1" }],
    });
    expect(JSON.stringify(rawResponse)).not.toContain("عميل سري");
  });

  it("keeps the full customer fields for Operations Manager and sales roles", () => {
    const body = { orderNumber: "PO-0041", customerName: "عميل ظاهر" };
    expect(maskProductionWorkflowPayload(body, "operations_manager")).toEqual(body);
    expect(maskProductionWorkflowPayload(body, "sales_manager")).toEqual(body);
  });
});