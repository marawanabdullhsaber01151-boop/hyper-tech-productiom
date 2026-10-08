/** @format */
/**
 * Decides whether a stored session still maps to an active person in an active
 * membership of the session's company. Legacy sessions (created before the
 * identity tables existed) are linked on first use.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  portalMembersTable,
  portalSessionsTable,
  portalUsersTable,
} from "../db/schema";
import { provisionCompanyIdentity } from "./portalIdentityProvisioning";

export async function resolveSessionIdentity(
  session: { id: number; userId: number | null; memberId: number | null },
  companyId: number,
): Promise<{ userId: number; memberId: number } | null> {
  let { userId, memberId } = session;
  if (!memberId || !userId) {
    const provisioned = await provisionCompanyIdentity(db, companyId);
    if (provisioned.status === "conflict" || provisioned.status === "missing") return null;
    userId = provisioned.userId;
    memberId = provisioned.memberId;
    await db
      .update(portalSessionsTable)
      .set({ userId, memberId, companyId })
      .where(eq(portalSessionsTable.id, session.id));
  }
  const [row] = await db
    .select({
      memberStatus: portalMembersTable.status,
      memberCompanyId: portalMembersTable.companyId,
      userStatus: portalUsersTable.status,
    })
    .from(portalMembersTable)
    .innerJoin(portalUsersTable, eq(portalUsersTable.id, portalMembersTable.userId))
    .where(eq(portalMembersTable.id, memberId))
    .limit(1);
  if (
    !row ||
    row.memberStatus !== "active" ||
    row.userStatus !== "active" ||
    row.memberCompanyId !== companyId
  ) {
    return null;
  }
  return { userId, memberId };
}
