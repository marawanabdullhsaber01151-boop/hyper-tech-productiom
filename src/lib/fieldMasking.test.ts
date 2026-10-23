import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maskFields } from "./fieldMasking";
import { maskProductionWorkflowPayload, maskDashboardPayload } from "./fieldMasking";

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
describe("لوحة /dashboard: الأرقام المالية", () => {
  const payload = {
    inventory: { totalItems: 5, totalValue: 1000, lowStockCount: 1 },
    sales: { totalOrders: 3, totalRevenue: 900, pendingCount: 1, trend: { last7DaysOrders: 2, last7DaysRevenue: 400 } },
    production: { totalOrders: 7 },
  };
  it.each(["operations_manager", "production_manager", "production_controller", "storekeeper"])("%s ما بيشوفش قيمة المخزون ولا الإيرادات", (role) => {
    const out = maskDashboardPayload(payload, role);
    expect(out.inventory).toEqual({ totalItems: 5, lowStockCount: 1 });
    expect(out.sales).toEqual({ totalOrders: 3, pendingCount: 1, trend: { last7DaysOrders: 2 } });
    expect(out.production).toEqual({ totalOrders: 7 });
    // الأصل ما اتعدلش
    expect(payload.inventory.totalValue).toBe(1000);
  });
  it.each(["chairman", "executive_manager"])("%s بيشوف كل الأرقام", (role) => {
    expect(maskDashboardPayload(payload, role)).toBe(payload);
  });
});

describe("حارس: الراوتات الحساسة لازم تمرّ على قناة الإخفاء", () => {
  it.each([
    ["src/routes/inventory.ts", "maskFields("],
    ["src/routes/sales.ts", "maskFields("],
    ["src/routes/dashboard.ts", "maskDashboardPayload("],
  ])("%s بيستخدم %s", (file, needle) => {
    expect(readFileSync(file, "utf8")).toContain(needle);
  });
  it("حركات المخزون (فيها unitPrice) مقصورة على أدوار بتشوف سعر الوحدة أصلًا", async () => {
    const { PERMISSIONS } = await import("./permissions");
    const { FIELD_VISIBILITY } = await import("./fieldMasking");
    const allowed = FIELD_VISIBILITY.inventory_items!.unitPrice!;
    for (const role of PERMISSIONS.movements.view) expect(allowed).toContain(role);
  });
});
