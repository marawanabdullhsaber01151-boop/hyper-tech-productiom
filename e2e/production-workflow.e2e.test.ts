import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const enabled = Boolean(
  process.env.E2E_DATABASE_URL && process.env.E2E_ADMIN_PASSWORD,
);
const suite = describe.skipIf(!enabled);

suite("دورة الإنتاج — اختبار HTTP وقاعدة البيانات", () => {
  let pool: Pool;
  let server: { address(): any; close(callback?: (err?: Error) => void): void };
  let baseUrl = "";
  let token = "";
  let recipeId = 0;
  let inventoryId = 0;
  let supervisorId = 0;
  let qualityControllerId = 0;
  const orderIds: number[] = [];

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  }

  function dataOf(body: any) {
    return body?.data ?? body;
  }

  async function createOrder(label: string) {
    const result = await request("/production-workflow", {
      method: "POST",
      body: JSON.stringify({
        productName: `يُشتق من الوصفة — ${label}`,
        qty: "2",
        unit: "قطعة",
        bomRecipeId: recipeId,
        customerName: `عميل اختبار ${label}`,
        orderSource: "direct",
        priority: "normal",
        neededBy: "2030-12-31",
        notes: "اختبار تكامل آلي",
      }),
    });
    expect(result.response.status).toBe(201);
    const order = dataOf(result.body);
    orderIds.push(order.id);
    expect(order.workflowStatus).toBe("new");
    return order;
  }

  async function receive(orderId: number) {
    const result = await request(`/production-workflow/${orderId}/receive`, {
      method: "PATCH",
      body: JSON.stringify({
        supervisorId,
        qualityControllerUserId: qualityControllerId,
        productionLine: "خط الاختبار",
        startDate: "2030-01-01",
        operationalStatus: "running",
      }),
    });
    expect(result.response.status).toBe(200);
    expect(dataOf(result.body).workflowStatus).toBe("materials_requested");
  }

  async function approveMaterials(orderId: number) {
    const result = await request(
      `/production-workflow/${orderId}/warehouse-action`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", comment: "اعتماد الاختبار" }),
      },
    );
    expect(result.response.status).toBe(200);
    expect(dataOf(result.body).workflowStatus).toBe("materials_approved");
  }

  async function completeProduction(orderId: number) {
    const dispatch = await request(
      `/production-workflow/${orderId}/dispatch`,
      { method: "PATCH" },
    );
    expect(dispatch.response.status).toBe(200);
    expect(dataOf(dispatch.body).workflowStatus).toBe("in_production");

    for (let index = 0; index < 3; index += 1) {
      const stage = await request(
        `/production-workflow/${orderId}/advance-stage`,
        { method: "PATCH" },
      );
      expect(stage.response.status).toBe(200);
    }

    const failed = await request(
      `/production-workflow/${orderId}/quality-done`,
      {
        method: "PATCH",
        body: JSON.stringify({
          qualityStatus: "failed",
          qualityNotes: "إعادة فحص مطلوبة",
        }),
      },
    );
    expect(failed.response.status).toBe(200);
    expect(dataOf(failed.body).workflowStatus).toBe("quality_check");

    const passed = await request(
      `/production-workflow/${orderId}/quality-done`,
      {
        method: "PATCH",
        body: JSON.stringify({
          qualityStatus: "passed",
          qualityNotes: "اجتاز الفحص بعد التصحيح",
        }),
      },
    );
    expect(passed.response.status).toBe(200);
    expect(dataOf(passed.body).workflowStatus).toBe("completed");
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    const { app } = await import("../src/main");
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    server = app.listen(0);
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    const login = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: process.env.E2E_PRODUCTION_USERNAME ?? "chairman",
        password: process.env.E2E_ADMIN_PASSWORD,
      }),
    });
    expect(login.response.status).toBe(200);
    token = login.body.token;

    const users = await pool.query(
      `SELECT id, role FROM system_users
       WHERE role IN ('supervisor', 'production_quality_controller')
       ORDER BY id`,
    );
    supervisorId = users.rows.find((row) => row.role === "supervisor")?.id ?? 0;
    qualityControllerId =
      users.rows.find((row) => row.role === "production_quality_controller")?.id ??
      0;
    expect(supervisorId).toBeGreaterThan(0);
    expect(qualityControllerId).toBeGreaterThan(0);

    const inventory = await pool.query(
      `INSERT INTO inventory_items
       (code, name, category, qty, reserved_qty, quarantine_qty, min_qty, unit_price, unit, requires_quality_check)
       VALUES ($1, $2, 'raw_material', 100, 0, 0, 0, 1, 'قطعة', false)
       RETURNING id`,
      [`E2E-PRODUCTION-${Date.now()}`, "خامة اختبار دورة الإنتاج"],
    );
    inventoryId = inventory.rows[0].id;

    const recipe = await pool.query(
      `INSERT INTO bom_recipes
       (product_code, product_name, description, output_qty, unit_cost, is_active)
       VALUES ($1, $2, 'وصفة اختبار HTTP', 1, 1, true)
       RETURNING id`,
      [`E2E-RECIPE-${Date.now()}`, "منتج اختبار دورة الإنتاج"],
    );
    recipeId = recipe.rows[0].id;
    await pool.query(
      `INSERT INTO bom_recipe_items
       (recipe_id, inventory_item_id, material_name, qty, unit, unit_cost)
       VALUES ($1, $2, 'خامة اختبار دورة الإنتاج', 1, 'قطعة', 1)`,
      [recipeId, inventoryId],
    );
  });

  afterAll(async () => {
    if (pool) {
      if (orderIds.length) {
        await pool.query(
          `DELETE FROM audit_events
           WHERE resource_type = 'production_workflow_order'
             AND resource_id = ANY($1::int[])`,
          [orderIds],
        );
        await pool.query(
          "DELETE FROM quality_records WHERE workflow_order_id = ANY($1::int[])",
          [orderIds],
        );
        await pool.query(
          "DELETE FROM stock_movements WHERE reference_type = 'production' AND reference_id = ANY($1::int[])",
          [orderIds],
        );
        await pool.query(
          "DELETE FROM operation_transfers WHERE workflow_order_id = ANY($1::int[])",
          [orderIds],
        );
        await pool.query(
          "DELETE FROM production_workflow_orders WHERE id = ANY($1::int[])",
          [orderIds],
        );
      }
      await pool.query("DELETE FROM bom_recipe_items WHERE recipe_id = $1", [
        recipeId,
      ]);
      await pool.query("DELETE FROM bom_recipes WHERE id = $1", [recipeId]);
      await pool.query("DELETE FROM inventory_items WHERE id = $1", [
        inventoryId,
      ]);
      await pool.end();
    }
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("يرفض الانتقال غير الصحيح ثم ينفذ دورة العميل كاملة مع حلقة فشل الجودة", async () => {
    const order = await createOrder("عميل");
    const invalid = await request(
      `/production-workflow/${order.id}/dispatch`,
      { method: "PATCH" },
    );
    expect(invalid.response.status).toBe(409);

    await receive(order.id);
    await approveMaterials(order.id);
    await completeProduction(order.id);

    const deliver = await request(`/production-workflow/${order.id}/deliver`, {
      method: "PATCH",
      body: JSON.stringify({ deliveryType: "customer" }),
    });
    expect(deliver.response.status).toBe(200);
    expect(dataOf(deliver.body).workflowStatus).toBe("delivery_pending_customer");

    const confirm = await request(
      `/production-workflow/${order.id}/confirm-delivery`,
      { method: "PATCH" },
    );
    expect(confirm.response.status).toBe(200);
    expect(dataOf(confirm.body).workflowStatus).toBe("delivered_customer");
  });

  it("ينفذ فرع التسليم للمخزن ويعيد المواد عند الإلغاء قبل الإرسال وبعد اعتماد المواد", async () => {
    const warehouseOrder = await createOrder("مخزن");
    await receive(warehouseOrder.id);
    await approveMaterials(warehouseOrder.id);
    await completeProduction(warehouseOrder.id);

    const deliver = await request(
      `/production-workflow/${warehouseOrder.id}/deliver`,
      {
        method: "PATCH",
        body: JSON.stringify({
          deliveryType: "warehouse",
          inventoryItemId,
          addToInventory: true,
        }),
      },
    );
    expect(deliver.response.status).toBe(200);
    const confirm = await request(
      `/production-workflow/${warehouseOrder.id}/confirm-delivery`,
      { method: "PATCH" },
    );
    expect(confirm.response.status).toBe(200);
    expect(dataOf(confirm.body).workflowStatus).toBe("delivered_warehouse");

    const beforeCancelOrder = await createOrder("إلغاء مبكر");
    const earlyCancel = await request(
      `/production-workflow/${beforeCancelOrder.id}/cancel`,
      { method: "PATCH" },
    );
    expect(earlyCancel.response.status).toBe(200);
    expect(dataOf(earlyCancel.body).workflowStatus).toBe("cancelled");

    const afterApprovalOrder = await createOrder("إلغاء بعد اعتماد المواد");
    await receive(afterApprovalOrder.id);
    const beforeStock = Number(
      (await pool.query("SELECT qty FROM inventory_items WHERE id = $1", [inventoryId]))
        .rows[0].qty,
    );
    await approveMaterials(afterApprovalOrder.id);
    const afterApprovalStock = Number(
      (await pool.query("SELECT qty FROM inventory_items WHERE id = $1", [inventoryId]))
        .rows[0].qty,
    );
    expect(afterApprovalStock).toBe(beforeStock - 2);

    const cancelled = await request(
      `/production-workflow/${afterApprovalOrder.id}/cancel`,
      { method: "PATCH" },
    );
    expect(cancelled.response.status).toBe(200);
    const afterCancelStock = Number(
      (await pool.query("SELECT qty FROM inventory_items WHERE id = $1", [inventoryId]))
        .rows[0].qty,
    );
    expect(afterCancelStock).toBe(beforeStock);
  });
});