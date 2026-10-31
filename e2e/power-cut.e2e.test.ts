import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg, { Pool } from "pg";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * خطوة 31 — «قطع التيار» حقيقي على PostgreSQL.
 *
 * الفكرة: نشغّل العملية مرة سليمة ونعدّ كام كتابة (INSERT/UPDATE/DELETE) بتعمل. بعدها نعيدها
 * ونقطع عند كل كتابة بالترتيب (الكتابة رقم i بتفشل كأن الجهاز وقع قبلها). بعد كل قطع لازم
 * الحالة تبقى «قبل» بالكامل، أو «بعد» بالكامل لو العملية كانت خلصت أصلًا. أي حالة تانية = نصف حفظ.
 *
 * القطع بيتحقن في pg.Client.query، فبيشمل كل الطرق (المسار، المعاملة، الدوال المساعدة).
 */
const enabled = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_ADMIN_PASSWORD);
const suite = describe.skipIf(!enabled);

const WRITE = /^\s*(insert|update|delete)\b/i;
const state: { armed: boolean; cutAt: number; seen: number } = { armed: false, cutAt: Infinity, seen: 0 };
const proto = (pg as unknown as { Client: { prototype: Record<string, unknown> } }).Client.prototype;
const originalQuery = proto.query as (...a: unknown[]) => unknown;

function installCut() {
  proto.query = function (this: unknown, ...args: unknown[]) {
    const first = args[0] as string | { text?: string } | undefined;
    const text = typeof first === "string" ? first : (first?.text ?? "");
    if (state.armed && WRITE.test(text)) {
      state.seen += 1;
      if (state.seen === state.cutAt) {
        const err = new Error(`POWER_CUT عند الكتابة رقم ${state.cutAt}`);
        const cb = args[args.length - 1];
        if (typeof cb === "function") {
          queueMicrotask(() => (cb as (e: Error) => void)(err));
          return undefined;
        }
        return Promise.reject(err);
      }
    }
    return originalQuery.apply(this, args);
  };
}

interface Scenario<C> {
  name: string;
  prepare(): Promise<C>;
  /** بترجّع ok=false لو العملية فشلت (HTTP غير 2xx أو استثناء). */
  run(ctx: C): Promise<{ ok: boolean }>;
  /** حالة العمل بدون أي معرّفات أو أوقات (بتتقارن بين تشغيلات مختلفة). */
  observe(ctx: C): Promise<unknown>;
}

async function cutEveryPoint<C>(s: Scenario<C>) {
  const dry = await s.prepare();
  const before0 = await s.observe(dry);
  state.armed = true; state.cutAt = Infinity; state.seen = 0;
  const first = await s.run(dry).catch(() => ({ ok: false }));
  state.armed = false;
  expect(first.ok, `${s.name}: التشغيل السليم لازم ينجح`).toBe(true);
  const after0 = await s.observe(dry);
  const total = state.seen;
  expect(total, `${s.name}: لازم فيه كتابتين على الأقل`).toBeGreaterThanOrEqual(2);
  expect(after0, `${s.name}: العملية لازم تغيّر الحالة`).not.toEqual(before0);

  for (let i = 1; i <= total; i++) {
    const ctx = await s.prepare();
    const before = await s.observe(ctx);
    state.armed = true; state.cutAt = i; state.seen = 0;
    const result = await s.run(ctx).catch(() => ({ ok: false }));
    state.armed = false;
    const after = await s.observe(ctx);
    // كله أو لا شيء: لو العملية رجعت نجاح تبقى الحالة «بعد»، وغير كده لازم تبقى «قبل» بالظبط.
    expect(after, `${s.name}: قطع عند الكتابة ${i} من ${total} (${result.ok ? "العملية خلصت" : "العملية فشلت"})`).toEqual(result.ok ? after0 : before);
  }
  return total;
}

