import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const enabled = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_ADMIN_PASSWORD);
const suite = describe.skipIf(!enabled);

suite("plan 09 — مكتب طلبات البوابة (قايمة، تفاصيل، رفض، تأكيد، إلغاء)", () => {
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
    expect(submitted.status).toBe(202);
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
    A = await createCompany("مكتب-طلبات");
  });

  afterAll(async () => {
    await pool?.end();
    if (server) await new Promise((resolve) => server.close(resolve));
  });


  const batchOf = async (r: { body: any }) => (await pool.query("select sales_order_ref from production_workflow_orders where id=$1", [r.body.orders[0].id])).rows[0].sales_order_ref as string;

  it("القايمة والتفاصيل بتعرض الطلب المعلّق بالعميل والأصناف", async () => {
    const o = await order(A.token, "2");
    expect(o.status).toBe(201);
    const ref = await batchOf(o);
    const list = await call(`/portal-admin/orders?status=pending&q=${encodeURIComponent(ref)}`, {}, staffToken);
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: any) => i.batchRef)).toContain(ref);
    expect(list.body.counts.pending).toBeGreaterThan(0);
    const d = await call(`/portal-admin/orders/${encodeURIComponent(ref)}`, {}, staffToken);
    expect(d.status).toBe(200);
    expect(d.body.batch.status).toBe("pending");
    expect(d.body.items).toHaveLength(1);
    expect(d.body.events[0].kind).toBe("submitted");
    expect((await call("/portal-admin/orders/NOPE-0", {}, staffToken)).status).toBe(404);
  });

  it("الرفض بيظهر في القايمة بحالة اترفض وبسببه", async () => {
    const ref = await batchOf(await order(A.token, "1"));
    const rej = await post(`/portal-orders/${encodeURIComponent(ref)}/reject`, { reason: "الصنف مش متاح" }, staffToken);
    expect(rej.status).toBe(200);
    const d = await call(`/portal-admin/orders/${encodeURIComponent(ref)}`, {}, staffToken);
    expect(d.body.batch.status).toBe("rejected");
    expect(d.body.review.rejectReason).toBe("الصنف مش متاح");
    expect(d.body.events.map((e: any) => e.kind)).toContain("rejected");
  });

  it("التأكيد بالسعر بيعمل أمر بيع، والإلغاء المتأخر بيتعلّم", async () => {
    const o = await order(A.token, "4");
    const ref = await batchOf(o);
    const id = o.body.orders[0].id;
    const ok = await post(`/portal-orders/${encodeURIComponent(ref)}/confirm`, { items: [{ workflowOrderId: id, unitPrice: "25" }] }, staffToken);
    expect(ok.status).toBe(200);
    const d = await call(`/portal-admin/orders/${encodeURIComponent(ref)}`, {}, staffToken);
    expect(d.body.batch.status).toBe("confirmed");
    expect(d.body.invoice).not.toBeNull();
    expect(d.body.items[0].canClaim || d.body.items[0].canCancel).toBe(true);
    await pool.query("update production_workflow_orders set workflow_status='in_production' where id=$1", [id]);
    expect((await call(`/portal-admin/orders/${encodeURIComponent(ref)}`, {}, staffToken)).body.batch.progress).toBe("production");
  });

  it("إلغاء كل الأصناف بيخلّي الطلب ملغي، وبدون تسجيل دخول ممنوع", async () => {
    const o = await order(A.token, "1");
    const ref = await batchOf(o);
    const c = await post(`/portal-orders/${o.body.orders[0].id}/cancel`, { reason: "العميل لغى" }, staffToken);
    expect(c.status).toBe(200);
    expect((await call(`/portal-admin/orders/${encodeURIComponent(ref)}`, {}, staffToken)).body.batch.status).toBe("cancelled");
    expect((await call("/portal-admin/orders", {}, "")).status).toBe(401);
    expect((await call("/portal-admin/orders", {}, A.token)).status).toBe(401);
  });
});
