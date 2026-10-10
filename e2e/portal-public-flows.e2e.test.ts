import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const enabled = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_ADMIN_PASSWORD);
const suite = describe.skipIf(!enabled);

/** الصفحات العامة اللي العميل بيستخدمها قبل ما يكون عنده حساب. */
suite("بوابة العميل — الصفحات العامة (طلب انضمام، عميل قديم، استعادة)", () => {
  let pool: Pool;
  let server: { address(): any; close(cb?: (err?: Error) => void): void };
  let baseUrl = "";
  let staffToken = "";
  const stamp = Date.now().toString().slice(-6);
  let counter = 10;
  const newPhone = () => `011${stamp}${String(++counter).padStart(2, "0")}`;

  async function call(path: string, init: RequestInit = {}, token = "") {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });
    const raw = await response.json().catch(() => null);
    const body = response.ok && raw && "data" in raw ? raw.data : raw;
    return { status: response.status, body };
  }
  const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    process.env.LOGIN_RATE_MAX = "1000";
    process.env.RECOVERY_RATE_MAX = "1000";
    const { default: app } = await import("../src/main");
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
    const r = await post("/auth/login", { username: process.env.E2E_ADMIN_USERNAME ?? "admin", password: process.env.E2E_ADMIN_PASSWORD });
    expect(r.status).toBe(200);
    staffToken = r.body.token;
  });

  afterAll(async () => {
    await pool?.end();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("قايمة طرق الاستعادة مش فاضية", async () => {
    const r = await call("/portal/recovery/methods");
    expect(r.status).toBe(200);
    expect(r.body.methods.length).toBeGreaterThan(0);
  });

  it("طلب انضمام جديد بيرجّع رقم متابعة، ولو الرقم اتقدّم قبل كده بيرجّع رسالة بدون رقم", async () => {
    const phone = newPhone();
    const body = { fullName: "عميل تجربة", companyName: `شركة ${stamp}`, phone, address: "القاهرة" };
    const first = await post("/portal/applications", body);
    expect(first.status).toBe(201);
    expect(first.body.referenceCode).toMatch(/\w+/);
    const again = await post("/portal/applications", body);
    expect(again.status).toBe(202);
    expect(again.body.referenceCode).toBeUndefined();
    expect(again.body.message).toBeTruthy();
  });

  it("عميل قديم (مش عنده حساب بوابة): الطلب بيظهر في صفحة طلبات التفعيل للإدارة", async () => {
    const phone = newPhone();
    const company = `شركة قديمة ${stamp}`;
    const r = await post("/portal/activation-requests", { companyName: company, phone });
    expect(r.status).toBe(200);
    const list = await call("/portal-activation-requests?status=pending", {}, staffToken);
    expect(list.status).toBe(200);
    expect(list.body.some((x: any) => x.phoneEntered === phone && x.companyNameEntered === company)).toBe(true);
  });

  it("عميل عنده حساب بوابة بالفعل: مفيش طلب بيتعمل والرد مايكشفش وجود الحساب", async () => {
    const phone = newPhone();
    const app = await post("/portal/applications", { fullName: "عميل", companyName: `شركة حساب ${stamp}`, phone, address: "القاهرة" });
    expect(app.status).toBe(201);
    const { rows } = await pool.query("select id from portal_applications where normalized_phone = $1 order by id desc limit 1", [`+20${phone.slice(1)}`]);
    const ok = await call(`/portal-applications/${rows[0].id}/approve`, { method: "PATCH", body: JSON.stringify({}) }, staffToken);
    expect(ok.status).toBe(200);
    const before = await call("/portal-activation-requests?status=pending", {}, staffToken);
    const r = await post("/portal/activation-requests", { companyName: "اي اسم", phone });
    const after = await call("/portal-activation-requests?status=pending", {}, staffToken);
    expect(after.body.length).toBe(before.body.length);
    const fresh = await post("/portal/activation-requests", { companyName: "شركة مجهولة", phone: newPhone() });
    expect(r.body.message).toBe(fresh.body.message);
    expect(r.status).toBe(fresh.status);
  });
});
