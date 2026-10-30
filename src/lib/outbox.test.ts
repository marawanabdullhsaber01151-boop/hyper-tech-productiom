/** @format */
import { describe, expect, it } from "vitest";
import { drainOutbox, drainOutboxEvent, enqueueOutbox, type DrainDb, type OutboxHandler } from "./outbox";

type Chunk = { value?: unknown };
/** نص الاستعلام (الأجزاء الثابتة) والقيم المتغيّرة في drizzle sql`...` */
const textOf = (q: { queryChunks: Chunk[] }) => q.queryChunks.map((c) => (c && Array.isArray(c.value) ? (c.value as string[]).join("") : "§")).join("");
const paramsOf = (q: { queryChunks: Chunk[] }) => q.queryChunks.filter((c) => !(c && Array.isArray(c.value)));

interface EventRow { id: number; event_type: string; payload: unknown; attempts: number; max_attempts: number }

function fake(events: Array<EventRow | { id: number; locked: true }>) {
  const log: string[] = [];
  const updates: unknown[][] = [];
  const database: DrainDb = {
    execute: async (q) => {
      const t = textOf(q);
      if (t.includes("SELECT id FROM outbox_events")) return { rows: events.map((e) => ({ id: e.id })) };
      if (t.includes("UPDATE outbox_events SET status =")) {
        updates.push(paramsOf(q));
        log.push("failure-update");
      }
      return { rows: [] };
    },
    transaction: async (cb) => {
      const tx = {
        execute: async (q: { queryChunks: Chunk[] }) => {
          const t = textOf(q);
          if (t.includes("FOR UPDATE SKIP LOCKED")) {
            const id = paramsOf(q)[0] as number;
            const ev = events.find((e) => e.id === id);
            return { rows: ev && !("locked" in ev) ? [ev] : [] };
          }
          if (t.includes("SET status = 'done'")) log.push("done");
          return { rows: [] };
        },
      };
      try {
        return await cb(tx);
      } catch (e) {
        log.push("rollback");
        throw e;
      }
    },
  };
  return { database, log, updates };
}
const ev = (o: Partial<EventRow> = {}): EventRow => ({ id: 1, event_type: "notify.user", payload: { userId: 1 }, attempts: 0, max_attempts: 6, ...o });

describe("عامل صندوق الصادر", () => {
  it("النجاح: المعالج بيشتغل في المعاملة والحدث يتعلّم done", async () => {
    const f = fake([ev()]);
    const seen: unknown[] = [];
    const handlers: Record<string, OutboxHandler> = { "notify.user": async (_tx, p) => void seen.push(p) };
    const r = await drainOutbox({ database: f.database, handlers });
    expect(r).toMatchObject({ picked: 1, done: 1, retried: 0, dead: 0 });
    expect(seen).toEqual([{ userId: 1 }]);
    expect(f.log).toEqual(["done"]);
  });

  it("فشل المعالج: كل أثره يتلغي (rollback) والحدث يتأجل بتراجع زمني ومحاولة مسجّلة", async () => {
    const f = fake([ev({ attempts: 0 })]);
    const r = await drainOutbox({ database: f.database, handlers: { "notify.user": async () => { throw new Error("db blip"); } } });
    expect(r).toMatchObject({ retried: 1, done: 0, dead: 0 });
    expect(f.log).toEqual(["rollback", "failure-update"]);
    expect(f.updates[0]![0]).toBe("pending");
    expect(f.updates[0]![1]).toBe(1);
    expect(f.updates[0]![2]).toBe("db blip");
    expect(typeof f.updates[0]![3]).toBe("string");
  });

  it("آخر محاولة: الحدث يبقى dead", async () => {
    const f = fake([ev({ attempts: 5, max_attempts: 6 })]);
    const r = await drainOutbox({ database: f.database, handlers: { "notify.user": async () => { throw new Error("still down"); } } });
    expect(r).toMatchObject({ dead: 1, retried: 0 });
    expect(f.updates[0]![0]).toBe("dead");
    expect(f.updates[0]![3]).toBeNull();
  });

  it("نوع حدث بلا معالج = فشل بيتسجّل (مش بيضيع)", async () => {
    const f = fake([ev({ event_type: "mystery" })]);
    const r = await drainOutbox({ database: f.database, handlers: {} });
    expect(r.retried).toBe(1);
    expect(String(f.updates[0]![2])).toContain("mystery");
  });

  it("حدث ماسوك من عامل تاني (SKIP LOCKED) = تخطي من غير تنفيذ", async () => {
    const f = fake([{ id: 1, locked: true }]);
    let called = 0;
    const r = await drainOutbox({ database: f.database, handlers: { "notify.user": async () => void (called += 1) } });
    expect(r).toMatchObject({ picked: 1, skipped: 1, done: 0 });
    expect(called).toBe(0);
  });

  it("المهلة: لو خلصت ما بيبدأش أحداث جديدة، وفشل حدث ما يوقفش الباقي", async () => {
    const stop = fake([ev()]);
    expect((await drainOutbox({ database: stop.database, handlers: {}, deadlineMs: -1 })).picked).toBe(0);
    const f = fake([ev({ id: 1 }), ev({ id: 2 })]);
    let n = 0;
    const r = await drainOutbox({ database: f.database, handlers: { "notify.user": async () => { n += 1; if (n === 1) throw new Error("x"); } } });
    expect(r).toMatchObject({ picked: 2, retried: 1, done: 1 });
  });
});

