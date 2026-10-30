import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const enabled = Boolean(process.env.E2E_DATABASE_URL);
const suite = describe.skipIf(!enabled);

suite("الخطوة 30 — مهمة بشرية تتصعّد وحدها + saga (PostgreSQL حقيقي)", () => {
  let pool: Pool;
  let db: any;
  let svc: typeof import("../src/lib/humanTasks");
  let sagas: typeof import("../src/lib/sagas");
  let userId = 0;
  const stamp = Date.now();
  const actor = () => ({ userId, roles: ["sales_manager"], isManager: true });

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    db = drizzle(pool);
    svc = await import("../src/lib/humanTasks");
    sagas = await import("../src/lib/sagas");
    const { rows } = await pool.query("select id from system_users order by id limit 1");
    userId = rows[0].id;
  });
  afterAll(async () => {
    await pool.end();
  });

  const create = (over: Record<string, unknown> = {}) =>
    svc.createTask({ title: "اتصل بالعميل", assigneeUserId: userId, escalateToRole: "executive_manager", dueAt: new Date(Date.now() - 60_000), dedupeKey: `e2e:${stamp}:${Math.random()}`, ...over }, userId, db);

  it("مهمة متأخرة تتصعّد مستوى 1 ثم 2 وحدها ويتسجّل كل ده، وبدون تكرار لو العامل اتشغّل تاني", async () => {
    const { task } = await create();
    const now = new Date();
    await svc.runEscalations({ database: db, now });
    let t = (await svc.getTaskDetail(task.id, actor(), db)).task;
    expect(t.escalationLevel).toBe(1);
    expect(t.priority).toBe("high");
    await svc.runEscalations({ database: db, now });
    expect((await svc.getTaskDetail(task.id, actor(), db)).task.escalationLevel).toBe(1);
    await svc.runEscalations({ database: db, now: new Date(Date.now() + 25 * 3_600_000) });
    const d = await svc.getTaskDetail(task.id, actor(), db);
    t = d.task;
    expect(t.escalationLevel).toBe(2);
    expect(t.priority).toBe("urgent");
    expect(d.events.map((e) => e.event)).toEqual(["created", "escalated_l1", "escalated_l2"]);
    const n = await pool.query("select count(*)::int c from notifications where reference_type = 'human_task' and reference_id = $1", [task.id]);
    expect(n.rows[0].c).toBeGreaterThanOrEqual(2);
  });

  it("المهمة المنفّذة ما بتتصعّدش، ونفس dedupeKey = نفس المهمة", async () => {
    const key = `e2e:${stamp}:dup`;
    const a = await create({ dedupeKey: key });
    const b = await create({ dedupeKey: key });
    expect(b.duplicate).toBe(true);
    expect(b.task.id).toBe(a.task.id);
    await svc.completeTask(a.task.id, "اتصلت وتم الاتفاق", actor(), db);
    await svc.runEscalations({ database: db, now: new Date(Date.now() + 3_600_000) });
    expect((await svc.getTaskDetail(a.task.id, actor(), db)).task.escalationLevel).toBe(0);
    await expect(svc.completeTask(a.task.id, "تاني", actor(), db)).rejects.toThrow();
  });

  it("موظف مش صاحب المهمة ما يقدرش ينفّذها", async () => {
    const { task } = await create();
    await expect(svc.completeTask(task.id, "محاولة", { userId: userId + 9999, roles: ["buyer"], isManager: false }, db)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("saga: بتنشئ مهمة اتصال وتستنى، ولما تتنفذ تكمل وتخلّص", async () => {
    const { id } = await sagas.startSaga({ type: "follow_up_call", state: { title: `متابعة ${stamp}`, assigneeUserId: userId }, dedupeKey: `e2e:${stamp}:saga` }, { database: db });
    const later = new Date(Date.now() + 5_000);
    await sagas.advanceSaga(id, { database: db, now: later });
    let s = (await pool.query("select status, waiting_task_id from saga_instances where id = $1", [id])).rows[0];
    expect(s.status).toBe("waiting");
    const taskId = Number(s.waiting_task_id);
    await svc.completeTask(taskId, "اتصلت بالعميل", actor(), db);
    const later2 = new Date(Date.now() + 5 * 60_000);
    await sagas.advanceSaga(id, { database: db, now: later2 });
    await sagas.advanceSaga(id, { database: db, now: new Date(later2.getTime() + 60_000) });
    await sagas.advanceSaga(id, { database: db, now: new Date(later2.getTime() + 120_000) });
    s = (await pool.query("select status from saga_instances where id = $1", [id])).rows[0];
    expect(s.status).toBe("completed");
  });
});
