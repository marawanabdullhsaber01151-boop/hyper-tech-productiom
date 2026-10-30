/** @format */
// صندوق الصادر المضمون: الكتابة (enqueueOutbox) والعامل (drainOutbox).
// القاعدة: الحدث بيتكتب في نفس معاملة العملية (أو كاحتياطي لو الإرسال المباشر فشل)، والعامل بيعالج كل حدث في
// معاملة لوحده بقفل على صفه (FOR UPDATE SKIP LOCKED): لو المعالج فشل أو السيرفر وقع نص الطريق، كل أثره بيتلغي
// والحدث يفضل pending ويتعاد. فالإشعار الداخلي بيوصل مرة واحدة بالظبط، والرسالة الخارجية مرة على الأقل.

import { sql } from "drizzle-orm";
import type { Executor } from "./db-executor";
import { logger } from "./logger";
import { MAX_ATTEMPTS, afterFailure, validatePayload, type OutboxPayloadMap, type OutboxType } from "./outboxCore";

export interface EnqueueInput<T extends OutboxType> {
  type: T;
  payload: OutboxPayloadMap[T];
  /** نفس المفتاح مرتين = حدث واحد (يمنع تكرار الرسالة). */
  dedupeKey?: string | null;
  maxAttempts?: number;
  runAt?: Date;
}

export async function enqueueOutbox<T extends OutboxType>(executor: Executor, input: EnqueueInput<T>): Promise<{ id: number | null; duplicate: boolean }> {
  const v = validatePayload(input.type, input.payload);
  if (!v.ok) throw new Error(v.message);
  const runAt = (input.runAt ?? new Date()).toISOString();
  const r = await executor.execute(sql`
    INSERT INTO outbox_events (event_type, payload, dedupe_key, max_attempts, next_attempt_at)
    VALUES (${input.type}, ${JSON.stringify(v.value)}::jsonb, ${input.dedupeKey ?? null}, ${input.maxAttempts ?? MAX_ATTEMPTS}, ${runAt}::timestamptz)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING id`);
  const row = (r.rows as Array<{ id: string | number }>)[0];
  return row ? { id: Number(row.id), duplicate: false } : { id: null, duplicate: true };
}

export type OutboxHandler = (tx: Executor, payload: unknown) => Promise<void>;

export interface DrainResult {
  picked: number;
  done: number;
  retried: number;
  dead: number;
  skipped: number;
  purged: number;
}

/** القاعدة بالشكل اللي العامل محتاجه (للاختبار بدون قاعدة حقيقية). */
export interface DrainDb {
  execute: (q: any) => Promise<any>;
  transaction: <T>(cb: (tx: any) => Promise<T>) => Promise<T>;
}
export interface DrainDeps {
  database?: DrainDb;
  handlers?: Record<string, OutboxHandler>;
}

// استيراد القاعدة بالكسل: الملف ده بيتختبر من غير DATABASE_URL.
async function realDb(): Promise<DrainDb> {
  return (await import("../db")).db as unknown as DrainDb;
}

type Row = { id: string | number; event_type: string; payload: unknown; attempts: number; max_attempts: number };