describe("الكتابة في الصندوق", () => {
  const payload = { userId: 3, type: "t", title: "عنوان", body: "نص" };
  it("حدث جديد = id، ونفس مفتاح منع التكرار = duplicate", async () => {
    const calls: unknown[] = [];
    const first = { execute: async (q: { queryChunks: Chunk[] }) => { calls.push(textOf(q)); return { rows: [{ id: "7" }] }; }, select: () => 0, update: () => 0, insert: () => 0 };
    const dup = { ...first, execute: async () => ({ rows: [] }) };
    expect(await enqueueOutbox(first, { type: "notify.user", payload, dedupeKey: "k" })).toEqual({ id: 7, duplicate: false });
    expect(await enqueueOutbox(dup, { type: "notify.user", payload, dedupeKey: "k" })).toEqual({ id: null, duplicate: true });
    expect(String(calls[0])).toContain("ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING");
  });
  it("بيانات غلط = خطأ قبل ما يلمس القاعدة", async () => {
    let touched = false;
    const ex = { execute: async () => { touched = true; return { rows: [] }; }, select: () => 0, update: () => 0, insert: () => 0 };
    await expect(enqueueOutbox(ex, { type: "notify.user", payload: { userId: 0 } as never })).rejects.toThrow();
    expect(touched).toBe(false);
  });
});

describe("drainOutboxEvent — تنفيذ حدث بعينه", () => {
  it("بينفّذ الحدث المطلوب بالرقم حتى لو في أحداث أقدم منه", async () => {
    const f = fake([ev({ id: 1 }), ev({ id: 2 }), ev({ id: 3 }), ev({ id: 4, payload: { userId: 4 } })]);
    const seen: unknown[] = [];
    const r = await drainOutboxEvent(4, { database: f.database, handlers: { "notify.user": async (_tx, p) => void seen.push(p) } });
    expect(r).toBe("done");
    expect(seen).toEqual([{ userId: 4 }]);
  });
  it("حدث مقفول أو اتنفذ قبل كده = skipped من غير أثر", async () => {
    const f = fake([{ id: 9, locked: true }]);
    expect(await drainOutboxEvent(9, { database: f.database, handlers: {} })).toBe("skipped");
    expect(f.log).toEqual([]);
  });
  it("فشل المعالج بيتسجّل على الحدث ويرجع retried", async () => {
    const f = fake([ev({ id: 5 })]);
    const r = await drainOutboxEvent(5, { database: f.database, handlers: { "notify.user": async () => { throw new Error("x"); } } });
    expect(r).toBe("retried");
    expect(f.log).toEqual(["rollback", "failure-update"]);
  });
});

