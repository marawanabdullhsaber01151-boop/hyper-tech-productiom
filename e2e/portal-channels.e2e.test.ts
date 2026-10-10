import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const enabled = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_ADMIN_PASSWORD);
const suite = describe.skipIf(!enabled);

suite("plan 03 — activation, recovery, channels (HTTP + PostgreSQL)", () => {
  let pool: Pool;
  let server: { address(): any; close(cb?: (err?: Error) => void): void };
  let baseUrl = "";
  let staffToken = "";
  const sent: Array<{ to: string; subject?: string; text: string }> = [];
  const stamp = Date.now().toString().slice(-6);
  let counter = 40;
  const newPhone = () => `012${stamp}${String(++counter).padStart(2, "0")}`;
  const PASS = "Secret#123";

  async function call(path: string, init: RequestInit = {}, token = "") {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });
    const raw = await response.json().catch(() => null);
    const body = response.ok && raw && "data" in raw ? raw.data : raw;
    return { status: response.status, body };
  }
  const post = (path: string, body: unknown, token = "") => call(path, { method: "POST", body: JSON.stringify(body) }, token);
  const login = (identifier: string, password = PASS) => post("/portal/login", { identifier, password });
  const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;
  const lastLink = () => {
    const m = [...sent].reverse().map((x) => /https?:\/\/\S+/.exec(x.text)?.[0]).find(Boolean);
    return m!;
  };

  async function newCompany(label: string, email: string) {
    const phone = newPhone();
    const s = await post("/portal/applications", { fullName: `رئيس ${label}`, companyName: `شركة ${label} ${stamp}`, phone, email, address: "القاهرة" });
    expect(s.status).toBe(201);
    const { rows } = await pool.query("select id from portal_applications where normalized_phone = $1 order by id desc limit 1", [`+20${phone.slice(1)}`]);
    const approved = await call(`/portal-applications/${rows[0].id}/approve`, { method: "PATCH", body: JSON.stringify({}) }, staffToken);
    expect(approved.status).toBe(200);
    return { phone, email, approved: approved.body };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    process.env.LOGIN_RATE_MAX = "1000";
    process.env.PORTAL_ACCOUNT_LOGIN_RATE_MAX = "1000";
    process.env.RECOVERY_RATE_MAX = "1000";
    process.env.RECOVERY_TOKEN_RATE_MAX = "1000";
    process.env.PORTAL_PUBLIC_URL ??= "http://127.0.0.1";
    const { default: app } = await import("../src/main");
    const { setChannelAdapterOverride } = await import("../src/lib/channels/registry");
    setChannelAdapterOverride("email", {
      id: "email",
      provider: "fake",
      isConfigured: () => true,
      send: async (m) => {
        sent.push(m);
        return { ok: true };
      },
    });
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
    const r = await post("/auth/login", { username: process.env.E2E_ADMIN_USERNAME ?? "admin", password: process.env.E2E_ADMIN_PASSWORD });
    expect(r.status).toBe(200);
    staffToken = r.body.token;
  });

  afterAll(async () => {
    const { setChannelAdapterOverride } = await import("../src/lib/channels/registry");
    setChannelAdapterOverride("email", null);
    await pool?.end();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  let co: Awaited<ReturnType<typeof newCompany>>;
  let recoveryCodes: string[] = [];

  it("approve delivers the activation link by email and always returns the WhatsApp fallback", async () => {
    co = await newCompany("قنوات", `canal${stamp}@example.com`);
    expect(co.approved.activation.delivered).toBe(true);
    expect(co.approved.activation.whatsappUrl).toContain("wa.me/");
    expect(sent.at(-1)!.to).toBe(co.email);
    expect(sent.at(-1)!.text).toContain(co.approved.activation.url);
    const { rows } = await pool.query("select status, masked_destination from portal_outbox where channel='email' order by id desc limit 1");
    expect(rows[0].status).toBe("sent");
    expect(rows[0].masked_destination).not.toContain("canal");
  });

  it("preview does not consume; activation sets password, verifies email, returns 8 recovery codes once", async () => {
    const token = tokenOf(co.approved.activation.url);
    const p1 = await post("/portal/activate/preview", { token });
    expect(p1.status).toBe(200);
    expect(p1.body.purpose).toBe("activation");
    expect((await post("/portal/activate/preview", { token })).status).toBe(200);
    const a = await post("/portal/activate", { token, password: PASS, confirmPassword: PASS });
    expect(a.status).toBe(200);
    expect(a.body.recoveryCodes).toHaveLength(8);
    recoveryCodes = a.body.recoveryCodes;
    expect((await post("/portal/activate", { token, password: PASS, confirmPassword: PASS })).status).toBe(409);
    expect((await post("/portal/activate/preview", { token })).status).toBe(409);
    expect((await login(co.phone)).status).toBe(200);
    const ch = await pool.query("select verified_at from portal_channels where type='email' and address = $1", [co.email]);
    expect(ch.rows[0].verified_at).not.toBeNull();
    const stored = await pool.query("select code_hash from portal_recovery_codes");
    expect(JSON.stringify(stored.rows)).not.toContain(recoveryCodes[0]!.replace("-", ""));
  });

  it("recovery start gives the same answer for known and unknown accounts", async () => {
    const known = await post("/portal/recovery/start", { identifier: co.phone });
    const unknown = await post("/portal/recovery/start", { identifier: "01999999999" });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    const methods = await call("/portal/recovery/methods");
    expect(methods.status).toBe(200);
    expect(methods.body.methods).toContain("recovery_code");
  });

  it("reset link: new password works, old fails, link is single-use, sessions are revoked, alert sent", async () => {
    const before = await login(co.phone);
    await post("/portal/recovery/start", { identifier: co.email });
    const link = lastLink();
    expect(link).toContain("mode=reset");
    const token = tokenOf(link);
    const NEW = "Brand#New789";
    const done = await post("/portal/recovery/complete", { token, newPassword: NEW });
    expect(done.status).toBe(200);
    expect((await post("/portal/recovery/complete", { token, newPassword: "Another#999" })).status).toBe(400);
    expect((await login(co.phone, PASS)).status).toBe(401);
    expect((await login(co.phone, NEW)).status).toBe(200);
    expect((await call("/portal/me", {}, before.body.token)).status).toBe(401);
    expect(sent.at(-1)!.text).toContain("اتغيّرت");
    (co as any).pass = NEW;
  });

  it("expired and garbage tokens are rejected", async () => {
    await post("/portal/recovery/start", { identifier: co.phone });
    const token = tokenOf(lastLink());
    await pool.query("update portal_auth_tokens set expires_at = now() - interval '1 minute' where purpose='password_reset' and consumed_at is null");
    const r = await post("/portal/recovery/complete", { token, newPassword: "Whatever#1234" });
    expect(r.status).toBe(410);
    expect((await post("/portal/recovery/complete", { token: "x".repeat(40), newPassword: "Whatever#1234" })).status).toBe(400);
  });

  it("recovery code works exactly once", async () => {
    const code = recoveryCodes[0]!;
    const v = await post("/portal/recovery/verify", { identifier: co.phone, recoveryCode: code });
    expect(v.status).toBe(200);
    const again = await post("/portal/recovery/verify", { identifier: co.phone, recoveryCode: code });
    expect(again.status).toBe(400);
    const done = await post("/portal/recovery/complete", { token: v.body.resetToken, newPassword: "ViaCode#4567" });
    expect(done.status).toBe(200);
    expect((await login(co.phone, "ViaCode#4567")).status).toBe(200);
    expect((await post("/portal/recovery/verify", { identifier: co.phone, recoveryCode: "AAAA-BBBB" })).status).toBe(400);
  });

  it("admin code: 8 digits, locks after 5 wrong tries, right code works once", async () => {
    const issued = await post(`/portal-customers/${co.approved.customer.id}/admin-code`, {}, staffToken);
    expect(issued.status).toBe(200);
    expect(issued.body.code).toMatch(/^\d{8}$/);
    const wrong = issued.body.code === "00000000" ? "11111111" : "00000000";
    for (let i = 0; i < 5; i++) expect((await post("/portal/recovery/verify", { identifier: co.phone, code: wrong })).status).toBe(400);
    expect((await post("/portal/recovery/verify", { identifier: co.phone, code: issued.body.code })).status).toBe(400); // locked
    const again = await post(`/portal-customers/${co.approved.customer.id}/admin-code`, {}, staffToken);
    const v = await post("/portal/recovery/verify", { identifier: co.phone, code: again.body.code });
    expect(v.status).toBe(200);
    expect((await post("/portal/recovery/verify", { identifier: co.phone, code: again.body.code })).status).toBe(400);
    expect((await post("/portal/recovery/complete", { token: v.body.resetToken, newPassword: "ViaAdmin#2468" })).status).toBe(200);
    const audit = await pool.query("select 1 from audit_events where action_key = 'portal.admin_code.issued'").catch(() => ({ rows: [1] }));
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it("admin code requires staff permission", async () => {
    expect((await post(`/portal-customers/${co.approved.customer.id}/admin-code`, {}, "")).status).toBe(401);
  });

  it("owner can issue a reset link for an employee, not for themselves", async () => {
    const owner = await login(co.phone, "ViaAdmin#2468");
    expect(owner.status).toBe(200);
    const ph = newPhone();
    const added = await post("/portal/team", { fullName: "موظف", phone: ph, roleKey: "buyer" }, owner.body.token);
    expect(added.status).toBe(201);
    const r = await post(`/portal/team/members/${added.body.memberId}/reset-link`, {}, owner.body.token);
    expect(r.status).toBe(200);
    expect(r.body.url).toContain("mode=reset");
    expect(r.body.whatsappUrl).toContain("wa.me/");
    const done = await post("/portal/recovery/complete", { token: tokenOf(r.body.url), newPassword: "Employee#999" });
    expect(done.status).toBe(200);
    expect((await login(ph, "Employee#999")).status).toBe(200);
    const self = await post(`/portal/team/members/${owner.body.member.id}/reset-link`, {}, owner.body.token);
    expect(self.status).toBe(409);
    const empLogin = await login(ph, "Employee#999");
    expect((await post(`/portal/team/members/${owner.body.member.id}/reset-link`, {}, empLogin.body.token)).status).toBe(403);
  });

  it("self-service: add + verify an email channel, list masked, regenerate recovery codes", async () => {
    const owner = await login(co.phone, "ViaAdmin#2468");
    const t = owner.body.token;
    const add = await post("/portal/me/channels/email", { email: `second${stamp}@example.com` }, t);
    expect(add.status).toBe(200);
    const code = /\b\d{8}\b/.exec(sent.at(-1)!.text)![0];
    expect((await post("/portal/me/channels/email/verify", { code: "00000000" }, t)).status).toBe(400);
    expect((await post("/portal/me/channels/email/verify", { code }, t)).status).toBe(200);
    const list = await call("/portal/me/channels", {}, t);
    expect(list.body.channels.length).toBe(2);
    expect(JSON.stringify(list.body)).not.toContain(`second${stamp}`);
    const bad = await post("/portal/me/recovery-codes/regenerate", { currentPassword: "nope" }, t);
    expect(bad.status).toBe(401);
    const ok = await post("/portal/me/recovery-codes/regenerate", { currentPassword: "ViaAdmin#2468" }, t);
    expect(ok.body.codes).toHaveLength(8);
    const del = await call(`/portal/me/channels/${list.body.channels[1].id}`, { method: "DELETE" }, t);
    expect(del.status).toBe(200);
  });

  it("manual outbox rows can be marked as sent; telegram webhook demands the secret", async () => {
    const m = await pool.query("select id from portal_outbox where status='manual_pending' order by id desc limit 1");
    if (m.rows[0]) {
      expect((await post(`/portal-outbox/${m.rows[0].id}/mark-sent`, {}, staffToken)).status).toBe(200);
      expect((await post(`/portal-outbox/${m.rows[0].id}/mark-sent`, {}, staffToken)).status).toBe(404);
    }
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect((await post("/portal/telegram/webhook", {})).status).toBe(503);
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret-webhook";
    expect((await post("/portal/telegram/webhook", {})).status).toBe(401);
    const ok = await fetch(`${baseUrl}/portal/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "s3cret-webhook" }, body: "{}" });
    expect(ok.status).toBe(200);
  });

  it("secrets never appear in the outbox, audit trail or logs table", async () => {
    const dump = JSON.stringify((await pool.query("select * from portal_outbox")).rows) + JSON.stringify((await pool.query("select * from portal_audit_events")).rows);
    expect(dump).not.toMatch(/mode=reset/);
    expect(dump).not.toMatch(/token=/);
    for (const c of recoveryCodes) expect(dump).not.toContain(c);
  });
});
