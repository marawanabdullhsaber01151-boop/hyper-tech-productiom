#!/usr/bin/env node
/**
 * Chat end-to-end smoke test against a RUNNING server + its database.
 *   BASE_URL=http://localhost:3055 node scripts/chat-smoke-test.mjs
 * Seeds throw-away users/customers (prefix "chattest_"), exercises the real
 * HTTP API and cleans up. Requires migrations 0066 + 0067.
 */
import "dotenv/config";
import jwt from "jsonwebtoken";
import pkg from "pg";
import { randomBytes, randomUUID } from "node:crypto";

const BASE = process.env.BASE_URL || "http://localhost:3055";
const pool = new pkg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
let failed = 0;
const ok = (cond, name) => {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  if (!cond) failed += 1;
};

async function staff(username, role) {
  const [u] = await q(
    `INSERT INTO system_users (username, password_hash, full_name, role, status) VALUES ($1,'x',$2,$3,'active') RETURNING id`,
    [username, `موظف ${username}`, role],
  );
  const [s] = await q(`INSERT INTO login_sessions (user_id) VALUES ($1) RETURNING id`, [u.id]);
  const token = jwt.sign({ userId: u.id, username, role, sessionId: s.id }, process.env.JWT_SECRET, { expiresIn: "1h" });
  return { id: u.id, token };
}
async function customer(tag) {
  const [c] = await q(`INSERT INTO contacts (name, type) VALUES ($1,'customer') RETURNING id`, [`chattest_${tag}`]).catch(() => [null]);
  return c;
}

const call = (token) => async (method, path, body) => {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  const data = json && "data" in json ? json.data : json;
  return { status: res.status, data, raw: json };
};

