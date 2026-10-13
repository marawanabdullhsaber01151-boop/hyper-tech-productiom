import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const enabled = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_ADMIN_PASSWORD);
const suite = describe.skipIf(!enabled);

suite("plan 08 — الشات: مشتركة / لكل موظف / مع مراقبة (HTTP + PostgreSQL)", () => {
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
  const emps: Array<{ phone: string; token: string; memberId: number }> = [];
  const uid = () => crypto.randomUUID();
  const send = (token: string, text: string) => post("/portal/chat/messages", { body: text, clientMsgId: uid() }, token);
  const setMode = (mode: string) =>
    pool.query(
      `INSERT INTO portal_settings (scope, scope_id, key, value) VALUES ('company', $1, 'chat.mode', $2::jsonb)
       ON CONFLICT (scope, COALESCE(scope_id, 0), key) DO UPDATE SET value = EXCLUDED.value`,
      [A.companyId, JSON.stringify(mode)],
    );

  async function addEmployee(token: string, roleKey: string, extra: Record<string, unknown> = {}) {
    const phone = newPhone();
    const added = await post("/portal/team", { fullName: `موظف ${roleKey} ${counter}`, phone, roleKey, ...extra }, token);
    expect(added.status).toBe(201);
    const session = await login(phone, added.body.tempPassword);
    const changed = await post("/portal/change-password", { currentPassword: added.body.tempPassword, newPassword: PASS, confirmPassword: PASS }, session.body.token);
    expect(changed.status).toBe(200);
    const again = await login(phone);
    return { phone, token: again.body.token as string, memberId: added.body.memberId as number };
  }

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
    const r = await post("/auth/login", { username: process.env.E2E_ADMIN_USERNAME ?? "admin", password: process.env.E2E_ADMIN_PASSWORD });
    expect(r.status).toBe(200);
    staffToken = r.body.token;
    A = await createCompany("شات");
    emps.push(await addEmployee(A.token, "buyer"));
    emps.push(await addEmployee(A.token, "buyer"));
  });
  afterAll(async () => {
    await pool?.end();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("مشتركة (الافتراضي): الرئيس والموظف على نفس المحادثة", async () => {
    const a = await send(A.token, "من الرئيس");
    expect(a.status).toBe(201);
    const b = await send(emps[0]!.token, "من الموظف");
    expect(b.status).toBe(201);
    const { rows } = await pool.query("select id, member_id from chat_conversations where portal_customer_id=$1", [A.companyId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].member_id).toBeNull();
    const open = await call("/portal/chat", {}, emps[1]!.token);
    expect(open.body.messages.map((m: any) => m.body)).toEqual(expect.arrayContaining(["من الرئيس", "من الموظف"]));
  });

  it("لكل موظف: كل واحد محادثته، ومحدش بيشوف رسايل التاني", async () => {
    await setMode("per_member");
    expect((await send(emps[0]!.token, "سر الموظف الأول")).status).toBe(201);
    expect((await send(emps[1]!.token, "سر الموظف التاني")).status).toBe(201);
    const o1 = await call("/portal/chat", {}, emps[0]!.token);
    const bodies1 = o1.body.messages.map((m: any) => m.body);
    expect(bodies1).toContain("سر الموظف الأول");
    expect(bodies1).not.toContain("سر الموظف التاني");
    expect(bodies1).not.toContain("من الرئيس");
    const { rows } = await pool.query("select member_id, customer_name from chat_conversations where portal_customer_id=$1 and member_id is not null order by id", [A.companyId]);
    expect(rows.map((r: any) => r.member_id).sort()).toEqual([emps[0]!.memberId, emps[1]!.memberId].sort());
    // غير مراقبة: حتى الرئيس مايقدرش
    expect((await call("/portal/chat/team", {}, A.token)).status).toBe(403);
    const inbox = await call("/chat/inbox", {}, staffToken);
    expect(inbox.status).toBe(200);
  });

  it("لكل موظف مع مراقبة: الرئيس بيشوف المحادثات (قراءة بس) والموظف لأ", async () => {
    await setMode("per_member_monitored");
    const list = await call("/portal/chat/team", {}, A.token);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBe(2);
    const first = list.body.items.find((i: any) => i.memberId === emps[0]!.memberId);
    const detail = await call(`/portal/chat/team/${first.id}`, {}, A.token);
    expect(detail.status).toBe(200);
    expect(detail.body.messages.map((m: any) => m.body)).toContain("سر الموظف الأول");
    expect((await call("/portal/chat/team", {}, emps[0]!.token)).status).toBe(403);
    // الموظف مايقدرش يفتح محادثة زميله
    const other = list.body.items.find((i: any) => i.memberId === emps[1]!.memberId);
    expect((await call(`/portal/chat/team/${other.id}`, {}, emps[0]!.token)).status).toBe(403);
  });

  it("محادثة شركة تانية ما بتظهرش في المراقبة", async () => {
    const B = await createCompany("شات تاني");
    const r = await call("/portal/chat/team", {}, B.token);
    // B في الوضع الافتراضي (مشتركة) → ممنوع أصلًا
    expect(r.status).toBe(403);
  });
});
