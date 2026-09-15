import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Request } from "express";
import { z } from "zod";
import { db, commandIdempotencyTable } from "../db";
import type {
  CommandContext,
  CommandResult,
  IdempotencyKey,
  CorrelationId,
} from "../contracts/command";

const idempotencyKeySchema = z.string().trim().min(8).max(150);

type CommandInput<T> = {
  req: Request;
  commandName: string;
  payload: T;
  execute: (tx: any, context: CommandContext) => Promise<CommandResult<unknown>>;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function requestHash(commandName: string, payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify({ commandName, payload: stableValue(payload) }))
    .digest("hex");
}

export function getCommandContext(
  req: Request,
  commandName: string,
  payload: unknown,
): CommandContext {
  const headerKey = req.get("idempotency-key");
  const bodyKey =
    payload && typeof payload === "object" && "idempotencyKey" in payload ?
      String((payload as Record<string, unknown>).idempotencyKey)
    : undefined;
  const idempotencyKey = idempotencyKeySchema.parse(headerKey ?? bodyKey);
  const expectedVersionHeader = req.get("if-match-version");
  const expectedVersion =
    expectedVersionHeader && /^\d+$/.test(expectedVersionHeader) ?
      Number(expectedVersionHeader)
    : undefined;

  return {
    commandName,
    idempotencyKey: idempotencyKey as IdempotencyKey,
    correlationId: (req.correlationId ??
      "missing-correlation-id") as CorrelationId,
    expectedVersion,
    actor: {
      userId: req.user?.userId ?? null,
      username: req.user?.username ?? null,
      role: req.user?.role ?? null,
    },
  };
}

export function assertExpectedVersion(
  context: CommandContext,
  currentVersion: number,
): void {
  if (
    context.expectedVersion !== undefined &&
    context.expectedVersion !== currentVersion
  ) {
    throw Object.assign(new Error("السجل تغيّر؛ أعد تحميله ثم حاول مرة أخرى"), {
      status: 409,
      code: "STALE_VERSION",
      details: {
        expectedVersion: context.expectedVersion,
        currentVersion,
      },
    });
  }
}

/**
 * Standard mutation executor.
 *
 * The unique command key is claimed inside the same transaction as the
 * business mutation. A retry with the same payload replays the stored result;
 * reusing the key with a different payload is a conflict.
 */
export async function executeIdempotentCommand<T>({
  req,
  commandName,
  payload,
  execute,
}: CommandInput<T>): Promise<CommandResult<unknown>> {
  const context = getCommandContext(req, commandName, payload);
  const hash = requestHash(commandName, payload);

  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .insert(commandIdempotencyTable)
      .values({
        idempotencyKey: context.idempotencyKey,
        commandName,
        requestHash: hash,
        correlationId: context.correlationId,
        actorUserId: context.actor.userId,
      })
      .onConflictDoNothing({
        target: [
          commandIdempotencyTable.commandName,
          commandIdempotencyTable.idempotencyKey,
        ],
      })
      .returning();

    if (!claimed) {
      const [existing] = await tx
        .select()
        .from(commandIdempotencyTable)
        .where(
          and(
            eq(commandIdempotencyTable.commandName, commandName),
            eq(
              commandIdempotencyTable.idempotencyKey,
              context.idempotencyKey,
            ),
          ),
        )
        .limit(1);

      if (!existing) {
        throw Object.assign(new Error("تعذر حجز مفتاح العملية"), {
          status: 409,
          code: "COMMAND_RETRY_REQUIRED",
        });
      }
      if (existing.requestHash !== hash) {
        throw Object.assign(
          new Error("مفتاح العملية مستخدم مع بيانات مختلفة"),
          { status: 409, code: "IDEMPOTENCY_KEY_REUSED" },
        );
      }
      if (existing.status !== "completed" || !existing.responseBody) {
        throw Object.assign(new Error("العملية الأصلية ما زالت قيد التنفيذ"), {
          status: 409,
          code: "COMMAND_IN_PROGRESS",
        });
      }
      return {
        status: existing.responseStatus ?? 200,
        body: existing.responseBody,
      };
    }

    const result = await execute(tx, context);
    await tx
      .update(commandIdempotencyTable)
      .set({
        status: "completed",
        responseStatus: result.status,
        responseBody: result.body,
        completedAt: new Date(),
      })
      .where(eq(commandIdempotencyTable.id, claimed.id));

    return result;
  });
}