async function processOne(db: DrainDb, id: number, handlers: Record<string, OutboxHandler>): Promise<"done" | "retried" | "dead" | "skipped" | "error"> {
  // كائن بدل متغيرات: TS مبيشوفش التعيين جوه الـcallback فكان هيضيّق النوع غلط
  const ctx: { state: "done" | "skipped"; seen?: Row } = { state: "skipped" };
  try {
    await db.transaction(async (tx: any) => {
      const locked = await tx.execute(sql`
        SELECT id, event_type, payload, attempts, max_attempts FROM outbox_events
        WHERE id = ${id} AND status = 'pending' FOR UPDATE SKIP LOCKED`);
      const ev = (locked.rows as Row[])[0];
      if (!ev) return;
      ctx.seen = ev;
      const handler = handlers[ev.event_type];
      if (!handler) throw new Error(`مفيش معالج لنوع الحدث ${ev.event_type}`);
      await handler(tx as unknown as Executor, ev.payload);
      await tx.execute(sql`UPDATE outbox_events SET status = 'done', attempts = attempts + 1, processed_at = now(), last_error = NULL WHERE id = ${id}`);
      ctx.state = "done";
    });
    return ctx.state;
  } catch (error) {
    const seen = ctx.seen;
    if (!seen) {
      logger.error("outbox: تعذّر قراءة الحدث", { id, error: error instanceof Error ? error.message : String(error) });
      return "error";
    }
    const f = afterFailure({ attempts: seen.attempts, maxAttempts: seen.max_attempts, now: new Date(), error });
    try {
      await db.execute(sql`
        UPDATE outbox_events SET status = ${f.status}, attempts = ${f.attempts}, last_error = ${f.lastError},
          next_attempt_at = COALESCE(${f.nextAttemptAt ? f.nextAttemptAt.toISOString() : null}::timestamptz, next_attempt_at)
        WHERE id = ${id} AND status = 'pending'`);
    } catch (e) {
      logger.error("outbox: تعذّر تسجيل الفشل", { id, error: e instanceof Error ? e.message : String(e) });
      return "error";
    }
    logger.warn(f.status === "dead" ? "outbox: حدث فشل نهائيًا" : "outbox: حدث فشل وهيتعاد", { id, type: seen.event_type, attempts: f.attempts, error: f.lastError });
    return f.status === "dead" ? "dead" : "retried";
  }
}

/**
 * ينفّذ حدث واحد بعينه (بالرقم) فورًا. بنستخدمه بعد enqueueOutbox عشان التنبيه اللي لسه اتكتب يتجرّب هو بالذات،
 * مش «أقدم 3 أحداث» (كان ممكن أحداث قديمة تاخد الدور وتنبيهنا يستنى 15 دقيقة). فشله بيتسجّل على الحدث ويتعاد.
 */
export async function drainOutboxEvent(id: number, deps: DrainDeps = {}): Promise<"done" | "retried" | "dead" | "skipped" | "error"> {
  const db = deps.database ?? (await realDb());
  const handlers = deps.handlers ?? (await import("./outboxHandlers")).OUTBOX_HANDLERS;
  return processOne(db, id, handlers);
}

/**
 * ينفّذ الأحداث المستحقة (الأقدم أولًا) حتى limit أو مهلة deadlineMs. ما بيرميش بسبب فشل حدث: الفشل بيتسجّل على الحدث نفسه ويكمّل الباقي.
 * متعدد التشغيل بأمان: تشغيلتين متزامنتين ما بيمسكوش نفس الحدث (SKIP LOCKED).
 */
export async function drainOutbox(opts: { limit?: number; deadlineMs?: number } & DrainDeps = {}): Promise<DrainResult> {
  const result: DrainResult = { picked: 0, done: 0, retried: 0, dead: 0, skipped: 0, purged: 0 };
  const db = opts.database ?? (await realDb());
  const handlers = opts.handlers ?? (await import("./outboxHandlers")).OUTBOX_HANDLERS;
  const deadline = Date.now() + (opts.deadlineMs ?? 20_000);
  const due = await db.execute(sql`
    SELECT id FROM outbox_events WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY id LIMIT ${opts.limit ?? 25}`);
  for (const r of due.rows as Array<{ id: string | number }>) {
    if (Date.now() > deadline) break;
    result.picked += 1;
    const o = await processOne(db, Number(r.id), handlers);
    if (o === "done") result.done += 1;
    else if (o === "retried") result.retried += 1;
    else if (o === "dead") result.dead += 1;
    else result.skipped += 1;
  }
  return result;
}

/** مسح الأحداث المنفّذة الأقدم من 30 يوم (الـdead بتفضل للمراجعة). */
export async function purgeDoneOutbox(database?: DrainDb): Promise<number> {
  const db = database ?? (await realDb());
  const r = await db.execute(sql`DELETE FROM outbox_events WHERE status = 'done' AND processed_at < now() - interval '30 days'`);
  return Number((r as unknown as { rowCount?: number }).rowCount ?? 0);
}
