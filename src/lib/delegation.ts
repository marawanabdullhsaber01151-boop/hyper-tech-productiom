import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db, delegationsTable, systemUsersTable } from "../db";

/**
 * Returns the user's original role plus currently active delegated roles.
 * Delegation lookup is deliberately fail-safe: callers can retain the
 * original role if the database is temporarily unavailable.
 */
export async function getEffectiveRoles(userId: number): Promise<string[]> {
  const [user, rows] = await Promise.all([
    db.select({ role: systemUsersTable.role }).from(systemUsersTable)
      .where(eq(systemUsersTable.id, userId)).limit(1),
    db.select({ actionKey: delegationsTable.actionKey }).from(delegationsTable)
      .where(and(
        eq(delegationsTable.delegateUserId, userId),
        eq(delegationsTable.status, "active"),
        isNull(delegationsTable.revokedAt),
        lte(delegationsTable.startsAt, new Date()),
        gte(delegationsTable.endsAt, new Date()),
      )),
  ]);
  return [...new Set([user[0]?.role, ...rows.map((row) => row.actionKey)])]
    .filter((role): role is string => Boolean(role));
}