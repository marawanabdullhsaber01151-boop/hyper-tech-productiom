/** @format */
/**
 * Keeps the person's password (portal_users) and the legacy company row
 * (portal_customers, used by old code and rollbacks) in step. Hashes are never
 * logged or returned.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  portalCustomersTable,
  portalMembersTable,
  portalUsersTable,
} from "../db/schema";
import { provisionCompanyIdentity } from "./portalIdentityProvisioning";

type Tx = Pick<typeof db, "select" | "insert" | "update" | "execute">;

/**
 * Company row is the source (admin reset, activation, OTP): copy its password
 * state to the owner's user. Provisions the identity first when missing.
 * Returns the owner user id.
 */
export async function syncOwnerUserFromCompany(
  tx: Tx,
  companyId: number,
): Promise<number | null> {
  const provisioned = await provisionCompanyIdentity(tx, companyId);
  if (provisioned.status === "conflict" || provisioned.status === "missing") return null;
  const [company] = await tx
    .select({
      passwordHash: portalCustomersTable.passwordHash,
      mustChangePassword: portalCustomersTable.mustChangePassword,
      activatedAt: portalCustomersTable.activatedAt,
    })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, companyId))
    .limit(1);
  if (!company) return null;
  await tx
    .update(portalUsersTable)
    .set({
      passwordHash: company.passwordHash,
      mustChangePassword: company.mustChangePassword,
      activatedAt: company.activatedAt,
      failedLoginAttempts: 0,
      lockedUntil: null,
    })
    .where(eq(portalUsersTable.id, provisioned.userId));
  return provisioned.userId;
}

/**
 * User is the source (change-password): update the person, then mirror to the
 * legacy rows of every company this person owns.
 */
export async function applyUserPassword(
  tx: Tx,
  userId: number,
  passwordHash: string,
  opts: { mustChangePassword?: boolean } = {},
): Promise<void> {
  const mustChange = opts.mustChangePassword ?? false;
  await tx
    .update(portalUsersTable)
    .set({
      passwordHash,
      mustChangePassword: mustChange,
      failedLoginAttempts: 0,
      lockedUntil: null,
    })
    .where(eq(portalUsersTable.id, userId));
  const owned = await tx
    .select({ companyId: portalMembersTable.companyId })
    .from(portalMembersTable)
    .where(
      and(eq(portalMembersTable.userId, userId), eq(portalMembersTable.isOwner, true)),
    );
  for (const { companyId } of owned) {
    await tx
      .update(portalCustomersTable)
      .set({ passwordHash, mustChangePassword: mustChange })
      .where(eq(portalCustomersTable.id, companyId));
  }
}