suite("خطوة 31 — قطع التيار عند كل كتابة: لا نصف حفظ (PostgreSQL حقيقي)", () => {
  let pool: Pool;
  let db: any;
  let server: { address(): any; close(cb?: (err?: Error) => void): void };
  let baseUrl = "";
  let adminToken = "";
  let adminId = 0;
  const stamp = Date.now().toString().slice(-7);
  let counter = 0;
  const PASS = "Secret#123";

  async function call(path: string, init: RequestInit = {}, token = "") {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });
    const raw = await response.json().catch(() => null);
    return { status: response.status, body: raw && typeof raw === "object" && "data" in raw ? (raw as any).data : raw };
  }
  const send = (method: string, path: string, body: unknown) => call(path, { method, body: JSON.stringify(body) }, adminToken);

  async function newStaff(role = "production_manager") {
    const username = `pc${stamp}${++counter}`;
    const { rows } = await pool.query(
      "insert into system_users (username, password_hash, full_name, role, status) values ($1,$2,$3,$4,'active') returning id",
      [username, await bcrypt.hash(PASS, 10), "موظف تجربة القطع", role],
    );
    return { id: rows[0].id as number, username };
  }
  const q = async (text: string, params: unknown[]) => (await pool.query(text, params)).rows;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    process.env.LOGIN_RATE_MAX = "1000";
    process.env.RECOVERY_RATE_MAX = "1000";
    const { default: app } = await import("../src/main");
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    db = drizzle(pool);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
    const r = await call("/auth/login", { method: "POST", body: JSON.stringify({ username: process.env.E2E_ADMIN_USERNAME ?? "admin", password: process.env.E2E_ADMIN_PASSWORD }) });
    expect(r.status).toBe(200);
    adminToken = r.body.token;
    adminId = r.body.user?.id ?? 0;
    installCut();
  });

  afterAll(async () => {
    state.armed = false;
    proto.query = originalQuery;
    await pool?.end();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("المراقب نفسه سليم: من غير قطع، الحقن ما بيغيّرش أي سلوك", async () => {
    state.armed = true; state.cutAt = Infinity; state.seen = 0;
    const r = await call("/auth/me", {}, adminToken);
    state.armed = false;
    expect(r.status).toBe(200);
    expect(state.seen).toBe(0);
  });

  it("طلب تفعيل من عميل قديم: الطلب وحدثه معًا أو ولا حاجة (جديد ومكرر)", async () => {
    // 11 رقم بالظبط (01x + 6 + 2): من غير قص بيخلّي أرقام مختلفة تتصادم
    const phone = () => `012${stamp.slice(-6)}${String(10 + (++counter % 90))}`;
    for (const repeat of [false, true]) {
      const total = await cutEveryPoint<{ phone: string }>({
        name: repeat ? "طلب تفعيل مكرر" : "طلب تفعيل جديد",
        prepare: async () => {
          const p = phone();
          if (repeat) expect((await call("/portal/activation-requests", { method: "POST", body: JSON.stringify({ companyName: "شركة القطع", phone: p }) })).status).toBe(200);
          return { phone: p };
        },
        run: async (c) => ({ ok: (await call("/portal/activation-requests", { method: "POST", body: JSON.stringify({ companyName: "شركة القطع", phone: c.phone }) })).status === 200 }),
        observe: async (c) => {
          const [row] = await q(
            `select count(*)::int rows, coalesce(sum(request_count),0)::int reqs,
                    (select count(*)::int from portal_activation_request_events e join portal_activation_requests r2 on r2.id = e.request_id where r2.phone_entered = $1) events
               from portal_activation_requests where phone_entered = $1`,
            [c.phone],
          );
          return row;
        },
      });
      expect(total).toBeGreaterThanOrEqual(2);
    }
  });

  it("استثناء صلاحية: القديم يتقفل والجديد يتضاف معًا (دايمًا استثناء نشط واحد بالظبط)", async () => {
    await cutEveryPoint<{ userId: number }>({
      name: "منح استثناء صلاحية",
      prepare: async () => {
        const u = await newStaff();
        const r = await send("POST", "/permission-overrides", { userId: u.id, actionKey: "tasks.assign", allowed: true });
        expect(r.status).toBe(201);
        return { userId: u.id };
      },
      run: async (c) => ({ ok: (await send("POST", "/permission-overrides", { userId: c.userId, actionKey: "tasks.assign", allowed: false })).status === 201 }),
      observe: async (c) =>
        q("select allowed from permission_overrides where user_id = $1 and action_key = 'tasks.assign' and revoked_at is null", [c.userId]),
    });
  });

  it("تغيير دور موظف: الدور وقفل جلساته القديمة معًا", async () => {
    await cutEveryPoint<{ id: number; username: string }>({
      name: "تغيير دور موظف",
      prepare: async () => {
        const u = await newStaff("production_manager");
        const l = await call("/auth/login", { method: "POST", body: JSON.stringify({ username: u.username, password: PASS }) });
        expect(l.status).toBe(200);
        return u;
      },
      run: async (c) => ({ ok: (await send("PATCH", `/users/${c.id}`, { role: "hr_manager" })).status === 200 }),
      observe: async (c) => {
        const [u] = await q("select role from system_users where id = $1", [c.id]);
        const [s] = await q("select count(*)::int active from login_sessions where user_id = $1 and revoked_at is null", [c.id]);
        return { role: u.role, activeSessions: s.active };
      },
    });
  });

  it("مهمة بشرية (خطوة 30): الإنشاء ثم الإنجاز، كل واحدة كلها أو ولا حاجة", async () => {
    const svc = await import("../src/lib/humanTasks");
    const actor = { userId: adminId, roles: ["chairman"], isManager: true };
    const observe = async (c: { key: string }) => {
      const [t] = await q("select count(*)::int n, coalesce(max(status),'-') status from human_tasks where dedupe_key = $1", [c.key]);
      const [e] = await q("select count(*)::int n from human_task_events ev join human_tasks t on t.id = ev.task_id where t.dedupe_key = $1", [c.key]);
      return { tasks: t.n, status: t.status, events: e.n };
    };
    await cutEveryPoint<{ key: string }>({
      name: "إنشاء مهمة",
      prepare: async () => ({ key: `pc:${stamp}:${++counter}` }),
      run: async (c) => {
        await svc.createTask({ title: "مهمة تجربة القطع", assigneeUserId: adminId, dedupeKey: c.key }, adminId, db);
        return { ok: true };
      },
      observe,
    });
    await cutEveryPoint<{ key: string; id: number }>({
      name: "إنجاز مهمة",
      prepare: async () => {
        const key = `pc:${stamp}:${++counter}`;
        const { task } = await svc.createTask({ title: "مهمة تجربة الإنجاز", assigneeUserId: adminId, dedupeKey: key }, adminId, db);
        return { key, id: task.id };
      },
      run: async (c) => {
        await svc.completeTask(c.id, "تم التنفيذ", actor, db);
        return { ok: true };
      },
      observe,
    });
  });
});
