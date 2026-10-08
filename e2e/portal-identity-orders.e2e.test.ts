import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const enabled = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_ADMIN_PASSWORD);
const suite = describe.skipIf(!enabled);

suite("plan 02 — orders, cancel, cart, notifications per employee (HTTP + PostgreSQL)", () => {
  let pool: Pool;
  let server: { address(): any; close(cb?: (err?: Error) => void): void };
  let baseUrl = "";
  let staffToken = "";
  const stamp = Date.now().toString().slice(-6);
  let counter = 0;
  const newPhone = () => `011${stamp}${String(++counter).padStart(2, "0")}`; // 11 digits
  const PASS = "Secret#123";

  async function call(path: string, init: RequestInit = {}, token = "") {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const raw = await response.json().catch(() => null);
    const body = response.ok && raw && "data" in raw ? raw.data : raw;
    return { status: response.status, body };
  }
  const post = (path: string, body: unknown, token = "") =>
    call(path, { method: "POST", body: JSON.stringify(body) }, token);
  const patch = (path: string, body: unknown, token = "") =>
    call(path, { method: "PATCH", body: JSON.stringify(body) }, token);
  const put = (path: string, body: unknown, token = "") =>
    call(path, { method: "PUT", body: JSON.stringify(body) }, token);
  const login = (identifier: string, password = PASS) => post("/portal/login", { identifier, password });

  async function createCompany(label: string) {
    const phone = newPhone();
    const submitted = await post("/portal/applications", {
      fullName: `رئيس ${label}`,
      companyName: `شركة ${label} ${stamp}`,
      phone,
      address: "القاهرة",
    });
    expect(submitted.status).toBe(201);
    const { rows } = await pool.query(
      "select id from portal_applications where normalized_phone = $1 order by id desc limit 1",
      [`+20${phone.slice(1)}`],
    );
    const approved = await call(`/portal-applications/${rows[0].id}/approve`, {
      method: "PATCH",
      body: JSON.stringify({}),
    }, staffToken);
    expect(approved.status).toBe(200);
    const token = new URL(approved.body.activation.url).searchParams.get("token")!;
    const activated = await post("/portal/activate", { token, password: PASS, confirmPassword: PASS });
    expect(activated.status).toBe(200);
    const session = await login(phone);
    expect(session.status).toBe(200);
    return { phone, token: session.body.token as string, companyId: session.body.customer.id as number, member: session.body.member };
  }

  let A: Awaited<ReturnType<typeof createCompany>>;
  let B: Awaited<ReturnType<typeof createCompany>>;
  let recipeId = 0;
  let inventoryId = 0;
  const buyers: Array<{ phone: string; token: string; memberId: number }> = [];

  async function addEmployee(token: string, roleKey: string, extra: Record<string, unknown> = {}) {
    const phone = newPhone();
    const added = await post("/portal/team", { fullName: `موظف ${roleKey}`, phone, roleKey, ...extra }, token);
    expect(added.status).toBe(201);
    const session = await login(phone, added.body.tempPassword);
    // temporary password must be changed before ordering
    const changed = await post(
      "/portal/change-password",
      { currentPassword: added.body.tempPassword, newPassword: PASS, confirmPassword: PASS },
      session.body.token,
    );
    expect(changed.status).toBe(200);
    const again = await login(phone);
    return { phone, token: again.body.token as string, memberId: added.body.memberId as number };
  }
  const order = (token: string, qty: string) =>
    post(
      "/portal/orders",
      {
        items: [{ bomRecipeId: recipeId, qty, unit: "قطعة" }],
        priority: "normal",
        idempotencyKey: `e2e-${stamp}-${Math.random().toString(36).slice(2)}`,
      },
      token,
    );

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    process.env.LOGIN_RATE_MAX = "1000";
    process.env.PORTAL_ACCOUNT_LOGIN_RATE_MAX = "1000";
    process.env.PORTAL_JOIN_RATE_MAX_IP = "1000";
    process.env.PORTAL_PUBLIC_URL ??= "http://127.0.0.1";
    const { default: app } = await import("../src/main");
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
    const r = await post("/auth/login", {
      username: process.env.E2E_ADMIN_USERNAME ?? "admin",
      password: process.env.E2E_ADMIN_PASSWORD,
    });
    expect(r.status).toBe(200);
    staffToken = r.body.token;
    // A database built with drizzle-kit push has no numbering sequences; real ones come from the SQL migrations.
    await pool.query(
      `INSERT INTO phase0_number_sequences (sequence_key, prefix, next_value, padding)
       VALUES ('production_order', 'PO', 900000, 6) ON CONFLICT (sequence_key) DO NOTHING`,
    );
    const inv = await pool.query(
      `INSERT INTO inventory_items (code, name, category, qty, reserved_qty, quarantine_qty, min_qty, unit_price, unit, requires_quality_check)
       VALUES ($1, 'خامة اختبار الهوية', 'raw_material', 100, 0, 0, 0, 1, 'قطعة', false) RETURNING id`,
      [`E2E-ID-${stamp}`],
    );
    inventoryId = inv.rows[0].id;
    const rec = await pool.query(
      `INSERT INTO bom_recipes (product_code, product_name, description, output_qty, unit_cost, is_active)
       VALUES ($1, 'منتج اختبار الهوية', 'اختبار', 1, 1, true) RETURNING id`,
      [`E2E-ID-R-${stamp}`],
    );
    recipeId = rec.rows[0].id;
    await pool.query(
      `INSERT INTO bom_recipe_items (recipe_id, inventory_item_id, material_name, qty, unit, unit_cost)
       VALUES ($1, $2, 'خامة', 1, 'قطعة', 1)`,
      [recipeId, inventoryId],
    );
    A = await createCompany("ألف-طلبات");
    B = await createCompany("باء-طلبات");
    buyers.push(await addEmployee(A.token, "buyer", { limits: { maxQtyPerLine: 5, maxOrdersPerDay: 3 } }));
    buyers.push(await addEmployee(A.token, "buyer"));
  });

  afterAll(async () => {
    await pool?.end();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("an employee's order carries who sent it and respects their personal limits", async () => {
    const tooBig = await order(buyers[0]!.token, "10");
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error.code).toBe("MEMBER_LIMIT_EXCEEDED");
    const ok = await order(buyers[0]!.token, "3");
    expect(ok.status).toBe(201);
    const { rows } = await pool.query(
      "select submitted_by_member_id, created_by_kind, created_by_name from production_workflow_orders where id = $1",
      [ok.body.orders[0].id],
    );
    expect(rows[0].submitted_by_member_id).toBe(buyers[0]!.memberId);
    expect(rows[0].created_by_kind).toBe("portal_member");
    expect(rows[0].created_by_name).toContain("موظف buyer");
    // other employee has no limit
    expect((await order(buyers[1]!.token, "50")).status).toBe(201);
    // daily cap: this employee may send 3 per 24h
    expect((await order(buyers[0]!.token, "2")).status).toBe(201);
    expect((await order(buyers[0]!.token, "2")).status).toBe(201);
    const capped = await order(buyers[0]!.token, "2");
    expect(capped.status).toBe(422);
  });

  it("a viewer cannot order; the owner can and has no limits", async () => {
    const viewer = await addEmployee(A.token, "viewer");
    expect((await order(viewer.token, "3")).status).toBe(403);
    expect((await order(A.token, "500")).status).toBe(201);
  });

  it("my-orders: employees see only their own, the owner sees everyone's with the sender", async () => {
    const mine0 = await call("/portal/my-orders?limit=50", {}, buyers[0]!.token);
    expect(mine0.status).toBe(200);
    const items0 = mine0.body.flatMap((b: any) => b.items);
    expect(items0.length).toBe(3);
    expect(items0.every((i: any) => i.submittedBy.isMe)).toBe(true);
    const mine1 = await call("/portal/my-orders?limit=50", {}, buyers[1]!.token);
    expect(mine1.body.flatMap((b: any) => b.items).length).toBe(1);

    const all = await call("/portal/my-orders?limit=50", {}, A.token);
    const allItems = all.body.flatMap((b: any) => b.items);
    expect(allItems.length).toBe(5);
    expect(new Set(allItems.map((i: any) => i.submittedBy?.memberId)).size).toBeGreaterThanOrEqual(3);
    const onlyMine = await call("/portal/my-orders?scope=mine", {}, A.token);
    expect(onlyMine.body.flatMap((b: any) => b.items).length).toBe(1);

    const other = await call("/portal/my-orders", {}, B.token);
    expect(other.body.length).toBe(0);
  });

  it("cancel: employee only their own early lines; owner any stage with the stage recorded", async () => {
    const mine = (await call("/portal/my-orders?limit=50", {}, buyers[0]!.token)).body.flatMap((b: any) => b.items);
    const others = (await call("/portal/my-orders?limit=50", {}, buyers[1]!.token)).body.flatMap((b: any) => b.items);
    // employee cannot cancel someone else's order (looks like it does not exist)
    expect((await post(`/portal/orders/${others[0].id}/cancel`, {}, buyers[0]!.token)).status).toBe(404);
    // another company cannot touch it either
    expect((await post(`/portal/orders/${others[0].id}/cancel`, {}, B.token)).status).toBe(404);
    // own early line: allowed
    expect(mine[0].canCancel).toBe(true);
    expect((await post(`/portal/orders/${mine[0].id}/cancel`, { reason: "غيرت رأيي" }, buyers[0]!.token)).status).toBe(200);

    // move another line into production
    await pool.query("update production_workflow_orders set workflow_status='in_production' where id=$1", [mine[1].id]);
    const refreshed = (await call("/portal/my-orders?limit=50", {}, buyers[0]!.token)).body.flatMap((b: any) => b.items);
    expect(refreshed.find((i: any) => i.id === mine[1].id).canCancel).toBe(false);
    expect((await post(`/portal/orders/${mine[1].id}/cancel`, {}, buyers[0]!.token)).status).toBe(409);

    const late = await post(`/portal/orders/${mine[1].id}/cancel`, { reason: "العميل لغى" }, A.token);
    expect(late.status).toBe(200);
    expect(late.body.lateCancel).toBe(true);
    const row = (await pool.query("select workflow_status, cancel_stage, cancelled_by_member_id from production_workflow_orders where id=$1", [mine[1].id])).rows[0];
    expect(row.workflow_status).toBe("cancelled");
    expect(row.cancel_stage).toBe("in_production");
    expect(row.cancelled_by_member_id).toBe(A.member.id);

    // finished orders can never be cancelled
    await pool.query("update production_workflow_orders set workflow_status='delivered' where id=$1", [mine[2].id]);
    expect((await post(`/portal/orders/${mine[2].id}/cancel`, {}, A.token)).status).toBe(409);

    const audit = await call("/portal/audit?limit=100", {}, A.token);
    expect(audit.body.events.map((e: any) => e.action)).toEqual(expect.arrayContaining(["order.cancelled", "order.cancelled_late"]));
    const staffAlerts = await pool.query("select count(*)::int n from notifications where type = 'order.cancelled_late'");
    expect(staffAlerts.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("the company can limit how late the owner may cancel", async () => {
    const o = await order(A.token, "5");
    const id = o.body.orders[0].id;
    await pool.query("update production_workflow_orders set workflow_status='packaging' where id=$1", [id]);
    expect((await put(`/portal-companies/${A.companyId}/settings`, { key: "orders.cancel.company_max_status", value: "in_production" }, staffToken)).status).toBe(200);
    expect((await post(`/portal/orders/${id}/cancel`, {}, A.token)).status).toBe(409);
    expect((await put(`/portal-companies/${A.companyId}/settings`, { key: "orders.cancel.company_max_status", reset: true }, staffToken)).status).toBe(200);
    expect((await post(`/portal/orders/${id}/cancel`, {}, A.token)).status).toBe(200);
  });

  it("carts are per employee by default and shared when the company chooses so", async () => {
    expect((await post("/portal/cart", { bomRecipeId: recipeId, qty: 4 }, buyers[0]!.token)).status).toBe(200);
    expect((await post("/portal/cart", { bomRecipeId: recipeId, qty: 2 }, buyers[0]!.token)).status).toBe(200);
    const c0 = await call("/portal/cart", {}, buyers[0]!.token);
    expect(c0.body.length).toBe(1);
    expect(Number(c0.body[0].qty)).toBe(6);
    expect((await call("/portal/cart", {}, buyers[1]!.token)).body.length).toBe(0);
    expect((await call("/portal/cart", {}, A.token)).body.length).toBe(0);
    expect((await call("/portal/cart", {}, B.token)).body.length).toBe(0);

    expect((await put("/portal/company/settings", { key: "cart.scope", value: "company" }, A.token)).status).toBe(200);
    expect((await post("/portal/cart", { bomRecipeId: recipeId, qty: 7 }, buyers[1]!.token)).status).toBe(200);
    const shared = await call("/portal/cart", {}, buyers[0]!.token);
    expect(shared.body.length).toBe(1);
    expect(Number(shared.body[0].qty)).toBe(7);
    expect((await call("/portal/cart", {}, A.token)).body.length).toBe(1);
    expect((await put("/portal/company/settings", { key: "cart.scope", reset: true }, A.token)).status).toBe(200);
    expect((await call("/portal/cart", {}, buyers[0]!.token)).body.length).toBe(1);

    // wishlist follows the same rule
    expect((await post("/portal/wishlist", { bomRecipeId: recipeId }, buyers[1]!.token)).status).toBe(201);
    expect((await call("/portal/wishlist", {}, buyers[1]!.token)).body.length).toBe(1);
    expect((await call("/portal/wishlist", {}, buyers[0]!.token)).body.length).toBe(0);
    const viewer = await addEmployee(A.token, "viewer");
    expect((await call("/portal/cart", {}, viewer.token)).status).toBe(403);
  });

  it("company-wide notifications reach the owner only; an employee gets their own", async () => {
    await pool.query(
      "insert into portal_notifications (portal_customer_id, member_id, type, title, body, reference_type) values ($1, null, 't', 'للشركة', 'x', 'x'), ($1, $2, 't', 'ليك', 'x', 'x')",
      [A.companyId, buyers[1]!.memberId],
    );
    const owner = await call("/portal/notifications", {}, A.token);
    const emp = await call("/portal/notifications", {}, buyers[1]!.token);
    expect(owner.body.map((n: any) => n.title)).toContain("للشركة");
    expect(owner.body.map((n: any) => n.title)).not.toContain("ليك");
    expect(emp.body.map((n: any) => n.title)).toEqual(["ليك"]);
    const other = await call("/portal/notifications", {}, buyers[0]!.token);
    expect(other.body.length).toBe(0);
    // the owner cannot set the cancel policy; only staff can
    expect((await put("/portal/company/settings", { key: "orders.cancel.company_max_status", value: "claimed" }, A.token)).status).toBe(400);
    const unread = await call("/portal/notifications/unread-count", {}, buyers[1]!.token);
    expect(unread.body.count).toBe(1);
  });
});
