/** @format */
// تنفيذ الـsaga على القاعدة: كل خطوة في معاملة لوحدها بقفل على الصف، والحالة بتتحفظ مع أثر الخطوة نفسها
// (يعني لو السيرفر وقع نص الخطوة، أثرها كله بيتلغي وبتتعاد). الخطوات اللي بتنتظر مهمة بشرية بتفضل waiting.

import { sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  afterCompensation,
  afterStepFailure,
  afterStepSuccess,
  resumeAfterTask,
  type SagaDefinition,
  type SagaPatch,
  type SagaRow,
  type SagaState,
  type SagaStatus,
} from "./sagaCore";
import type { TaskDb } from "./humanTasks";

async function realDb(): Promise<TaskDb> {
  return (await import("../db")).db as unknown as TaskDb;
}

export type SagaRegistry = Record<string, SagaDefinition>;
async function realRegistry(): Promise<SagaRegistry> {
  return (await import("./sagaDefinitions")).SAGA_DEFINITIONS;
}

export async function startSaga(
  input: { type: string; state?: SagaState; subjectType?: string; subjectId?: number; dedupeKey?: string },
  deps: { database?: TaskDb | any; registry?: SagaRegistry } = {},
): Promise<{ id: number; duplicate: boolean }> {
  const registry = deps.registry ?? (await realRegistry());
  if (!registry[input.type]) throw new Error(`نوع عملية غير معروف: ${input.type}`);
  const db = deps.database ?? (await realDb());
  const r = await db.execute(sql`
    INSERT INTO saga_instances (saga_type, state, subject_type, subject_id, dedupe_key)
    VALUES (${input.type}, ${JSON.stringify(input.state ?? {})}::jsonb, ${input.subjectType ?? null}, ${input.subjectId ?? null}, ${input.dedupeKey ?? null})
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`);
  const row = (r.rows as any[])[0];
  if (row) return { id: Number(row.id), duplicate: false };
  const ex = await db.execute(sql`SELECT id FROM saga_instances WHERE dedupe_key = ${input.dedupeKey ?? null}`);
  return { id: Number((ex.rows as any[])[0].id), duplicate: true };
}

type Locked = { id: number; saga_type: string; status: SagaStatus; step_index: number; state: SagaState; attempts: number; waiting_task_id: number | null };

async function applyPatch(tx: any, id: number, p: SagaPatch, state?: SagaState) {
  await tx.execute(sql`
    UPDATE saga_instances SET status = ${p.status}, step_index = ${p.stepIndex}, attempts = ${p.attempts}, waiting_task_id = ${p.waitingTaskId},
      next_run_at = COALESCE(${p.nextRunAt ? p.nextRunAt.toISOString() : null}::timestamptz, next_run_at), last_error = ${p.lastError},
      state = COALESCE(${state ? JSON.stringify(state) : null}::jsonb, state), updated_at = now(),
      finished_at = ${p.finished ? new Date().toISOString() : null}::timestamptz
    WHERE id = ${id}`);
}

/** يشغّل خطوة واحدة من الـsaga. بيرجّع الحالة بعدها. */
export async function advanceSaga(id: number, deps: { database?: TaskDb; registry?: SagaRegistry; now?: Date } = {}): Promise<SagaStatus | "skipped"> {
  const db = deps.database ?? (await realDb());
  const registry = deps.registry ?? (await realRegistry());
  const now = deps.now ?? new Date();
  const ctx: { out: SagaStatus | "skipped"; failed?: { row: Locked; error: unknown } } = { out: "skipped" };
  try {
    await db.transaction(async (tx) => {
      const lk = await tx.execute(sql`
        SELECT id, saga_type, status, step_index, state, attempts, waiting_task_id FROM saga_instances
        WHERE id = ${id} AND status IN ('running','waiting','compensating') AND next_run_at <= ${now.toISOString()}::timestamptz FOR UPDATE SKIP LOCKED`);
      const row = (lk.rows as Locked[])[0];
      if (!row) return;
      const def = registry[row.saga_type];
      if (!def) throw new Error(`تعريف العملية ${row.saga_type} مش موجود`);
      const base: SagaRow = { status: row.status, stepIndex: row.step_index, attempts: row.attempts };
      const total = def.steps.length;

      if (row.status === "waiting") {
        const t = await tx.execute(sql`SELECT status FROM human_tasks WHERE id = ${row.waiting_task_id}`);
        const ts = (t.rows as any[])[0]?.status ?? "cancelled";
        const patch = resumeAfterTask(base, ts, now);
        if (!patch) {
          await tx.execute(sql`UPDATE saga_instances SET next_run_at = ${new Date(now.getTime() + 60_000).toISOString()}::timestamptz WHERE id = ${id}`);
          ctx.out = "waiting";
          return;
        }
        await applyPatch(tx, id, patch);
        ctx.out = patch.status;
        return;
      }

      if (row.status === "compensating") {
        const step = def.steps[row.step_index];
        await step?.compensate?.({ sagaId: id, state: row.state, stepIndex: row.step_index, tx });
        const patch = afterCompensation(base, now);
        await applyPatch(tx, id, patch);
        ctx.out = patch.status;
        return;
      }

      if (row.step_index >= total) {
        await applyPatch(tx, id, afterStepSuccess(base, total, { type: "done" }, now));
        ctx.out = "completed";
        return;
      }
      ctx.failed = { row, error: null };
      const result = await def.steps[row.step_index]!.run({ sagaId: id, state: row.state, stepIndex: row.step_index, tx });
      ctx.failed = undefined;
      const patch = afterStepSuccess(base, total, result, now);
      await applyPatch(tx, id, patch, result.state ? { ...row.state, ...result.state } : undefined);
      ctx.out = patch.status;
    });
    return ctx.out;
  } catch (error) {
    const seen = ctx.failed?.row;
    logger.warn("saga: خطوة فشلت", { id, error: error instanceof Error ? error.message : String(error) });
    if (!seen) return "skipped";
    const patch = afterStepFailure({ status: seen.status, stepIndex: seen.step_index, attempts: seen.attempts }, error, now);
    await db.execute(sql`
      UPDATE saga_instances SET status = ${patch.status}, step_index = ${patch.stepIndex}, attempts = ${patch.attempts}, last_error = ${patch.lastError},
        next_run_at = COALESCE(${patch.nextRunAt ? patch.nextRunAt.toISOString() : null}::timestamptz, next_run_at), updated_at = now(),
        finished_at = ${patch.finished ? now.toISOString() : null}::timestamptz
      WHERE id = ${id}`).catch(() => undefined);
    return patch.status;
  }
}

export async function drainSagas(opts: { limit?: number; deadlineMs?: number; now?: Date; database?: TaskDb; registry?: SagaRegistry } = {}): Promise<{ picked: number; completed: number; failed: number }> {
  const db = opts.database ?? (await realDb());
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.deadlineMs ?? 15_000);
  const out = { picked: 0, completed: 0, failed: 0 };
  const due = await db.execute(sql`
    SELECT id FROM saga_instances WHERE status IN ('running','waiting','compensating') AND next_run_at <= ${now.toISOString()}::timestamptz ORDER BY next_run_at LIMIT ${opts.limit ?? 25}`);
  for (const r of due.rows as Array<{ id: string | number }>) {
    if (Date.now() > deadline) break;
    out.picked += 1;
    const s = await advanceSaga(Number(r.id), { database: db, registry: opts.registry, now });
    if (s === "completed") out.completed += 1;
    if (s === "failed" || s === "compensated") out.failed += 1;
  }
  return out;
}
