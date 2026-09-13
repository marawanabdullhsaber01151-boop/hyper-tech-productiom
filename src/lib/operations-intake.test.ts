import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgresql://stage02:stage02@localhost:5432/stage02";
const {
  VALID_OPERATIONS_SALES_STATUSES,
  buildSalesOrderSnapshot,
  customerDisplayName,
  findMissingStockMovementLines,
  parseSalesOrderRevision,
  receiveSalesOrderIntoOperations,
  validateOperationsSnapshot,
} = await import("./operations-intake");

const order = {
  id: 41,
  orderNumber: "SO-0041",
  status: "confirmed",
  date: "2026-09-04",
  dueDate: "2026-09-10",
  channel: "direct",
  notes: "نسخة العميل الأصلية",
  subtotal: "100.00",
  total: "115.00",
};

const item = {
  id: 501,
  inventoryItemId: 77,
  description: "Housing",
  qty: "2.500",
  unitPrice: "40.00",
  total: "100.00",
};

describe("Operations intake", () => {
  it("accepts only a positive integer sales-order revision", () => {
    expect(parseSalesOrderRevision(undefined)).toBe(1);
    expect(parseSalesOrderRevision(3)).toBe(3);
    expect(() => parseSalesOrderRevision(1.5)).toThrow();
    expect(() => parseSalesOrderRevision(0)).toThrow();
    expect(VALID_OPERATIONS_SALES_STATUSES).toContain("confirmed");
  });

  it("keeps the customer snapshot minimal", () => {
    expect(customerDisplayName({ name: "عميل", company: "شركة" })).toBe(
      "عميل — شركة",
    );
    expect(customerDisplayName(null)).toBeNull();

    const snapshot = buildSalesOrderSnapshot({
      order,
      customer: { id: 9, name: "عميل", company: "شركة" },
      items: [item],
      salesOrderRevision: 1,
      capturedAt: "2026-09-04T00:00:00.000Z",
    });

    expect(snapshot.customer).toEqual({
      id: 9,
      displayName: "عميل — شركة",
    });
    expect(snapshot.customer).not.toHaveProperty("phone");
    expect(snapshot.customer).not.toHaveProperty("email");
  });

  it("validates quantities and preserves explicit unit metadata", () => {
    const snapshot = buildSalesOrderSnapshot({
      order,
      customer: { id: 9, name: "عميل", company: "شركة" },
      items: [{
        ...item,
        baseUnit: "piece",
        packagingQty: "12",
        packagingUnit: "carton",
        conversionFactor: "12",
      }],
      salesOrderRevision: 1,
      capturedAt: "2026-09-04T00:00:00.000Z",
    });

    validateOperationsSnapshot(snapshot);
    expect(snapshot.lines[0]).toMatchObject({
      baseUnit: "piece",
      packagingQty: "12",
      packagingUnit: "carton",
      conversionFactor: "12",
    });
    expect(() =>
      validateOperationsSnapshot({
        ...snapshot,
        lines: [{ ...snapshot.lines[0], orderedQty: "0" }],
      }),
    ).toThrow("كمية الطلب يجب أن تكون أكبر من صفر");
  });

  it("preserves the original snapshot when the source order later changes", () => {
    const snapshot = buildSalesOrderSnapshot({
      order,
      customer: { id: 9, name: "عميل", company: "شركة" },
      items: [item],
      salesOrderRevision: 1,
      capturedAt: "2026-09-04T00:00:00.000Z",
    });

    order.status = "shipped";
    order.total = "999.00";
    item.qty = "99.000";

    expect(snapshot.salesOrder.status).toBe("confirmed");
    expect(snapshot.salesOrder.total).toBe("115.00");
    expect(snapshot.lines[0].orderedQty).toBe("2.500");
  });

  it("returns the existing case for a replay of the same order revision", async () => {
    const existing = {
      id: 8,
      caseNumber: "OC-000008",
      salesOrderId: 41,
      salesOrderRevision: 1,
      status: "received",
      version: 1,
    };
    const existingLines = [{ id: 1, caseId: 8, orderedQty: "2.500" }];
    let selectCount = 0;
    const tx = {
      select: () => {
        selectCount += 1;
        const selected = selectCount === 1 ? [existing] : [existingLines[0]];
        return {
          from: () => ({
            where: () =>
              selectCount === 1
                ? {
                    limit: () => ({
                      for: async () => selected,
                    }),
                  }
                : selected,
          }),
        };
      },
    };

    const result = await receiveSalesOrderIntoOperations(tx as any, {
      salesOrderId: 41,
      salesOrderRevision: 1,
      priority: "normal",
      createdBy: 7,
      actorName: "ops",
    });

    expect(result.created).toBe(false);
    expect(result.case).toEqual(existing);
    expect(result.lines).toEqual(existingLines);
    expect(selectCount).toBe(2);
  });

  it("identifies shipped lines without an outbound sales-order movement", () => {
    expect(
      findMissingStockMovementLines(
        [
          {
            id: 501,
            inventoryItemId: 77,
            description: "Housing",
            qty: "2.500",
          },
          {
            id: 502,
            inventoryItemId: null,
            description: "Service",
            qty: "1.000",
          },
        ],
        [],
      ),
    ).toEqual([
      {
        salesOrderItemId: 501,
        inventoryItemId: 77,
        productName: "Housing",
        orderedQty: "2.500",
      },
    ]);
  });

  it("rejects receiving a shipped order when stock movement is missing", async () => {
    let selectCount = 0;
    const shippedOrder = {
      ...order,
      status: "shipped",
      contactId: null,
      revision: 1,
    };
    const shippedItem = {
      ...item,
      baseUnit: "piece",
      packagingQty: "0",
      packagingUnit: "carton",
      conversionFactor: "1",
    };

    const tx = {
      select: () => {
        selectCount += 1;
        if (selectCount === 1) {
          return {
            from: () => ({
              where: () => ({
                limit: () => ({
                  for: async () => [],
                }),
              }),
            }),
          };
        }
        if (selectCount === 2) {
          return {
            from: () => ({
              where: () => ({
                limit: () => ({
                  for: async () => [shippedOrder],
                }),
              }),
            }),
          };
        }
        if (selectCount === 3) {
          return {
            from: () => ({
              where: () => ({
                limit: () => ({
                  for: async () => [],
                }),
              }),
            }),
          };
        }
        if (selectCount === 4) {
          return {
            from: () => ({
              where: async () => [shippedItem],
            }),
          };
        }
        if (selectCount === 5) {
          return {
            from: () => ({
              where: async () => [],
            }),
          };
        }
        // writeAuditEvent reads the previous hash before inserting the
        // rejection event through the same transaction executor.
        return {
          from: () => ({
            orderBy: () => ({
              limit: async () => [],
            }),
          }),
        };
      },
      insert: () => ({
        values: async () => [],
      }),
    };

    await expect(
      receiveSalesOrderIntoOperations(tx as any, {
        salesOrderId: shippedOrder.id,
        salesOrderRevision: shippedOrder.revision,
        priority: "normal",
        createdBy: 7,
        actorName: "ops",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "INCONSISTENT_STOCK",
      details: {
        salesOrderId: shippedOrder.id,
        salesOrderStatus: "shipped",
        missingStockMovementLines: [
          expect.objectContaining({
            salesOrderItemId: shippedItem.id,
            inventoryItemId: shippedItem.inventoryItemId,
          }),
        ],
      },
    });
  });
});