import { describe, expect, it } from "vitest";
import { maskProductionWorkflowPayload } from "../lib/fieldMasking";

describe("production workflow endpoint serialization boundary", () => {
  it.each([
    "production_manager",
    "supervisor",
    "production_controller",
    "production_quality_controller",
  ])("returns no customer identity fields in the parsed response for %s", (role) => {
    const parsedResponseBody = maskProductionWorkflowPayload(
      {
        data: {
          orderNumber: "PO-0007",
          customerName: "بيانات عميل",
          customerPhone: "01000000000",
          customerEmail: "private@example.com",
          customerAddress: "عنوان العميل",
          portalCustomerId: 77,
          salesOrderId: 501,
          salesOrderRef: "SO-2609-0001",
          createdById: 88,
          createdByName: "عميل البوابة",
        },
      },
      role,
    );

    expect(parsedResponseBody.data).toEqual({ orderNumber: "PO-0007" });
    expect(parsedResponseBody.data.customerName).toBeUndefined();
    expect(parsedResponseBody.data.customerPhone).toBeUndefined();
    expect(parsedResponseBody.data.customerEmail).toBeUndefined();
    expect(parsedResponseBody.data.customerAddress).toBeUndefined();
    expect(parsedResponseBody.data.portalCustomerId).toBeUndefined();
    expect(parsedResponseBody.data.salesOrderId).toBeUndefined();
    expect(parsedResponseBody.data.salesOrderRef).toBeUndefined();
    expect(parsedResponseBody.data.createdById).toBeUndefined();
    expect(parsedResponseBody.data.createdByName).toBeUndefined();
  });
});