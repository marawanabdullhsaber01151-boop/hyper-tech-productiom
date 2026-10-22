import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

const enabled = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_ADMIN_PASSWORD);
const suite = describe.skipIf(!enabled);

suite("plan 05 — إدارة عملاء البوابة (قايمة، تفاصيل، موظفين، جماعي، CSV، إعدادات)", () => {
  let pool: Pool;
  let server: { address(): any; close(cb?: (err?: Error) => void): void };
  let baseUrl = "";
  let staffToken = "";
  let limitedToken = "";
  let adminId = 0;
  const stamp = Date.now().toString().slice(-6);
  let counter = 20;
  const newPhone = () => `012${stamp}${String(++counter).padStart(2, "0")}`;
  const PASS = "Secret#123";

  async function raw(path: string, init: RequestInit = {}, token = "") {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });
    return response;
  }
  async function call(path: string, init: RequestInit = {}, token = staffToken) {
    const response = await raw(path, init, token);
    const body0 = await response.json().catch(() => null);
    const body = response.ok && body0 && "data" in body0 ? body0.data : body0;
    return { status: response.status, body };
  }
  const post = (p: string, b: unknown, t = staffToken) => call(p, { method: "POST", body: JSON.stringify(b) }, t);
  const put = (p: string, b: unknown, t = staffToken) => call(p, { method: "PUT", body: JSON.stringify(b) }, t);
  const patch = (p: string, b: unknown, t = staffToken) => call(p, { method: "PATCH", body: JSON.stringify(b) }, t);

  async function createCompany(label: string, activate = true) {
    const phone = newPhone();
    const submitted = await post("/portal/applications", { fullName: `رئيس ${label}`, companyName: `شركة ${label} ${stamp}`, phone, address: "القاهرة" }, "");
    expect(submitted.status).toBe(202);
    const { rows } = await pool.query("select id from portal_applications where normalized_phone = $1 order by id desc limit 1", [`+20${phone.slice(1)}`]);
    const approved = await patch(`/portal-applications/${rows[0].id}/approve`, {});
    expect(approved.status).toBe(200);
    const { rows: c } = await pool.query("select id from portal_customers where phone = $1 or normalized_phone = $2 limit 1", [phone, `+20${phone.slice(1)}`]);
    const companyId = c[0].id as number;
    if (activate) {
      const token = new URL(approved.body.activation.url).searchParams.get("token")!;
      expect((await post("/portal/activate", { token, password: PASS, confirmPassword: PASS }, "")).status).toBe(200);
    }
    return { phone, companyId, name: `شركة ${label} ${stamp}` };
  }

  let A: Awaited<ReturnType<typeof createCompany>>;
  let B: Awaited<ReturnType<typeof createCompany>>;
  let C: Awaited<ReturnType<typeof createCompany>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    process.env.LOGIN_RATE_MAX = "1000";
    process.env.PORTAL_ACCOUNT_LOGIN_RATE_MAX = "1000";
    process.env.PORTAL_PUBLIC_URL ??= "http://127.0.0.1";
    const { default: app } = await import("../src/main");
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
    const r = await post("/auth/login", { username: process.env.E2E_ADMIN_USERNAME ?? "admin", password: process.env.E2E_ADMIN_PASSWORD }, "");
    expect(r.status).toBe(200);
    staffToken = r.body.token;
    adminId = r.body.user?.id ?? r.body.userId ?? 0;
    // staff with no portal access (for permission checks)
    const username = `lim${stamp}`;
    await pool.query("insert into system_users (username, password_hash, full_name, role, status) values ($1,$2,$3,'production_manager','active')", [username, await bcrypt.hash(PASS, 10), "موظف محدود"]);
    const l = await post("/auth/login", { username, password: PASS }, "");
    expect(l.status).toBe(200);
    limitedToken = l.body.token;
    A = await createCompany("ألف");
    B = await createCompany("باء", false);
    C = await createCompany("جيم");
  });

  afterAll(async () => {
    await pool?.end();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("القايمة: بحث بالاسم وبتليفون موظف وبكود الشركة، وفلتر الحالة", async () => {
    const byName = await call(`/portal-companies?q=${encodeURIComponent(A.name)}`);
    expect(byName.status).toBe(200);
    expect(byName.body.items.map((c: any) => c.id)).toEqual([A.companyId]);
    expect(byName.body.total).toBe(1);

    const byPhone = await call(`/portal-companies?q=${A.phone}`);
    expect(byPhone.body.items.some((c: any) => c.id === A.companyId)).toBe(true);

    const detail = await call(`/portal-companies/${A.companyId}`);
    expect(detail.status).toBe(200);
    const code = detail.body.joinCode.code as string;
    const byCode = await call(`/portal-companies?q=${encodeURIComponent(code)}`);
    expect(byCode.body.items.map((c: any) => c.id)).toContain(A.companyId);

    const notActivated = await call(`/portal-companies?status=not_activated&q=${stamp}`);
    expect(notActivated.body.items.map((c: any) => c.id)).toEqual([B.companyId]);
    const active = await call(`/portal-companies?status=active&q=${stamp}`);
    expect(active.body.items.map((c: any) => c.id).sort()).toEqual([A.companyId, C.companyId].sort());
    expect(active.body.items[0].membersCount).toBe(1);
    expect(active.body.items[0].health.level).toBeTruthy();
  });

  it("الترقيم والفرز وحد الصفحة", async () => {
    const p1 = await call(`/portal-companies?q=${stamp}&pageSize=2&page=1&sort=name&dir=asc`);
    const p2 = await call(`/portal-companies?q=${stamp}&pageSize=2&page=2&sort=name&dir=asc`);
    expect(p1.body.items).toHaveLength(2);
    expect(p2.body.items).toHaveLength(1);
    expect(p1.body.total).toBe(3);
    const names = [...p1.body.items, ...p2.body.items].map((c: any) => c.companyName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)).length ? names : names);
    expect((await call(`/portal-companies?pageSize=101`)).status).toBe(400);
    expect((await call(`/portal-companies?sort=password`)).status).toBe(400);
  });

  it("الصلاحيات: موظف من غير صلاحية مينفعش يشوف ولا يعدّل", async () => {
    expect((await call(`/portal-companies`, {}, limitedToken)).status).toBe(403);
    expect((await post(`/portal-companies/bulk`, { action: "segment", ids: [A.companyId], segment: "preferred" }, limitedToken)).status).toBe(403);
    expect((await call(`/portal-companies`, {}, "")).status).toBe(401);
  });

  it("CSV: UTF-8 BOM ومحمي من حقن الصيغ، ويحترم الفلتر", async () => {
    await pool.query("update portal_customers set company_name = $1 where id = $2", [`=HYPERLINK("http://x")${stamp}`, C.companyId]);
    const r = await raw(`/portal-companies/export.csv?q=${stamp}`, {}, staffToken);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    const buf = Buffer.from(await r.arrayBuffer());
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = buf.toString("utf8");
    expect(text).toContain(`"'=HYPERLINK(""http://x"")${stamp}"`);
    expect(text).not.toContain(`"=HYPERLINK`);
    expect(text.split("\n")).toHaveLength(4); // header + 3 companies
    await pool.query("update portal_customers set company_name = $1 where id = $2", [C.name, C.companyId]);
  });

  let memberId = 0;
  let tempPassword = "";
  let memberPhone = "";

  it("إضافة موظف يدوي من الإدارة → دخول بالباسورد المؤقت → إيقاف بيقفل الجلسة فورًا", async () => {
    memberPhone = newPhone();
    const created = await post(`/portal-companies/${A.companyId}/members`, { fullName: "موظف يدوي", phone: memberPhone, roleKey: "buyer" });
    expect(created.status).toBe(201);
    memberId = created.body.memberId;
    tempPassword = created.body.tempPassword;
    expect(created.body.whatsappUrl).toContain("wa.me");
    expect((await post(`/portal-companies/${A.companyId}/members`, { fullName: "تاني", phone: memberPhone, roleKey: "buyer" })).status).toBe(409);
    expect((await post(`/portal-companies/${A.companyId}/members`, { fullName: "دور غلط", phone: newPhone(), roleKey: "owner" })).status).toBe(400);

    const login = await post("/portal/login", { identifier: memberPhone, password: tempPassword }, "");
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    expect((await call("/portal/me", {}, token)).status).toBe(200);

    const sessions = await call(`/portal-companies/${A.companyId}`);
    expect(sessions.body.sessions.some((s: any) => s.memberId === memberId)).toBe(true);
    expect(sessions.body.members.some((m: any) => m.memberId === memberId)).toBe(true);

    expect((await post(`/portal-companies/${A.companyId}/members/${memberId}/suspend`, {})).status).toBe(200);
    expect((await call("/portal/me", {}, token)).status).toBe(401);
    expect((await post(`/portal-companies/${A.companyId}/members/${memberId}/reactivate`, {})).status).toBe(200);

    const relog = await post("/portal/login", { identifier: memberPhone, password: tempPassword }, "");
    expect(relog.status).toBe(200);
    const revoked = await post(`/portal-companies/${A.companyId}/members/${memberId}/revoke-sessions`, {});
    expect(revoked.body.revoked).toBeGreaterThanOrEqual(1);
    expect((await call("/portal/me", {}, relog.body.token)).status).toBe(401);
  });

  it("تعديل الدور والحدود، ورابط الاستعادة، وإزالة الموظف، ورئيس الشركة محمي", async () => {
    const upd = await patch(`/portal-companies/${A.companyId}/members/${memberId}`, { roleKey: "viewer", title: "مشتري", limits: { maxOrderValue: 5000, evil: 1 } });
    expect(upd.status).toBe(200);
    const d = await call(`/portal-companies/${A.companyId}`);
    const m = d.body.members.find((x: any) => x.memberId === memberId);
    expect(m.roleKey).toBe("viewer");
    expect(m.limits).toEqual({ maxOrderValue: 5000 });

    const link = await post(`/portal-companies/${A.companyId}/members/${memberId}/reset-link`, {});
    expect(link.status).toBe(200);
    expect(link.body.url).toContain("token=");

    const owner = d.body.members.find((x: any) => x.isOwner);
    expect((await post(`/portal-companies/${A.companyId}/members/${owner.memberId}/remove`, {})).status).toBe(403);
    expect((await patch(`/portal-companies/${A.companyId}/members/${owner.memberId}`, { title: "x" })).status).toBe(403);
    // another company's member is "not found"
    expect((await post(`/portal-companies/${C.companyId}/members/${memberId}/remove`, {})).status).toBe(404);

    expect((await post(`/portal-companies/${A.companyId}/members/${memberId}/remove`, {})).status).toBe(200);
    expect((await post("/portal/login", { identifier: memberPhone, password: tempPassword }, "")).status).not.toBe(200);
  });

  it("سجل النشاط بأسماء، بفلتر، وتصدير CSV", async () => {
    const all = await call(`/portal-companies/${A.companyId}/audit`);
    expect(all.status).toBe(200);
    const created = all.body.items.find((i: any) => i.action === "member.created");
    expect(created.actorKind).toBe("staff");
    expect(created.targetName).toBe("موظف يدوي");
    const only = await call(`/portal-companies/${A.companyId}/audit?action=member.removed`);
    expect(only.body.items.every((i: any) => i.action === "member.removed")).toBe(true);
    expect(only.body.total).toBe(1);
    const csv = await raw(`/portal-companies/${A.companyId}/audit.csv`, {}, staffToken);
    expect([...Buffer.from(await csv.arrayBuffer()).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(JSON.stringify(all.body)).not.toMatch(/tempPassword|passwordHash/i);
  });

  it("جماعي: مسؤول مبيعات، تصنيف، إيقاف/إرجاع — مع audit لكل شركة وفحص الحدود", async () => {
    const meta = await call("/portal-companies/meta");
    expect(meta.body.segments).toContain("preferred");
    const salesId = meta.body.salesUsers[0]?.id ?? adminId;
    const ids = [A.companyId, C.companyId];
    const assigned = await post("/portal-companies/bulk", { action: "assignSales", ids, salesUserId: salesId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.updated).toBe(2);
    const noSales = await call(`/portal-companies?q=${stamp}&noSales=1`);
    expect(noSales.body.items.map((c: any) => c.id)).toEqual([B.companyId]);
    const bySales = await call(`/portal-companies?q=${stamp}&salesUserId=${salesId}`);
    expect(bySales.body.items).toHaveLength(2);

    expect((await post("/portal-companies/bulk", { action: "segment", ids, segment: "strategic" })).status).toBe(200);
    expect((await call(`/portal-companies?q=${stamp}&segment=strategic`)).body.total).toBe(2);
    expect((await post("/portal-companies/bulk", { action: "segment", ids, segment: "weird" })).status).toBe(400);

    expect((await post("/portal-companies/bulk", { action: "status", ids: [C.companyId], status: "suspend" })).status).toBe(200);
    expect((await call(`/portal-companies?q=${stamp}&status=suspended`)).body.items.map((c: any) => c.id)).toEqual([C.companyId]);
    expect((await post("/portal-companies/bulk", { action: "status", ids: [C.companyId], status: "reactivate" })).status).toBe(200);

    // all-or-nothing: one missing company rolls everything back
    const bad = await post("/portal-companies/bulk", { action: "assignSales", ids: [A.companyId, 99999999], salesUserId: null });
    expect(bad.status).toBe(404);
    expect((await call(`/portal-companies?q=${stamp}&noSales=1`)).body.items.map((c: any) => c.id)).toEqual([B.companyId]);
    expect((await post("/portal-companies/bulk", { action: "assignSales", ids: Array.from({ length: 201 }, (_, i) => i + 1), salesUserId: null })).status).toBe(400);
    expect((await post("/portal-companies/bulk", { action: "assignSales", ids: [A.companyId], salesUserId: 99999999 })).status).toBe(400);

    const audit = await call(`/portal-companies/${C.companyId}/audit?action=company.sales_assigned`);
    expect(audit.body.total).toBe(1);
  });

  it("الإعدادات بالطبقات: شركة تغلب العام، والسجل والتراجع، وحد الموظفين بيتطبق", async () => {
    const before = await call(`/portal-companies/${C.companyId}`);
    const row = before.body.settings.find((s: any) => s.key === "team.max_members");
    expect(row.source).toBe("inherited");

    expect((await put(`/portal-companies/${C.companyId}/settings/team.max_members`, { value: 1 })).status).toBe(200);
    const after = await call(`/portal-companies/${C.companyId}`);
    expect(after.body.settings.find((s: any) => s.key === "team.max_members")).toMatchObject({ value: 1, source: "company" });
    const full = await post(`/portal-companies/${C.companyId}/members`, { fullName: "زيادة", phone: newPhone(), roleKey: "buyer" });
    expect(full.status).toBe(409);
    expect(full.body.error?.code ?? full.body.code).toBeTruthy();

    expect((await put(`/portal-companies/${C.companyId}/settings/team.max_members`, { value: 0 })).status).toBe(400);
    expect((await put(`/portal-companies/${C.companyId}/settings/orders.nope`, { value: 1 })).status).toBe(400);
    expect((await put(`/portal-companies/${C.companyId}/settings/portal.multiuser.enabled`, { value: false })).status).toBe(400); // global-only

    const hist = await call(`/portal-companies/${C.companyId}/settings-history`);
    expect(hist.body.items).toHaveLength(1);
    expect(hist.body.items[0]).toMatchObject({ key: "team.max_members", hadBefore: false, afterValue: 1 });
    expect(hist.body.items[0].changedByName).toBeTruthy();

    const rev = await post(`/portal-companies/${C.companyId}/settings-history/${hist.body.items[0].id}/revert`, {});
    expect(rev.status).toBe(200);
    expect(rev.body.settings.find((s: any) => s.key === "team.max_members").source).toBe("inherited");
    const hist2 = await call(`/portal-companies/${C.companyId}/settings-history`);
    expect(hist2.body.items).toHaveLength(2);
    expect(hist2.body.items[0].revertedOf).toBe(hist.body.items[0].id);
  });

  it("إعدادات عامة: تغيير + سجل + تراجع، ومحتاج صلاحية", async () => {
    const cat = await call("/portal-admin/settings");
    expect(cat.status).toBe(200);
    expect(cat.body.catalog.length).toBeGreaterThan(5);
    expect((await put("/portal-admin/settings/security.lockout.minutes", { value: 20 }, limitedToken)).status).toBe(403);
    expect((await put("/portal-admin/settings/security.lockout.minutes", { value: 20 })).status).toBe(200);
    expect((await put("/portal-admin/settings/security.lockout.minutes", { value: "x" })).status).toBe(400);
    const hist = await call("/portal-admin/settings-history");
    const mine = hist.body.items.find((i: any) => i.key === "security.lockout.minutes");
    expect(mine.afterValue).toBe(20);
    expect((await post(`/portal-admin/settings-history/${mine.id}/revert`, {})).status).toBe(200);
    const vals = await call("/portal-admin/settings");
    expect(vals.body.values.some((v: any) => v.key === "security.lockout.minutes")).toBe(false);
  });

  it("أعلام ui.v2 اتشالت (مفيش إعداد بالاسم ده)", async () => {
    expect((await put("/portal-admin/settings/ui.v2.portal-customers-admin", { value: true })).status).toBe(400);
  });

  it("الكتالوج بيقول نوع كل إعداد، وكتالوج الصلاحيات", async () => {
    const cat = await call("/portal-admin/settings");
    const kinds = Object.fromEntries(cat.body.catalog.map((c: any) => [c.key, c.shape.kind]));
    expect(kinds["team.max_members"]).toBe("number");
    expect(kinds["join.mode"]).toBe("choice");
    expect(kinds["portal.multiuser.enabled"]).toBe("boolean");
    expect(kinds["contact.whatsapp_numbers"]).toBe("whatsapp");
    expect(kinds["delivery.activation.channels"]).toBe("multi");
    const perms = await call("/portal-companies/permissions");
    expect(perms.body.groups.length).toBeGreaterThan(3);
    expect(perms.body.permissions.some((p: any) => p.key === "cart.use")).toBe(true);
  });
});
