/** @format */
/**
 * One way to create an employee account inside a company (used by the owner's
 * team page and by staff). The caller must hold the company row lock.
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { portalMembersTable, portalUsersTable } from "../db/schema";
import { normalizeEmail, normalizePhone } from "./identityNormalization";
import { findAssignableRole } from "./portalRoles";
import { assertSeatAvailable, domainError, generateTempPassword, sanitizeLimits } from "./portalTeam";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type NewMemberInput = {
  fullName: string;
  phone: string;
  email?: string | null;
  roleKey: string;
  title?: string | null;
  limits?: unknown;
  password?: string;
};

export async function createMemberAccount(
  tx: Tx,
  input: {
    companyId: number;
    body: NewMemberInput;
    joinedVia: "owner_created" | "admin_created";
    invitedByMemberId?: number | null;
    /** Return false to refuse a role (anti-escalation for delegated managers). */
    canGrant?: (permissions: readonly string[]) => boolean;
  },
) {
  const { companyId, body } = input;
  const phone = normalizePhone(body.phone);
  if (!phone) throw domainError(400, "INVALID_PHONE", "رقم هاتف غير صحيح");
  const email = body.email ? normalizeEmail(body.email) : "";

  const role = await findAssignableRole(tx, companyId, body.roleKey);
  if (!role) throw domainError(400, "INVALID_ROLE", "الدور ده مش متاح");
  if (input.canGrant && !input.canGrant(role.permissions)) {
    throw domainError(403, "CANNOT_GRANT", "مينفعش تدّي دور فيه صلاحيات مش عندك");
  }
  await assertSeatAvailable(tx, companyId);

  const [phoneTaken] = await tx
    .select({ id: portalUsersTable.id })
    .from(portalUsersTable)
    .where(eq(portalUsersTable.normalizedPhone, phone))
    .limit(1);
  if (phoneTaken) {
    throw domainError(409, "PHONE_ALREADY_REGISTERED", "الرقم ده عنده حساب بالفعل. خليه ينضم بكود الشركة");
  }
  if (email) {
    const [emailTaken] = await tx
      .select({ id: portalUsersTable.id })
      .from(portalUsersTable)
      .where(eq(portalUsersTable.normalizedEmail, email))
      .limit(1);
    if (emailTaken) throw domainError(409, "EMAIL_ALREADY_REGISTERED", "الإيميل ده مستخدم قبل كده");
  }

  const tempPassword = body.password ?? generateTempPassword();
  const [user] = await tx
    .insert(portalUsersTable)
    .values({
      phone: body.phone.trim(),
      normalizedPhone: phone,
      email: body.email ? body.email.trim() : null,
      normalizedEmail: email || null,
      passwordHash: await bcrypt.hash(tempPassword, 12),
      fullName: body.fullName,
      mustChangePassword: true,
      activatedAt: new Date(),
    })
    .returning({ id: portalUsersTable.id });
  const [member] = await tx
    .insert(portalMembersTable)
    .values({
      companyId,
      userId: user!.id,
      roleId: role.id,
      status: "active",
      joinedVia: input.joinedVia,
      invitedByMemberId: input.invitedByMemberId ?? null,
      title: body.title ?? null,
      limits: sanitizeLimits(body.limits),
    })
    .returning({ id: portalMembersTable.id });
  return { memberId: member!.id, userId: user!.id, roleKey: role.key, tempPassword };
}
