import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const enabled = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_ADMIN_PASSWORD);
const suite = describe.skipIf(!enabled);

suite("plan 07 — طلبات التفعيل (تكرار، ترشيح، تعيين، تأكيد، إعادة إرسال، قفل)", () => {
  let pool: Pool;
  let server: { address(): any; close(cb?: (err?: Error) => void): void };
  let baseUrl = "";
  let staffToken = "";
  const stamp = Date.now().toString().slice(-6);
  let counter = 10;
  const newPhone = () => `012${stamp}${String(++counter).padStart(2, "0")}`;

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

  async function contact(label: string, phone: string) {
    const { rows } = await pool.query(
      "insert into contacts (type, name, company, phone) values ('customer', $1, $2, $3) returning id",
      [`مسؤول ${label}`, `شركة ${label} ${stamp}`, phone],
    );
    return rows[0].id as number;
  }
  async function request(label: string, phone: string) {
    const r = await post("/portal/activation-requests", { companyName: `شركة ${label} ${stamp}`, phone }, "");
    expect(r.status).toBe(200);
    const { rows } = await pool.query("select id, request_count, normalized_phone, status from portal_activation_requests where normalized_phone = $1 order by id desc limit 1", [`+20${phone.slice(1)}`]);
    return rows[0] as { id: number; request_count: number; normalized_phone: string; status: string };
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

  it("الطلب الأول بيتسجّل بحدث، وتكراره بيزوّد العدّاد من غير صف جديد", async () => {
    const phone = newPhone();
    const first = await request("تكرار", phone);
    expect(first.status).toBe("pending");
    expect(first.request_count).toBe(1);
    const again = await request("تكرار", phone);
    expect(again.id).toBe(first.id);
    expect(again.request_count).toBe(2);
    const ev = await pool.query("select kind from portal_activation_request_events where request_id=$1 order by id", [first.id]);
    expect(ev.rows.map((r: any) => r.kind)).toEqual(["submitted", "repeated"]);
  });

  it("بدون صلاحية: ممنوع", async () => {
    expect((await call("/portal-admin/activation-requests", {}, "")).status).toBe(401);
  });

  it("الترشيح، القايمة، التعيين والملاحظات", async () => {
    const phone = newPhone();
    const cid = await contact("ترشيح", phone);
    const req = await request("ترشيح", phone);
    const list = await call(`/portal-admin/activation-requests?q=${phone}`);
    expect(list.status).toBe(200);
    expect(list.body.items[0].id).toBe(req.id);
    expect(list.body.counts.pending).toBeGreaterThan(0);
    const detail = await call(`/portal-admin/activation-requests/${req.id}`);
    expect(detail.body.candidates[0].id).toBe(cid);
    expect(detail.body.candidates[0].reasons).toContain("phone");
    const search = await call(`/portal-admin/activation-requests/contacts/search?q=${encodeURIComponent(`ترشيح ${stamp}`)}`);
    expect(search.body.items.some((c: any) => c.id === cid)).toBe(true);
    const meta = await call("/portal-admin/activation-requests/meta");
    const me = meta.body.reviewers[0];
    expect((await patch(`/portal-admin/activation-requests/${req.id}`, { assignedReviewerId: me.id, internalNotes: "كلّمته الصبح" })).status).toBe(200);
    const after = await call(`/portal-admin/activation-requests/${req.id}`);
    expect(after.body.request.assignedReviewerId).toBe(me.id);
    expect(after.body.request.internalNotes).toBe("كلّمته الصبح");
    expect(after.body.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(["assigned", "note", "submitted"]));
  });

  it("التأكيد بيعمل حساب وحدث، وإعادة الإرسال بتصدر رابط جديد، والتأكيد التاني ممنوع", async () => {
    const phone = newPhone();
    const cid = await contact("تأكيد", phone);
    const req = await request("تأكيد", phone);
    const ok = await patch(`/portal-activation-requests/${req.id}/confirm`, { contactId: cid, ttlMinutes: 60 });
    expect(ok.status).toBe(200);
    expect(ok.body.activation.url).toContain("token=");
    const row = await pool.query("select status, matched_portal_customer_id from portal_activation_requests where id=$1", [req.id]);
    expect(row.rows[0].status).toBe("confirmed");
    const again = await patch(`/portal-activation-requests/${req.id}/confirm`, { contactId: cid });
    expect(again.status).toBe(409);
    const re = await post(`/portal-admin/activation-requests/${req.id}/resend`, {});
    expect(re.status).toBe(200);
    expect(re.body.activation.url).toContain("token=");
    expect(re.body.activation.url).not.toBe(ok.body.activation.url);
    const ev = await pool.query("select kind from portal_activation_request_events where request_id=$1 order by id", [req.id]);
    expect(ev.rows.map((r: any) => r.kind)).toEqual(["submitted", "confirmed", "resent"]);
  });

  it("القفل بسبب، والرفض بيتسجّل، وإعادة الإرسال لطلب مش متأكد ممنوعة", async () => {
    const p1 = newPhone();
    const a = await request("قفل", p1);
    expect((await post(`/portal-admin/activation-requests/${a.id}/close`, { reason: "" })).status).toBe(400);
    expect((await post(`/portal-admin/activation-requests/${a.id}/resend`, {})).status).toBe(409);
    expect((await post(`/portal-admin/activation-requests/${a.id}/close`, { reason: "عنده حساب" })).status).toBe(200);
    expect((await post(`/portal-admin/activation-requests/${a.id}/close`, { reason: "تاني" })).status).toBe(409);
    const closed = await call("/portal-admin/activation-requests?status=closed&pageSize=200");
    expect(closed.body.items.find((i: any) => i.id === a.id).closeReason).toBe("عنده حساب");

    const b = await request("رفض", newPhone());
    expect((await patch(`/portal-activation-requests/${b.id}/reject`, { reason: "مش عميل عندنا" })).status).toBe(200);
    const ev = await pool.query("select kind, note from portal_activation_request_events where request_id=$1 order by id", [b.id]);
    expect(ev.rows.map((r: any) => r.kind)).toEqual(["submitted", "rejected"]);
    expect(ev.rows[1].note).toBe("مش عميل عندنا");
  });
});
