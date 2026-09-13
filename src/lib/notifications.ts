/** @format */

import { db } from "../db";
import { notificationsTable, systemUsersTable } from "../db/schema";
import { eq } from "drizzle-orm";

interface NotificationPayload {
  type: string;
  title: string;
  body: string;
  referenceType?: string;
  referenceId?: number;
}

export async function notifyUser(userId: number, payload: NotificationPayload) {
  await db.insert(notificationsTable).values({ userId, ...payload });
}

export async function notifyRole(role: string, payload: NotificationPayload) {
  const users = await db
    .select({ id: systemUsersTable.id })
    .from(systemUsersTable)
    .where(eq(systemUsersTable.role, role));

  if (users.length === 0) return;

  await db
    .insert(notificationsTable)
    .values(users.map((u) => ({ userId: u.id, ...payload })));
}

export async function notifyRoles(
  roles: string[],
  payload: NotificationPayload,
) {
  await Promise.all(roles.map((role) => notifyRole(role, payload)));
}
