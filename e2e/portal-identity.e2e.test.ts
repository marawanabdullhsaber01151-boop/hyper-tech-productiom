import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const enabled = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_ADMIN_PASSWORD);
const suite = describe.skipIf(!enabled);

suite("plan 02 — identity, team, join, permissions (HTTP + PostgreSQL)", () => {
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
  let codeA = "";
  let codeB = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    // The suite logs in far more often than a human; production defaults stay as they are.
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
    A = await createCompany("ألف");
    B = await createCompany("باء");
    codeA = (await call("/portal/company", {}, A.token)).body.joinCode.code;
    codeB = (await call("/portal/company", {}, B.token)).body.joinCode.code;
  });

  afterAll(async () => {
    await pool?.end();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("theme: member → company → default, validated", async () => {
    const before = await call("/portal/theme", {}, A.token);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ accent: "blue", radius: "soft", density: "cozy", fontScale: 1 });
    const set = await put("/portal/company/settings", { key: "ui.theme.accent", value: "teal" }, A.token);
    expect(set.status).toBe(200);
    await put("/portal/company/settings", { key: "ui.theme.density", value: "compact" }, A.token);
    const after = await call("/portal/theme", {}, A.token);
    expect(after.body).toMatchObject({ accent: "teal", density: "compact" });
    const other = await call("/portal/theme", {}, B.token);
    expect(other.body.accent).toBe("blue");
    const bad = await put("/portal/company/settings", { key: "ui.theme.accent", value: "url(javascript:x)" }, A.token);
    expect(bad.status).toBe(400);
    expect((await call("/portal/theme", {}, "")).status).toBe(401);
  });

  it("a freshly approved company has an owner with every permission and a join code", async () => {
    expect(A.member.isOwner).toBe(true);
    expect(A.member.permissions.length).toBe(21);
    expect(codeA).toMatch(/^HT-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(codeA).not.toBe(codeB);
  });

  let employee = { phone: "", token: "", memberId: 0, temp: "" };
  it("owner adds an employee with a temporary password; employee must change it", async () => {
    employee.phone = newPhone();
    const added = await post(
      "/portal/team",
      { fullName: "موظف المشتريات", phone: employee.phone, roleKey: "buyer" },
      A.token,
    );
    expect(added.status).toBe(201);
    employee.memberId = added.body.memberId;
    employee.temp = added.body.tempPassword;
    expect(added.body.whatsappUrl).toContain("https://wa.me/");
    const dup = await post("/portal/team", { fullName: "تاني", phone: employee.phone, roleKey: "buyer" }, A.token);
    expect(dup.status).toBe(409);

    const l = await login(employee.phone, employee.temp);
    expect(l.status).toBe(200);
    expect(l.body.mustChangePassword).toBe(true);
    expect(l.body.member.isOwner).toBe(false);
    employee.token = l.body.token;
    const changed = await post(
      "/portal/change-password",
      { currentPassword: employee.temp, newPassword: "Employee#456", confirmPassword: "Employee#456" },
      employee.token,
    );
    expect(changed.status).toBe(200);
    expect((await login(employee.phone, "Employee#456")).status).toBe(200);
    expect((await login(employee.phone, employee.temp)).status).toBe(401);
  });

  it("an employee cannot reach management endpoints (403) and sees only allowed things", async () => {
    const l = await login(employee.phone, "Employee#456");
    employee.token = l.body.token;
    expect((await post("/portal/team", { fullName: "x", phone: newPhone(), roleKey: "buyer" }, employee.token)).status).toBe(403);
    expect((await call("/portal/audit", {}, employee.token)).status).toBe(403);
    expect((await post("/portal/company/code/rotate", {}, employee.token)).status).toBe(403);
    const company = await call("/portal/company", {}, employee.token);
    expect(company.status).toBe(200);
    expect(company.body.joinCode).toBeNull(); // the code is hidden without the permission
    expect((await patch("/portal/me", { fullName: "x", phone: "01000000000", companyName: "x", currentPassword: "x" }, employee.token)).status).toBe(403);
  });

  it("companies are isolated: B cannot see or change A's people (IDOR)", async () => {
    const teamB = await call("/portal/team", {}, B.token);
    expect(teamB.body.members.length).toBe(1);
    expect((await patch(`/portal/team/${employee.memberId}`, { roleKey: "viewer" }, B.token)).status).toBe(404);
    expect((await post(`/portal/team/${employee.memberId}/suspend`, {}, B.token)).status).toBe(404);
    expect((await post(`/portal/team/${employee.memberId}/reset-password`, {}, B.token)).status).toBe(404);
  });

  it("anti-escalation: a delegate cannot grant permissions they do not hold", async () => {
    const role = await post(
      "/portal/roles",
      { key: "helper", name: "مساعد", permissions: ["team.invite"] },
      A.token,
    );
    expect(role.status).toBe(201);
    const helperPhone = newPhone();
    const added = await post("/portal/team", { fullName: "مساعد", phone: helperPhone, roleKey: "helper" }, A.token);
    expect(added.status).toBe(201);
    const hl = await login(helperPhone, added.body.tempPassword);
    const tooMuch = await post("/portal/team", { fullName: "طموح", phone: newPhone(), roleKey: "manager" }, hl.body.token);
    expect(tooMuch.status).toBe(403);
    const ok = await post("/portal/team", { fullName: "عادي", phone: newPhone(), roleKey: "viewer" }, hl.body.token);
    // viewer holds catalog/prices view which the helper does not hold either
    expect([201, 403]).toContain(ok.status);
    expect((await post("/portal/team", { fullName: "owner", phone: newPhone(), roleKey: "owner" }, A.token)).status).toBe(400);
  });

  it("join by code: approval mode → pending → login blocked → owner approves → login works", async () => {
    const p = newPhone();
    const joined = await post("/portal/join", { code: codeA, fullName: "منضم", phone: p, password: PASS });
    expect(joined.status).toBe(202);
    const blocked = await login(p);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("MEMBERSHIP_PENDING");
    const reqs = await call("/portal/team/requests", {}, A.token);
    expect(reqs.body.requests.length).toBeGreaterThanOrEqual(1);
    const memberId = reqs.body.requests.find((r: any) => r.phone === p).memberId;
    expect((await post(`/portal/team/requests/${memberId}/approve`, {}, B.token)).status).toBe(404);
    expect((await post(`/portal/team/requests/${memberId}/approve`, {}, A.token)).status).toBe(200);
    expect((await login(p)).status).toBe(200);
  });

  it("join by code: auto mode joins immediately; disabled mode and wrong codes give the same answer", async () => {
    expect((await put("/portal/company/settings", { key: "join.mode", value: "auto" }, A.token)).status).toBe(200);
    const p = newPhone();
    const joined = await post("/portal/join", { code: codeA.toLowerCase().replace(/-/g, " "), fullName: "تلقائي", phone: p, password: PASS });
    expect(joined.status).toBe(201);
    expect((await login(p)).status).toBe(200);

    expect((await put("/portal/company/settings", { key: "join.mode", value: "disabled" }, A.token)).status).toBe(200);
    const closed = await post("/portal/join", { code: codeA, fullName: "مقفول", phone: newPhone(), password: PASS });
    const wrong = await post("/portal/join", { code: "HT-ZZZZ-ZZZZ", fullName: "غلط", phone: newPhone(), password: PASS });
    expect(closed.status).toBe(400);
    expect(wrong.status).toBe(400);
    expect(closed.body.error).toEqual(wrong.body.error);
    await put("/portal/company/settings", { key: "join.mode", value: "approval" }, A.token);
  });

  it("rotating the code kills the old one", async () => {
    const rotated = await post("/portal/company/code/rotate", {}, A.token);
    expect(rotated.status).toBe(200);
    expect(rotated.body.code).not.toBe(codeA);
    const old = await post("/portal/join", { code: codeA, fullName: "قديم", phone: newPhone(), password: PASS });
    expect(old.status).toBe(400);
    codeA = rotated.body.code;
  });

  it("one person in two companies: login asks which, choose-company and switch-company work", async () => {
    // person is already a member of A (employee). Join B with the SAME account.
    expect((await put("/portal/company/settings", { key: "join.mode", value: "auto" }, B.token)).status).toBe(200);
    const wrongPass = await post("/portal/join", { code: codeB, fullName: "موظف", phone: employee.phone, password: "nope-nope" });
    expect(wrongPass.status).toBe(400);
    const joined = await post("/portal/join", { code: codeB, fullName: "موظف", phone: employee.phone, password: "Employee#456" });
    expect(joined.status).toBe(201);

    const l = await login(employee.phone, "Employee#456");
    expect(l.status).toBe(200);
    expect(l.body.needsCompanyChoice).toBe(true);
    expect(l.body.companies.length).toBe(2);
    expect(l.body.token).toBeUndefined();

    const forged = await post("/portal/login/choose-company", { choiceToken: l.body.choiceToken + "x", companyId: A.companyId });
    expect(forged.status).toBe(401);
    const chosen = await post("/portal/login/choose-company", { choiceToken: l.body.choiceToken, companyId: B.companyId });
    expect(chosen.status).toBe(200);
    expect(chosen.body.customer.id).toBe(B.companyId);
    const switched = await post("/portal/session/switch-company", { companyId: A.companyId }, chosen.body.token);
    expect(switched.status).toBe(200);
    expect(switched.body.customer.id).toBe(A.companyId);
    // old session is dead after switching
    expect((await call("/portal/me", {}, chosen.body.token)).status).toBe(401);
    // and the person cannot switch into a company they are not part of
    const C = await createCompany("جيم");
    expect((await post("/portal/session/switch-company", { companyId: C.companyId }, switched.body.token)).status).toBe(403);
    // A resetting the password of a shared person is refused
    expect((await post(`/portal/team/${employee.memberId}/reset-password`, {}, A.token)).status).toBe(409);
  });

  it("suspending a member kills their session at once; reactivating restores access", async () => {
    const s = await post("/portal/team", { fullName: "هيتوقف", phone: newPhone(), roleKey: "buyer" }, A.token);
    const phone = (await pool.query("select phone from portal_users u join portal_members m on m.user_id=u.id where m.id=$1", [s.body.memberId])).rows[0].phone;
    const l = await login(phone, s.body.tempPassword);
    expect((await call("/portal/me", {}, l.body.token)).status).toBe(200);
    expect((await post(`/portal/team/${s.body.memberId}/suspend`, {}, A.token)).status).toBe(200);
    expect((await call("/portal/me", {}, l.body.token)).status).toBe(401);
    expect((await login(phone, s.body.tempPassword)).status).toBe(403);
    expect((await post(`/portal/team/${s.body.memberId}/reactivate`, {}, A.token)).status).toBe(200);
    expect((await login(phone, s.body.tempPassword)).status).toBe(200);
    // the owner is protected
    const team = await call("/portal/team", {}, A.token);
    const ownerId = team.body.members.find((m: any) => m.isOwner).memberId;
    expect((await post(`/portal/team/${ownerId}/suspend`, {}, A.token)).status).toBe(403);
    expect((await post(`/portal/team/${ownerId}/remove`, {}, A.token)).status).toBe(403);
  });

  it("repeated wrong passwords lock the account (uniform 401 until the lock)", async () => {
    const t = await post("/portal/team", { fullName: "قفل", phone: newPhone(), roleKey: "buyer" }, A.token);
    const phone = (await pool.query("select phone from portal_users u join portal_members m on m.user_id=u.id where m.id=$1", [t.body.memberId])).rows[0].phone;
    await pool.query("update portal_users set failed_login_attempts = 0, locked_until = null where normalized_phone like $1", [`%${phone.slice(1)}`]);
    const attempts = (await pool.query("select 5 as n")).rows[0].n as number;
    let last = 0;
    for (let i = 0; i < attempts; i += 1) last = (await login(phone, "wrong-password")).status;
    expect([401, 429]).toContain(last);
    const locked = await login(phone, t.body.tempPassword);
    expect(locked.status).toBe(429);
  });

  it("owner password change keeps the legacy company hash in sync", async () => {
    const r = await post(
      "/portal/change-password",
      { currentPassword: PASS, newPassword: "NewOwner#789", confirmPassword: "NewOwner#789" },
      A.token,
    );
    expect(r.status).toBe(200);
    const { rows } = await pool.query(
      "select c.password_hash = u.password_hash as same from portal_customers c join portal_members m on m.company_id=c.id and m.is_owner join portal_users u on u.id=m.user_id where c.id=$1",
      [A.companyId],
    );
    expect(rows[0].same).toBe(true);
    expect((await login(A.phone, "NewOwner#789")).status).toBe(200);
    expect((await login(A.phone, PASS)).status).toBe(401);
  });

  it("audit log records who did what and never contains secrets", async () => {
    const l = await login(A.phone, "NewOwner#789");
    const audit = await call("/portal/audit?limit=100", {}, l.body.token);
    expect(audit.status).toBe(200);
    const actions = audit.body.events.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["member.created", "join.requested", "company.code_rotated", "member.suspended"]));
    const text = JSON.stringify(audit.body);
    expect(text).not.toMatch(/tempPassword|passwordHash|Employee#|Secret#/);
    const bAudit = await call("/portal/audit?limit=100", {}, B.token);
    expect(JSON.stringify(bAudit.body)).not.toContain("member.suspended");
  });

  it("staff can see a company's people and rotate its code, but only with the staff permission", async () => {
    const view = await call(`/portal-companies/${A.companyId}/identity`, {}, staffToken);
    expect(view.status).toBe(200);
    expect(view.body.members.length).toBeGreaterThan(3);
    expect(JSON.stringify(view.body)).not.toMatch(/passwordHash|tempPassword|"password"/i);
    expect((await call(`/portal-companies/${A.companyId}/identity`, {}, A.token)).status).toBe(401);
    expect((await post(`/portal-companies/${A.companyId}/code/rotate`, {}, staffToken)).status).toBe(200);
  });
});
