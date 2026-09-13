import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const enabled = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_ADMIN_PASSWORD);
const suite = describe.skipIf(!enabled);

suite("approval flow — HTTP + PostgreSQL", () => {
  let pool: Pool;
  let server: { address(): any; close(callback?: (err?: Error) => void): void };
  let baseUrl = "";
  let token = "";
  let policyId: number;
  let inventoryId: number;
  let directOrderId: number;
  let approvedOrderId: number;

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

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    const { app } = await import("../src/main");
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    server = app.listen(0);
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    const login = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: process.env.E2E_ADMIN_USERNAME ?? "admin", password: process.env.E2E_ADMIN_PASSWORD }),
    });
    expect(login.response.status).toBe(200);
    token = login.body.token;

    const inventory = await pool.query(
      `INSERT INTO inventory_items (code, name, category, qty, reserved_qty, min_qty, unit_price, unit, requires_quality_check)
       VALUES ($1, 'E2E approval item', 'raw_material', 0, 0, 0, 10, 'unit', false) RETURNING id`,
      [`E2E-${Date.now()}`],
    );
    inventoryId = inventory.rows[0].id;

    const policy = await request("/governance/approval-policies", {
      method: "POST",
      body: JSON.stringify({
        actionKey: "purchases.approve",
        minAmount: "50",
        approverRoles: ["chairman"],
        sequence: 1,
        requiredApprovals: 1,
        active: true,
      }),
    });
    expect(policy.response.status).toBe(201);
    policyId = policy.body.id;
  });

  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM approval_requests WHERE resource_type = 'purchase_order' AND resource_id IN ($1, $2)", [directOrderId || 0, approvedOrderId || 0]);
      await pool.query("DELETE FROM stock_movements WHERE reference_type = 'purchase_order' AND reference_id IN ($1, $2)", [directOrderId || 0, approvedOrderId || 0]);
      await pool.query("DELETE FROM purchase_order_items WHERE order_id IN ($1, $2)", [directOrderId || 0, approvedOrderId || 0]);
      await pool.query("DELETE FROM purchase_orders WHERE id IN ($1, $2)", [directOrderId || 0, approvedOrderId || 0]);
      await pool.query("DELETE FROM inventory_items WHERE id = $1", [inventoryId || 0]);
      await pool.query("DELETE FROM approval_policies WHERE id = $1", [policyId || 0]);
      await pool.end();
    }
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("receives below-threshold orders immediately", async () => {
    const result = await request("/purchases", {
      method: "POST",
      body: JSON.stringify({
        orderNumber: `E2E-DIRECT-${Date.now()}`, date: "2026-08-24", status: "received",
        subtotal: "20", total: "20",
        items: [{ inventoryItemId: inventoryId, description: "direct", qty: "2", unitPrice: "10", total: "20" }],
      }),
    });
    expect(result.response.status).toBe(201);
    expect(result.body.pendingApproval).not.toBe(true);
    directOrderId = result.body.id;
    const stock = await pool.query("SELECT qty FROM inventory_items WHERE id = $1", [inventoryId]);
    expect(Number(stock.rows[0].qty)).toBe(2);
  });

  it("pauses above-threshold receipt, then posts stock exactly after approval", async () => {
    const created = await request("/purchases", {
      method: "POST",
      body: JSON.stringify({
        orderNumber: `E2E-APPROVAL-${Date.now()}`, date: "2026-08-24", status: "received",
        subtotal: "100", total: "100",
        items: [{ inventoryItemId: inventoryId, description: "approval", qty: "3", unitPrice: "10", total: "30" }],
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body.pendingApproval).toBe(true);
    approvedOrderId = created.body.id;
    expect(created.body.approvalRequestId).toBeTypeOf("number");

    const before = await pool.query("SELECT qty FROM inventory_items WHERE id = $1", [inventoryId]);
    expect(Number(before.rows[0].qty)).toBe(2);

    const decision = await request(`/governance/approval-requests/${created.body.approvalRequestId}/decide`, {
      method: "PATCH",
      body: JSON.stringify({ decision: "approve", note: "E2E approval" }),
    });
    expect(decision.response.status).toBe(200);
    expect(decision.body.status).toBe("approved");

    const after = await pool.query("SELECT qty FROM inventory_items WHERE id = $1", [inventoryId]);
    expect(Number(after.rows[0].qty)).toBe(5);
    const movements = await pool.query(
      "SELECT count(*)::int AS count FROM stock_movements WHERE reference_type = 'purchase_order' AND reference_id = $1",
      [approvedOrderId],
    );
    expect(movements.rows[0].count).toBe(1);
  });
});