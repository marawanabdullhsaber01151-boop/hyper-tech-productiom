/** @format */
/**
 * Pieces of the portal login that are about the PERSON (portal_users) and the
 * list of companies they can enter. Kept out of the route so it can be tested.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  portalCustomersTable,
  portalMembersTable,
  portalRolesTable,
  portalUsersTable,
} from "../db/schema";
import { loadMemberAccess } from "./portalAccess";
import { provisionCompanyIdentity } from "./portalIdentityProvisioning";
import { resolveSetting } from "./portalSettings";

export type LoginMembership = {
  memberId: number;
  companyId: number;
  companyName: string;
  isOwner: boolean;
  roleKey: string;
  roleName: string;
};

export async function listLoginMemberships(userId: number): Promise<{
  active: LoginMembership[];
  pending: number;
}> {
  const rows = await db
    .select({
      memberId: portalMembersTable.id,
      companyId: portalMembersTable.companyId,
      companyName: portalCustomersTable.companyName,
      companyActive: portalCustomersTable.isActive,
      status: portalMembersTable.status,
      isOwner: portalMembersTable.isOwner,
      roleKey: portalRolesTable.key,
      roleName: portalRolesTable.name,
    })
    .from(portalMembersTable)
    .innerJoin(portalCustomersTable, eq(portalCustomersTable.id, portalMembersTable.companyId))
    .innerJoin(portalRolesTable, eq(portalRolesTable.id, portalMembersTable.roleId))
    .where(eq(portalMembersTable.userId, userId))
    .orderBy(asc(portalMembersTable.id));
  return {
    active: rows
      .filter((r) => r.status === "active" && r.companyActive)
      .map(({ companyActive: _a, status: _s, ...rest }) => rest),
    pending: rows.filter((r) => r.status === "pending_approval").length,
  };
}

/** Same phone, company exists but has no identity yet → create it (old data). */
export async function provisionLegacyCompaniesForPhone(normalizedPhone: string): Promise<void> {
  const legacy = await db
    .select({ id: portalCustomersTable.id })
    .from(portalCustomersTable)
    .where(
      and(
        eq(portalCustomersTable.normalizedPhone, normalizedPhone),
        sql`NOT EXISTS (SELECT 1 FROM portal_members m WHERE m.company_id = ${portalCustomersTable.id} AND m.is_owner)`,
      ),
    );
  for (const c of legacy) await provisionCompanyIdentity(db, c.id);
}

export async function lockoutPolicy(): Promise<{ attempts: number; minutes: number }> {
  const [attempts, minutes] = await Promise.all([
    resolveSetting<number>("security.lockout.attempts", {}),
    resolveSetting<number>("security.lockout.minutes", {}),
  ]);
  return { attempts, minutes };
}

/** Records a wrong password; locks the person after the configured attempts. */
export async function registerFailedLogin(
  userId: number,
  now = new Date(),
): Promise<{ locked: boolean; lockedUntil: Date | null }> {
  const policy = await lockoutPolicy();
  const [row] = await db
    .update(portalUsersTable)
    .set({ failedLoginAttempts: sql`${portalUsersTable.failedLoginAttempts} + 1` })
    .where(eq(portalUsersTable.id, userId))
    .returning({ attempts: portalUsersTable.failedLoginAttempts });
  if (row && row.attempts >= policy.attempts) {
    const lockedUntil = new Date(now.getTime() + policy.minutes * 60_000);
    await db
      .update(portalUsersTable)
      .set({ lockedUntil, failedLoginAttempts: 0 })
      .where(eq(portalUsersTable.id, userId));
    return { locked: true, lockedUntil };
  }
  return { locked: false, lockedUntil: null };
}

export async function registerSuccessfulLogin(userId: number, now = new Date()): Promise<void> {
  await db
    .update(portalUsersTable)
    .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now })
    .where(eq(portalUsersTable.id, userId));
}

/** Shape sent to the browser after a session is created. */
export async function buildSessionPayload(input: {
  token: string;
  rememberMe: boolean;
  user: { id: number; fullName: string; phone: string; email: string | null; mustChangePassword: boolean };
  membership: LoginMembership;
}) {
  const access = await loadMemberAccess(input.membership.memberId);
  return {
    token: input.token,
    rememberMe: input.rememberMe,
    customer: {
      id: input.membership.companyId,
      fullName: input.user.fullName,
      phone: input.user.phone,
      email: input.user.email,
      companyName: input.membership.companyName,
    },
    member: {
      id: input.membership.memberId,
      isOwner: input.membership.isOwner,
      roleKey: input.membership.roleKey,
      roleName: input.membership.roleName,
      permissions: access ? [...access.permissions] : [],
      limits: access?.limits ?? {},
    },
    mustChangePassword: input.user.mustChangePassword,
  };
}
