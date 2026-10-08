/** @format */
/**
 * Loads what a member is allowed to do (role + overrides + limits) with a short
 * in-process cache. Permission changes call `invalidateMemberAccess` so they
 * apply immediately on this instance; other instances see them within TTL.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  portalMemberOverridesTable,
  portalMembersTable,
  portalRolesTable,
  type PortalMemberLimits,
} from "../db/schema";
import { resolveEffectivePermissions } from "./portalPermissions";

export type MemberAccess = {
  memberId: number;
  isOwner: boolean;
  roleKey: string;
  permissions: Set<string>;
  limits: PortalMemberLimits;
};

const TTL_MS = 30_000;
const cache = new Map<number, { at: number; value: MemberAccess }>();

export function invalidateMemberAccess(memberId?: number): void {
  if (memberId === undefined) cache.clear();
  else cache.delete(memberId);
}

export async function loadMemberAccess(
  memberId: number,
  now = Date.now(),
): Promise<MemberAccess | null> {
  const hit = cache.get(memberId);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  const [row] = await db
    .select({
      isOwner: portalMembersTable.isOwner,
      limits: portalMembersTable.limits,
      roleKey: portalRolesTable.key,
      rolePermissions: portalRolesTable.permissions,
    })
    .from(portalMembersTable)
    .innerJoin(portalRolesTable, eq(portalRolesTable.id, portalMembersTable.roleId))
    .where(eq(portalMembersTable.id, memberId))
    .limit(1);
  if (!row) return null;

  const overrides = await db
    .select({
      permissionKey: portalMemberOverridesTable.permissionKey,
      effect: portalMemberOverridesTable.effect,
    })
    .from(portalMemberOverridesTable)
    .where(inArray(portalMemberOverridesTable.memberId, [memberId]));

  const value: MemberAccess = {
    memberId,
    isOwner: row.isOwner,
    roleKey: row.roleKey,
    permissions: resolveEffectivePermissions({
      isOwner: row.isOwner,
      rolePermissions: row.rolePermissions,
      overrides: overrides.map((o) => ({
        permissionKey: o.permissionKey,
        effect: o.effect as "allow" | "deny",
      })),
    }),
    limits: row.limits ?? {},
  };
  cache.set(memberId, { at: now, value });
  return value;
}
