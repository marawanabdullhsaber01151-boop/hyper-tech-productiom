import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const enabled = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_ADMIN_PASSWORD);
const suite = describe.skipIf(!enabled);

suite("plan 00 — portal activation & password reset (HTTP + PostgreSQL)", () => {
  let pool: Pool;
  let server: { address(): any; close(callback?: (err?: Error) => void): void };
  let baseUrl = "";
  let staffToken = "";
  const stamp = Date.now().toString().slice(-8);
  const phone = `010${stamp}`; // 010 + 8 digits = 11 digits (Egyptian local format)
  let customerId = 0;
  let firstUrl = "";
  let secondUrl = "";

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
    // The API wraps every success payload as { data } (apiEnvelope middleware).
    const body = response.ok && raw && "data" in raw ? raw.data : raw;
    return { status: response.status, body };
  }
  const staff = (path: string, init: RequestInit = {}) => call(path, init, staffToken);
  const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    process.env.PORTAL_PUBLIC_URL ??= "http://127.0.0.1";
    const { default: app } = await import("../src/main");
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
    const login = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: process.env.E2E_ADMIN_USERNAME ?? "admin",
        password: process.env.E2E_ADMIN_PASSWORD,
      }),
    });
    expect(login.status).toBe(200);
    staffToken = login.body.token;
  });

  afterAll(async () => {
    await pool?.end();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("approving an application returns a one-time link + WhatsApp URL even with no SMS provider", async () => {
    const submitted = await call("/portal/applications", {
      method: "POST",
      body: JSON.stringify({
        fullName: "عميل تجريبي",
        companyName: `شركة ${stamp}`,
        phone,
        address: "القاهرة",
      }),
    });
    expect(submitted.status).toBe(201);
    const { rows } = await pool.query(
      "select id from portal_applications where normalized_phone = $1 order by id desc limit 1",
      [`+20${phone.slice(1)}`],
    );
    const approved = await staff(`/portal-applications/${rows[0].id}/approve`, {
      method: "PATCH",
      body: JSON.stringify({ ttlMinutes: 60 }),
    });
    expect(approved.status).toBe(200);
    const activation = approved.body.activation;
    expect(activation.url).toContain("/portal-activate.html?token=");
    expect(activation.whatsappUrl).toContain(`https://wa.me/20${phone.slice(1)}`);
    expect(activation.delivered).toBe(false);
    expect(activation.message).toContain(activation.url);
    expect(JSON.stringify(approved.body)).not.toContain("activationToken");
    firstUrl = activation.url;
    customerId = approved.body.customer.id;

    // The raw token must never reach the audit trail.
    const audit = await pool.query(
      "select count(*)::int as n from audit_events where after_data::text like $1",
      [`%${tokenOf(firstUrl)}%`],
    );
    expect(audit.rows[0].n).toBe(0);
  });

  it("a duplicate application with another phone format is still treated as the existing customer", async () => {
    const dup = await call("/portal/applications", {
      method: "POST",
      body: JSON.stringify({
        fullName: "نفس العميل",
        companyName: "نفس الشركة",
        phone: `+20 ${phone.slice(1, 4)} ${phone.slice(4)}`,
        address: "القاهرة",
      }),
    });
    expect(dup.status).toBe(202);
  });

  it("clamps the lifetime into the safe range", async () => {
    const r = await staff(`/portal-customers/${customerId}/activation-link`, {
      method: "POST",
      body: JSON.stringify({ ttlMinutes: 1 }),
    });
    expect(r.status).toBe(200);
    const minutes = (new Date(r.body.activation.expiresAt).getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThan(16);
  });

  it("issuing a new link invalidates the old one, and the new one activates the account", async () => {
    const listed = await staff(`/portal-customers?q=${stamp}`);
    expect(listed.body.items?.[0]?.activated).toBe(false);

    const regenerated = await staff(`/portal-customers/${customerId}/activation-link`, {
      method: "POST",
      body: JSON.stringify({ ttlMinutes: 1440 }),
    });
    expect(regenerated.status).toBe(200);
    secondUrl = regenerated.body.activation.url;
    expect(secondUrl).not.toBe(firstUrl);

    const old = await call("/portal/activate", {
      method: "POST",
      body: JSON.stringify({ token: tokenOf(firstUrl), password: "Secret#123", confirmPassword: "Secret#123" }),
    });
    expect([409, 410]).toContain(old.status);

    const ok = await call("/portal/activate", {
      method: "POST",
      body: JSON.stringify({ token: tokenOf(secondUrl), password: "Secret#123", confirmPassword: "Secret#123" }),
    });
    expect(ok.status).toBe(200);

    const after = await staff(`/portal-customers?q=${stamp}`);
    expect(after.body.items?.[0]?.activated).toBe(true);
  });

  it("refuses to issue an activation link for an already-activated account", async () => {
    const r = await staff(`/portal-customers/${customerId}/activation-link`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("PORTAL_ACCOUNT_ALREADY_ACTIVATED");
  });

  it("manual reset revokes old sessions and forces a password change before ordering", async () => {
    const login = await call("/portal/login", {
      method: "POST",
      body: JSON.stringify({ identifier: phone, password: "Secret#123", confirmPassword: "Secret#123" }),
    });
    expect(login.status).toBe(200);
    const portalToken = login.body.token;
    expect((await call("/portal/me", {}, portalToken)).status).toBe(200);

    const reset = await staff(`/portal-customers/${customerId}/reset-password`, {
      method: "PATCH",
      body: JSON.stringify({}),
    });
    expect(reset.status).toBe(200);
    const temp = reset.body.newPassword;
    expect(reset.body.mustChangePassword).toBe(true);

    expect((await call("/portal/me", {}, portalToken)).status).toBe(401);

    const relogin = await call("/portal/login", {
      method: "POST",
      body: JSON.stringify({ identifier: phone, password: temp }),
    });
    expect(relogin.status).toBe(200);
    const newToken = relogin.body.token;
    expect(relogin.body.mustChangePassword).toBe(true);

    const blocked = await call(
      "/portal/orders",
      {
        method: "POST",
        body: JSON.stringify({
          items: [{ bomRecipeId: 1, qty: "1", unit: "قطعة" }],
          priority: "normal",
          idempotencyKey: `gate-${stamp}`,
        }),
      },
      newToken,
    );
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const wrong = await call(
      "/portal/change-password",
      { method: "POST", body: JSON.stringify({ currentPassword: "nope-nope", newPassword: "Another#456" }) },
      newToken,
    );
    expect(wrong.status).toBe(401);

    const changed = await call(
      "/portal/change-password",
      { method: "POST", body: JSON.stringify({ currentPassword: temp, newPassword: "Another#456" }) },
      newToken,
    );
    expect(changed.status).toBe(200);
    const me = await call("/portal/me", {}, newToken);
    expect(me.body.mustChangePassword).toBe(false);
  });

  it("forgot-password notifies only roles that can actually resolve it", async () => {
    await pool.query("delete from notifications where type = 'portal_password_reset'");
    const r = await call("/portal/forgot-password", {
      method: "POST",
      body: JSON.stringify({ identifier: phone }),
    });
    expect(r.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const rows = await pool.query(
      `select distinct u.role from notifications n join system_users u on u.id = n.user_id
       where n.type = 'portal_password_reset'`,
    );
    const roles = rows.rows.map((row) => row.role);
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(["chairman", "executive_manager", "sales_manager"]).toContain(role);
    }
  });
});
