/** @format */

import { db } from "../db";
import { notificationsTable, systemUsersTable } from "../db/schema";
import { eq } from "drizzle-orm";
import type { Executor } from "./db-executor";
import { logger } from "./logger";
import { enqueueOutbox } from "./outbox";

interface NotificationPayload {
  type: string;
  title: string;
  body: string;
  referenceType?: string;
  referenceId?: number;
}

/** executor اختياري: لو اتبعت معاملة (tx) الإشعار بيتكتب فيها ويتلغي لو العملية اتلغت (ومعاه أي فشل بيترمي للمستدعي). */
interface NotifyOptions {
  executor?: Executor;
}

async function insertForUser(executor: Executor, userId: number, payload: NotificationPayload) {
  await executor.insert(notificationsTable).values({ userId, ...payload });
}

async function insertForRole(executor: Executor, role: string, payload: NotificationPayload) {
  const users: Array<{ id: number }> = await executor.select({ id: systemUsersTable.id }).from(systemUsersTable).where(eq(systemUsersTable.role, role));
  if (users.length === 0) return;
  await executor.insert(notificationsTable).values(users.map((u) => ({ userId: u.id, ...payload })));
}

/**
 * الإشعار بعد نجاح العملية الأساسية ما يكسرهاش: لو الكتابة فشلت (انقطاع قصير في القاعدة مثلًا)
 * بنسجّل الخطأ ونحط الإشعار في صندوق الصادر (outbox_events) عشان يتعاد، بدل ما الطلب يرجّع 500
 * والمستخدم يعيد عملية اتسجّلت فعلًا. لو حتى الصندوق فشل بنسجّل الخطأ بس ونكمّل.
 */
async function durable(label: string, run: () => Promise<void>, fallback: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    logger.error("notification failed — queued for retry", { label, error: error instanceof Error ? error.message : String(error) });
    try {
      await fallback();
    } catch (queueError) {
      logger.error("notification could not be queued", { label, error: queueError instanceof Error ? queueError.message : String(queueError) });
    }
  }
}

export async function notifyUser(userId: number, payload: NotificationPayload, opts: NotifyOptions = {}) {
  if (opts.executor) return insertForUser(opts.executor, userId, payload);
  await durable(
    `user:${userId}:${payload.type}`,
    () => insertForUser(db as unknown as Executor, userId, payload),
    () => enqueueOutbox(db as unknown as Executor, { type: "notify.user", payload: { userId, ...payload } }),
  );
}

export async function notifyRole(role: string, payload: NotificationPayload, opts: NotifyOptions = {}) {
  if (opts.executor) return insertForRole(opts.executor, role, payload);
  await durable(
    `role:${role}:${payload.type}`,
    () => insertForRole(db as unknown as Executor, role, payload),
    () => enqueueOutbox(db as unknown as Executor, { type: "notify.role", payload: { role, ...payload } }),
  );
}

export async function notifyRoles(
  roles: string[],
  payload: NotificationPayload,
  opts: NotifyOptions = {},
) {
  await Promise.all(roles.map((role) => notifyRole(role, payload, opts)));
}
