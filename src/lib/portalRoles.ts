/** @format */
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { portalRolesTable } from "../db/schema";
import { sanitizePermissionList } from "./portalPermissions";

type Reader = Pick<typeof db, "select">;

/** Roles a company can assign: the system templates + its own custom roles. */
export async function listCompanyRoles(tx: Reader, companyId: number) {
  return tx
    .select()
    .from(portalRolesTable)
    .where(or(isNull(portalRolesTable.companyId), eq(portalRolesTable.companyId, companyId)))
    .orderBy(asc(portalRolesTable.sortOrder), asc(portalRolesTable.id));
}

/** A company's own role wins over a system role with the same key. */
export async function findAssignableRole(tx: Reader, companyId: number, roleKey: string) {
  const roles = await listCompanyRoles(tx, companyId);
  const matches = roles.filter((r) => r.key === roleKey);
  const role = matches.find((r) => r.companyId === companyId) ?? matches[0];
  if (!role || role.key === "owner") return null; // owner is never assignable
  return role;
}

/**
 * Anti-escalation: someone may only hand out permissions they hold themselves.
 * The owner holds everything, so this only constrains delegated managers.
 */
export function canGrantAll(
  grantor: { isOwner: boolean; can(key: string): boolean },
  permissions: readonly string[],
): boolean {
  if (grantor.isOwner) return true;
  return sanitizePermissionList(permissions).every((k) => grantor.can(k));
}
