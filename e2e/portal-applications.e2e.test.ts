import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const enabled = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_ADMIN_PASSWORD);
const suite = describe.skipIf(!enabled);

suite("plan 06 — طلبات الانضمام (طابور المراجعة، التكرار، 3 قرارات، حلقة المعلومات)", () => {
  let pool: Pool;
  let server: { address(): any; close(cb?: (err?: Error) => void): void };
  let baseUrl = "";
  let staffToken = "";
  const stamp = Date.now().toString().slice(-6);
  let counter = 40;
  const newPhone = () => `011${stamp}${String(++counter).padStart(2, "0")}`;
  const PASS = "Secret#123";

  async function call(path: string, init: RequestInit = {}, token = staffToken) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const body0 = await response.json().catch(() => null);
    const body = response.ok && body0 && "data" in body0 ? body0.data : body0;
    return { status: response.status, body };
  }
  const post = (p: string, b: unknown, t = staffToken) => call(p, { method: "POST", body: JSON.stringify(b) }, t);
  const patch = (p: string, b: unknown, t = staffToken) => call(p, { method: "PATCH", body: JSON.stringify(b) }, t);

  async function apply(label: string, extra: Record<string, unknown> = {}) {
    const phone = (extra.phone as string) ?? newPhone();
    const r = await post("/portal/applications", { fullName: `مقدّم ${label}`, companyName: `شركة ${label} ${stamp}`, phone, address: "القاهرة", ...extra }, "");
    expect(r.status).toBe(202);
    const { rows } = await pool.query("select id, stage, status, completeness, normalized_phone from portal_applications where reference_code = $1", [r.body.referenceCode]);
    return { ref: r.body.referenceCode as string, id: rows[0].id as number, row: rows[0], phone };
  }

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
  });
  afterAll(async () => {
    await pool?.end();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("الطلب الجديد: stage=new، رقم موحّد، نسبة اكتمال، وبيظهر في الطابور", async () => {
    const a = await apply("جديد", { email: `n${stamp}@x.com`, city: "القاهرة" });
    expect(a.row.stage).toBe("new");
    expect(a.row.status).toBe("pending");
    expect(a.row.normalized_phone).toBe(`+20${a.phone.slice(1)}`);
    expect(a.row.completeness).toBeGreaterThan(40);
    const list = await call(`/portal-admin/applications?q=${a.ref}`);
    expect(list.status).toBe(200);
    expect(list.body.items[0].referenceCode).toBe(a.ref);
    expect(list.body.counts.new).toBeGreaterThan(0);
  });

  it("بدون صلاحية: ممنوع", async () => {
    const r = await call("/portal-admin/applications", {}, "");
    expect(r.status).toBe(401);
  });

  it("رقم مكرر: بيتقفل تلقائيًا، والعميل بيشوفه «تحت المراجعة»", async () => {
    const a = await apply("تكرار");
    const b = await apply("تكرار تاني", { phone: a.phone });
    expect(b.row.stage).toBe("duplicate_auto_closed");
    const track = await call(`/portal/applications/track?referenceCode=${b.ref}&phone=${a.phone}`, {}, "");
    expect(track.status).toBe(200);
    expect(track.body.stage).toBe("new");
    expect(track.body.status).toBe("pending");
    const hidden = await call("/portal-admin/applications");
    expect(hidden.body.items.some((i: any) => i.referenceCode === b.ref)).toBe(false);
    const closed = await call("/portal-admin/applications?stage=duplicate_auto_closed&pageSize=200");
    expect(closed.body.items.some((i: any) => i.referenceCode === b.ref)).toBe(true);
  });

  it("المطابقة: بتلاقي شركة موجودة بنفس الاسم مكتوب بشكل تاني", async () => {
    const owner = await apply("نور");
    const ok = await post(`/portal-admin/applications/${owner.id}/approve`, { decision: "new_company" });
    expect(ok.status).toBe(200);
    const dup = await apply("نور تاني", { companyName: `الشركه نور ${stamp}` });
    const detail = await call(`/portal-admin/applications/${dup.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.matches.companies.some((c: any) => c.id === ok.body.companyId && c.reasons.includes("name"))).toBe(true);
  });

  it("قرار 1: شركة جديدة + إعدادات على مستوى الشركة + رابط تفعيل", async () => {
    const a = await apply("جديدة");
    const r = await post(`/portal-admin/applications/${a.id}/approve`, {
      decision: "new_company",
      setup: { maxMembers: 3, joinMode: "auto", minOrderQty: 5, segment: "preferred" },
    });
    expect(r.status).toBe(200);
    expect(r.body.activation.url).toContain("token=");
    const { rows } = await pool.query("select stage,status,decision,approved_company_id from portal_applications where id=$1", [a.id]);
    expect(rows[0]).toMatchObject({ stage: "approved", status: "approved", decision: "new_company", approved_company_id: r.body.companyId });
    const settings = await pool.query("select key,value from portal_settings where scope='company' and scope_id=$1 order by key", [r.body.companyId]);
    const map = Object.fromEntries(settings.rows.map((s: any) => [s.key, s.value]));
    expect(map["team.max_members"]).toBe(3);
    expect(map["join.mode"]).toBe("auto");
    const cust = await pool.query("select minimum_order_quantity, contact_id from portal_customers where id=$1", [r.body.companyId]);
    expect(cust.rows[0].minimum_order_quantity).toBe(5);
    const contact = await pool.query("select segment from contacts where id=$1", [cust.rows[0].contact_id]);
    expect(contact.rows[0].segment).toBe("preferred");
  });

  it("منع الموافقة المزدوجة", async () => {
    const a = await apply("مزدوج");
    const [one, two] = await Promise.all([
      post(`/portal-admin/applications/${a.id}/approve`, { decision: "new_company" }),
      post(`/portal-admin/applications/${a.id}/approve`, { decision: "new_company" }),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    const { rows } = await pool.query("select count(*)::int n from portal_customers where normalized_phone=$1", [a.row.normalized_phone]);
    expect(rows[0].n).toBe(1);
    const again = await post(`/portal-admin/applications/${a.id}/reject`, { reason: "متأخر" });
    expect(again.status).toBe(409);
  });

  it("قرار 2: انضمام موظف لشركة موجودة بكلمة سر مؤقتة", async () => {
    const owner = await apply("شركة أم");
    const ok = await post(`/portal-admin/applications/${owner.id}/approve`, { decision: "new_company" });
    const emp = await apply("موظف جديد");
    const r = await post(`/portal-admin/applications/${emp.id}/approve`, { decision: "join_company", companyId: ok.body.companyId });
    expect(r.status).toBe(200);
    expect(r.body.tempPassword).toBeTruthy();
    expect(r.body.whatsappUrl).toContain("wa.me");
    const login = await post("/portal/login", { identifier: emp.phone, password: r.body.tempPassword }, "");
    expect([200, 403]).toContain(login.status);
    const { rows } = await pool.query("select decision, approved_company_id from portal_applications where id=$1", [emp.id]);
    expect(rows[0]).toMatchObject({ decision: "join_company", approved_company_id: ok.body.companyId });
  });

  it("قرار 3: ربط بجهة اتصال موجودة (ومينفعش تتربط مرتين)", async () => {
    const c = await pool.query("insert into contacts (type,name,company,phone) values ('customer','قديم',$1,$2) returning id", [`شركة قديمة ${stamp}`, `010${stamp}99`]);
    const a = await apply("ربط");
    const r = await post(`/portal-admin/applications/${a.id}/approve`, { decision: "link_contact", contactId: c.rows[0].id });
    expect(r.status).toBe(200);
    const cust = await pool.query("select contact_id from portal_customers where id=$1", [r.body.companyId]);
    expect(cust.rows[0].contact_id).toBe(c.rows[0].id);
    const b = await apply("ربط تاني");
    const again = await post(`/portal-admin/applications/${b.id}/approve`, { decision: "link_contact", contactId: c.rows[0].id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("CONTACT_ALREADY_LINKED");
  });

  it("حلقة المعلومات: طلب معلومات ← العميل يرد ← stage=ready ← موافقة", async () => {
    const a = await apply("حلقة");
    const ask = await post(`/portal-admin/applications/${a.id}/request-info`, { reason: "محتاجين الرقم الضريبي" });
    expect(ask.status).toBe(200);
    const t1 = await call(`/portal/applications/track?referenceCode=${a.ref}&phone=${a.phone}`, {}, "");
    expect(t1.body).toMatchObject({ stage: "needs_info", canEdit: true, reviewerNote: "محتاجين الرقم الضريبي" });
    expect(t1.body.fields).toHaveProperty("taxId");
    const wrong = await patch(`/portal/applications/${a.ref}`, { phone: "01000000000", taxId: "1" }, "");
    expect(wrong.status).toBe(404);
    const reply = await patch(`/portal/applications/${a.ref}`, { phone: a.phone, taxId: "123-456-789", reply: "اتفضل" }, "");
    expect(reply.status).toBe(200);
    const { rows } = await pool.query("select stage, tax_id, completeness, customer_response_at from portal_applications where id=$1", [a.id]);
    expect(rows[0].stage).toBe("ready");
    expect(rows[0].tax_id).toBe("123-456-789");
    expect(rows[0].completeness).toBeGreaterThan(a.row.completeness);
    expect(rows[0].customer_response_at).not.toBeNull();
    const second = await patch(`/portal/applications/${a.ref}`, { phone: a.phone, taxId: "9" }, "");
    expect(second.status).toBe(409);
    const detail = await call(`/portal-admin/applications/${a.id}`);
    expect(detail.body.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(["submitted", "info_requested", "customer_replied"]));
    expect((await post(`/portal-admin/applications/${a.id}/approve`, { decision: "new_company" })).status).toBe(200);
  });

  it("رفض: بيتسجّل السبب وبيظهر للعميل", async () => {
    const a = await apply("مرفوض");
    expect((await post(`/portal-admin/applications/${a.id}/reject`, { reason: "" })).status).toBe(400);
    expect((await post(`/portal-admin/applications/${a.id}/reject`, { reason: "البيانات مش كفاية" })).status).toBe(200);
    const t = await call(`/portal/applications/track?referenceCode=${a.ref}&phone=${a.phone}`, {}, "");
    expect(t.body).toMatchObject({ stage: "rejected", status: "rejected", reviewerNote: "البيانات مش كفاية", canEdit: false });
  });

  it("تعديل وتعيين مراجع وملاحظات داخلية + سجل الأحداث + CSV", async () => {
    const a = await apply("تعديل");
    const me = await call("/portal-admin/applications/meta");
    expect(me.body.reviewers.length).toBeGreaterThan(0);
    const r = await patch(`/portal-admin/applications/${a.id}`, { taxId: "555", internalNotes: "اتصلنا بيه", assignedReviewerId: me.body.reviewers[0].id });
    expect(r.status).toBe(200);
    expect(r.body.application.assignedReviewerId).toBe(me.body.reviewers[0].id);
    expect(r.body.application.completeness).toBeGreaterThan(a.row.completeness);
    const mine = await call(`/portal-admin/applications?reviewer=${me.body.reviewers[0].id}&q=${a.ref}`);
    expect(mine.body.items).toHaveLength(1);
    const csv = await fetch(`${baseUrl}/portal-admin/applications/export.csv?q=${a.ref}`, { headers: { authorization: `Bearer ${staffToken}` } });
    const buf = Buffer.from(await csv.arrayBuffer());
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(buf.toString("utf8")).toContain(a.ref);
    void PASS;
  });

  it("القوالب والمهل متاحة من الإعدادات", async () => {
    const m = await call("/portal-admin/applications/meta");
    expect(m.body.rejectTemplates.length).toBeGreaterThan(0);
    expect(m.body.sla).toEqual({ warnHours: 24, lateHours: 48 });
  });
});
