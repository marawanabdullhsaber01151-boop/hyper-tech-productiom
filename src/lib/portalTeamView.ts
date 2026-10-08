/** @format */
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import {
  portalMemberOverridesTable,
  portalMembersTable,
  portalRolesTable,
  portalUsersTable,
} from "../db/schema";

/** Members of one company (without removed ones) with person, role and overrides. */
export async function loadTeamForStaff(companyId: number) {
  const rows = await db
    .select({
      memberId: portalMembersTable.id,
      userId: portalMembersTable.userId,
      status: portalMembersTable.status,
      isOwner: portalMembersTable.isOwner,
      joinedVia: portalMembersTable.joinedVia,
      title: portalMembersTable.title,
      limits: portalMembersTable.limits,
      lastActiveAt: portalMembersTable.lastActiveAt,
      createdAt: portalMembersTable.createdAt,
      roleKey: portalRolesTable.key,
      roleName: portalRolesTable.name,
      fullName: portalUsersTable.fullName,
      phone: portalUsersTable.phone,
      email: portalUsersTable.email,
      mustChangePassword: portalUsersTable.mustChangePassword,
    })
    .from(portalMembersTable)
    .innerJoin(portalUsersTable, eq(portalUsersTable.id, portalMembersTable.userId))
    .innerJoin(portalRolesTable, eq(portalRolesTable.id, portalMembersTable.roleId))
    .where(
      and(
        eq(portalMembersTable.companyId, companyId),
        ne(portalMembersTable.status, "removed"),
      ),
    )
    .orderBy(desc(portalMembersTable.isOwner), portalMembersTable.id);
  const ids = rows.map((r) => r.memberId);
  const overrides = ids.length
    ? await db
        .select()
        .from(portalMemberOverridesTable)
        .where(inArray(portalMemberOverridesTable.memberId, ids))
    : [];
  return rows.map((r) => ({
    ...r,
    overrides: overrides
      .filter((o) => o.memberId === r.memberId)
      .map((o) => ({ permissionKey: o.permissionKey, effect: o.effect })),
  }));
}