const tag = randomBytes(3).toString("hex");
const created = { users: [], customers: [] };
try {
  // ── seed ──
  const manager = await staff(`chattest_mgr_${tag}`, "sales_manager");
  const seller = await staff(`chattest_sel_${tag}`, "online_seller");
  const seller2 = await staff(`chattest_sel2_${tag}`, "offline_seller");
  const exec = await staff(`chattest_exec_${tag}`, "executive_manager");
  const buyer = await staff(`chattest_buy_${tag}`, "buyer"); // لا وصول افتراضيًا
  const chair = await staff(`chattest_chr_${tag}`, "chairman");
  created.users.push(manager.id, seller.id, seller2.id, exec.id, buyer.id, chair.id);

  const [contact] = await q(`SELECT id FROM contacts LIMIT 1`);
  let contactId = contact?.id;
  if (!contactId) {
    const [c] = await q(`INSERT INTO contacts (name) VALUES ('chattest') RETURNING id`);
    contactId = c.id;
  }
  const [pc] = await q(
    `INSERT INTO portal_customers (phone, password_hash, full_name, company_name, contact_id, assigned_sales_user_id, normalized_phone)
     VALUES ($1,'x','عميل تجريبي','شركة تجريبية',$2,$3,$1) RETURNING id`,
    [`019${Math.floor(Math.random() * 1e8)}`, contactId, seller.id],
  );
  created.customers.push(pc.id);
  const ptoken = randomBytes(24).toString("base64url");
  await q(`INSERT INTO portal_sessions (portal_customer_id, session_token, expires_at) VALUES ($1,$2, now() + interval '1 hour')`, [pc.id, ptoken]);

  const C = call(ptoken), M = call(manager.token), S1 = call(seller.token), S2 = call(seller2.token), E = call(exec.token), B = call(buyer.token);

  // ── customer sends ──
  const cid = randomUUID();
  let r = await C("POST", "/portal/chat/messages", { body: "مرحبا، عايز سعر", clientMsgId: cid, topic: "price" });
  ok(r.status === 201 && r.data.message.body === "مرحبا، عايز سعر", "العميل يرسل رسالة (201)");
  r = await C("POST", "/portal/chat/messages", { body: "مرحبا، عايز سعر", clientMsgId: cid, topic: "price" });
  ok(r.status === 200 && r.data.duplicate === true, "إعادة الإرسال بنفس clientMsgId لا تكرر الرسالة");
  r = await C("POST", "/portal/chat/messages", { body: "x", clientMsgId: "not-a-uuid" });
  ok(r.status >= 400 && r.status < 500, "clientMsgId غير صالح مرفوض");
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==";
  r = await C("POST", "/portal/chat/messages", { body: "", clientMsgId: randomUUID(), image: png });
  ok(r.status === 201 && r.data.message.attachment, "إرسال صورة صالحة");
  const attId = r.data.message.attachment?.id;
  r = await C("POST", "/portal/chat/messages", { body: "", clientMsgId: randomUUID(), image: "data:image/png;base64,AAAA" });
  ok(r.status === 400, "ملف ليس صورة حقيقية مرفوض (فحص البايتات)");

  r = await C("GET", "/portal/chat");
  const convId = r.data.conversation.id;
  ok(r.data.messages.length >= 2, "العميل يفتح المحادثة ويرى رسائله");

  // ── staff access matrix ──
  r = await M("GET", "/chat/inbox");
  ok(r.status === 200 && r.data.items.some((c) => c.id === convId), "مدير المبيعات يرى المحادثة");
  r = await S1("GET", `/chat/conversations/${convId}`);
  ok(r.status === 200 && r.data.conversation.access.canReply, "المسؤول المعيّن يفتح ويرد");
  r = await S2("GET", `/chat/conversations/${convId}`);
  ok(r.status === 404, "بائع آخر (غير المسؤول) لا يرى المحادثة (404)");
  r = await E("GET", `/chat/conversations/${convId}`);
  ok(r.status === 200 && r.data.conversation.access.readOnly, "المدير التنفيذي مراقب (قراءة فقط)");
  r = await E("POST", `/chat/conversations/${convId}/messages`, { body: "تجربة", clientMsgId: randomUUID() });
  ok(r.status === 403, "المراقب لا يستطيع الرد");
  r = await B("GET", "/chat/inbox");
  ok(r.status === 403, "دور بلا صلاحية (مشتري) ممنوع");

  // ── reply ──
  r = await S1("POST", `/chat/conversations/${convId}/messages`, { body: "أهلاً بيك", clientMsgId: randomUUID() });
  ok(r.status === 201, "الموظف يرد");
  r = await S1("POST", `/chat/conversations/${convId}/messages`, { body: "ملاحظة سرية", clientMsgId: randomUUID(), internal: true });
  ok(r.status === 201, "ملاحظة داخلية");
  r = await C("GET", "/portal/chat");
  ok(r.data.messages.some((m) => m.body === "أهلاً بيك") && !r.data.messages.some((m) => m.body === "ملاحظة سرية"), "العميل يرى الرد ولا يرى الملاحظة الداخلية");
  if (attId) {
    r = await fetch(`${BASE}/api/v1/portal/chat/attachments/${attId}`, { headers: { Authorization: `Bearer ${ptoken}` } });
    ok(r.status === 200 && r.headers.get("content-type") === "image/png", "العميل يحمّل صورته");
    r = await fetch(`${BASE}/api/v1/chat/attachments/${attId}`, { headers: { Authorization: `Bearer ${seller2.token}` } });
    ok(r.status === 404 || r.status === 403, "موظف غير مسؤول لا يحمّل صور المحادثة");
  }

  // ── flexible access (the manager decides who replies) ──
  r = await M("PUT", `/chat/staff-access/${seller2.id}`, { mode: "agent" });
  ok(r.status === 200, "المدير يمنح seller2 صلاحية الرد");
  r = await M("PUT", `/chat/staff-access/${buyer.id}`, { mode: "agent" });
  ok(r.status === 200, "المدير يمنح المشتري صلاحية الرد (تجاوز الدور)");
  r = await B("GET", "/chat/inbox");
  ok(r.status === 200, "المشتري يدخل الآن بتجاوز المدير");
  r = await M("PUT", `/chat/staff-access/${exec.id}`, { mode: "none" });
  r = await E("GET", "/chat/inbox");
  ok(r.status === 403, "المدير يسحب صلاحية المدير التنفيذي");
  r = await S1("PUT", `/chat/staff-access/${seller2.id}`, { mode: "manager" });
  ok(r.status === 403, "الموظف العادي لا يغيّر الصلاحيات");
  r = await M("PUT", `/chat/staff-access/${manager.id}`, { mode: "none" });
  ok(r.status === 400, "لا يستطيع تعديل صلاحيته هو (منع القفل الذاتي)");
  r = await M("PUT", `/chat/staff-access/${buyer.id}`, { mode: null });
  r = await B("GET", "/chat/inbox");
  ok(r.status === 403, "إزالة التجاوز تعيد الافتراضي");
  r = await M("GET", "/chat/assignable-users");
  ok(r.data.some((u) => u.id === seller2.id) && !r.data.some((u) => u.id === buyer.id), "قائمة التحويل تتبع الصلاحيات الفعلية");

  // ── transfer / close / rating / reopen ──
  r = await M("POST", `/chat/conversations/${convId}/transfer`, { toUserId: seller2.id });
  ok(r.status === 200, "تحويل المحادثة");
  r = await S1("GET", `/chat/conversations/${convId}`);
  ok(r.status === 404, "المسؤول السابق فقد الوصول بعد التحويل");
  r = await S2("POST", `/chat/conversations/${convId}/close`, {});
  ok(r.status === 200, "إغلاق المحادثة");
  r = await C("POST", "/portal/chat/rating", { stars: 5, comment: "ممتاز" });
  ok(r.status === 201, "العميل يقيّم");
  r = await C("POST", "/portal/chat/rating", { stars: 1 });
  ok(r.status === 409, "تقييم مكرر مرفوض");
  r = await S2("POST", `/chat/conversations/${convId}/messages`, { body: "هل من جديد؟", clientMsgId: randomUUID() });
  ok(r.status === 409, "الرد على محادثة مغلقة مرفوض");
  r = await S2("POST", `/chat/conversations/${convId}/reopen`, {});
  ok(r.status === 200, "إعادة الفتح");

  // ── polling cursor ──
  r = await C("GET", "/portal/chat");
  const last = r.data.messages.at(-1).id;
  r = await C("GET", `/portal/chat/poll?after=${last}`);
  ok(r.status === 200 && r.data.messages.length === 0, "poll بدون جديد يرجّع فارغ");

  // ── settings (manager-editable hours) + chairman + push ──
  const CH = call(chair.token);
  r = await CH("GET", "/chat/inbox");
  ok(r.status === 200, "الرئيس يدخل الشات");
  r = await CH("POST", `/chat/conversations/${convId}/messages`, { body: "رد من الرئيس", clientMsgId: randomUUID() });
  ok(r.status === 201, "الرئيس يستطيع الرد (صلاحية كاملة)");
  r = await M("GET", "/chat/settings");
  ok(r.status === 200 && Array.isArray(r.data.openDays), "قراءة الإعدادات");
  const cfg = r.data;
  r = await S2("PUT", "/chat/settings", cfg);
  ok(r.status === 403, "الموظف العادي لا يعدّل الإعدادات");
  r = await M("PUT", "/chat/settings", { ...cfg, openDays: [] });
  ok(r.status === 400, "إعدادات غير صالحة مرفوضة (لا أيام عمل)");
  r = await M("PUT", "/chat/settings", { ...cfg, closeMinute: cfg.openMinute - 1 });
  ok(r.status === 400, "إغلاق قبل الفتح مرفوض");
  r = await M("PUT", "/chat/settings", { ...cfg, whatsappNumber: "+20100" });
  ok(r.status === 400, "رقم واتساب غير صالح مرفوض");
  // اجعل كل الأيام والساعات مفتوحة → العميل يرى isOpen=true ورقم واتساب
  r = await M("PUT", "/chat/settings", { ...cfg, openDays: [0, 1, 2, 3, 4, 5, 6], openMinute: 0, closeMinute: 1440, holidays: [], whatsappNumber: "201001234567" });
  ok(r.status === 200, "المدير يحفظ ساعات 24/7");
  r = await C("GET", "/portal/chat");
  ok(r.data.conversation.hours.isOpen === true && r.data.conversation.hours.whatsappNumber === "201001234567", "العميل يرى الساعات الجديدة وزر واتساب فورًا");
  // اجعلها مغلقة دائمًا (كل الأيام إجازة اليوم) → رد تلقائي
  const todayCairo = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  r = await M("PUT", "/chat/settings", { ...cfg, openDays: [0, 1, 2, 3, 4, 5, 6], openMinute: 0, closeMinute: 1440, holidays: [todayCairo], autoReplyEnabled: true, autoReplyText: "ردنا التلقائي المخصص", whatsappNumber: null });
  r = await C("GET", "/portal/chat");
  ok(r.data.conversation.hours.isOpen === false, "إجازة اليوم تجعل الشات مغلقًا");
  await q(`UPDATE chat_conversations SET last_auto_reply_at = NULL WHERE id = $1`, [convId]); // تجاوز فاصل الـ 6 ساعات
  r = await C("POST", "/portal/chat/messages", { body: "رسالة وقت الإجازة", clientMsgId: randomUUID() });
  r = await C("GET", "/portal/chat");
  ok(r.data.messages.some((m) => m.body === "ردنا التلقائي المخصص"), "الرد التلقائي يستخدم نص المدير");
  // استعد الإعدادات الأصلية
  await M("PUT", "/chat/settings", cfg);
  // push
  r = await C("GET", "/portal/chat/push-key");
  ok(r.status === 200 && "publicKey" in r.data, "مفتاح Push متاح (null إن لم يُضبط VAPID)");
  const sub = { endpoint: "https://push.example.com/abc" + tag, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } };
  r = await C("POST", "/portal/chat/push-subscribe", sub);
  ok(r.status === 201, "اشتراك Push للعميل");
  r = await C("POST", "/portal/chat/push-subscribe", { ...sub, endpoint: "http://insecure.example/x" });
  ok(r.status === 400, "endpoint غير https مرفوض");
  r = await S2("POST", "/chat/push-subscribe", sub);
  ok(r.status === 201, "نفس الجهاز ينتقل لحساب الموظف دون تكرار");
  const subs = await q(`SELECT audience FROM chat_push_subscriptions WHERE endpoint = $1`, [sub.endpoint]);
  ok(subs.length === 1 && subs[0].audience === "staff", "صف اشتراك واحد فقط بعد النقل");
  r = await S2("POST", "/chat/push-unsubscribe", { endpoint: sub.endpoint });
  ok(r.status === 200, "إلغاء الاشتراك");

  // ── reports ──
  r = await M("GET", "/chat/reports?days=30");
  ok(r.status === 200 && r.data.totals && r.data.ratingDistribution, "التقارير تعمل للمدير");
  console.log("   تقرير:", JSON.stringify(r.data.responseTime.overall), "totals:", JSON.stringify(r.data.totals));
  r = await S2("GET", "/chat/reports");
  ok(r.status === 403, "التقارير ممنوعة على الموظف العادي");
} catch (e) {
  console.error("💥", e);
  failed += 1;
} finally {
  if (created.customers.length) {
    await q(`DELETE FROM chat_push_subscriptions WHERE endpoint LIKE '%'||$1`, [tag]).catch(() => {});
    await q(`DELETE FROM chat_conversations WHERE portal_customer_id = ANY($1)`, [created.customers]).catch(() => {});
    await q(`DELETE FROM portal_sessions WHERE portal_customer_id = ANY($1)`, [created.customers]).catch(() => {});
    await q(`DELETE FROM portal_customers WHERE id = ANY($1)`, [created.customers]).catch(() => {});
  }
  if (created.users.length) {
    await q(`DELETE FROM login_sessions WHERE user_id = ANY($1)`, [created.users]).catch(() => {});
    await q(`DELETE FROM system_users WHERE id = ANY($1)`, [created.users]).catch((e) => console.log("cleanup:", e.message));
  }
  await pool.end();
  console.log(failed ? `\n❌ ${failed} فشل` : "\n✅ كل الاختبارات نجحت");
  process.exit(failed ? 1 : 0);
}
