/** @format */
import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * تنظيف سجل command_idempotency: كل عملية (POST مع Idempotency-Key) بتسيب صف فيه الرد المخزَّن،
 * ومفيش حاجة كانت بتمسحه، فالجدول بيكبر للأبد. 48 ساعة أكتر من كفاية لأي إعادة محاولة شرعية.
 * بيتنفّذ من الـcron اليومي الموجود (/api/v1/chat/cron/maintenance).
 */
export const COMMAND_RETENTION_HOURS = 48;

export async function purgeExpiredCommands(
  retentionHours: number = COMMAND_RETENTION_HOURS,
): Promise<number> {
  if (!Number.isInteger(retentionHours) || retentionHours < 1) {
    throw new Error("retentionHours must be a positive integer");
  }
  const result = await db.execute(
    sql`DELETE FROM command_idempotency WHERE created_at < now() - make_interval(hours => ${retentionHours})`,
  );
  return result.rowCount ?? 0;
}
