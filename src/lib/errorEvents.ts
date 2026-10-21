/** @format */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { normalizePath } from "./errorPath";
import { logger } from "./logger";

export const ERROR_RETENTION_DAYS = 30;


export interface ErrorEventInput {
  reference: string;
  method: string;
  path: string;
  message: string;
  userId?: number | null;
  correlationId?: string | null;
}

/** بيسجّل الخطأ في الخلفية. عمره ما بيرمي: فشل التسجيل ما يصحّش يبوّظ الرد الأصلي. */
export function recordErrorEvent(input: ErrorEventInput): void {
  void db
    .execute(
      sql`INSERT INTO app_error_events (reference, method, path, message, user_id, correlation_id)
          VALUES (${input.reference}, ${input.method.slice(0, 10)}, ${normalizePath(input.path)}, ${input.message.slice(0, 300)},
                  ${input.userId ?? null}, ${input.correlationId ?? null})`,
    )
    .catch((err: unknown) => {
      logger.warn("تعذّر تسجيل الخطأ في app_error_events", { error: err instanceof Error ? err.message : String(err) });
    });
}

export async function purgeOldErrorEvents(days: number = ERROR_RETENTION_DAYS): Promise<number> {
  if (!Number.isInteger(days) || days < 1) throw new Error("days must be a positive integer");
  const r = await db.execute(sql`DELETE FROM app_error_events WHERE created_at < now() - make_interval(days => ${days})`);
  return r.rowCount ?? 0;
}
