/** @format */
/**
 * Creates the identity rows (user + owner member + company code) for a company
 * that only exists as a legacy `portal_customers` row. Idempotent: running it
 * again on a provisioned company changes nothing.
 *
 * Used by (1) scripts/migrate-portal-identity.ts, (2) lazy provisioning at
 * login, (3) approve/confirm of brand-new companies.
 * Never logs or returns password hashes.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  portalCustomersTable,
  portalMembersTable,
  portalRolesTable,
  portalUsersTable,
} from "../db/schema";
import { generateCompanyCode, getActiveCompanyCode } from "./companyCode";
import { normalizeEmail, normalizePhone } from "./identityNormalization";

type Tx = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export type ProvisionResult =
  | {
      status: "created" | "exists";
      companyId: number;
      userId: number;
      memberId: number;
      codeCreated: boolean;
      emailSkipped?: boolean;
    }
  | { status: "conflict"; companyId: number; reason: string }
  | { status: "missing"; companyId: number };

export async function provisionCompanyIdentity(
  tx: Tx,
  companyId: number,
  opts: { joinedVia?: "migration" | "owner_created" | "admin_created" } = {},
): Promise<ProvisionResult> {
  const [company] = await tx
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, companyId))
    .limit(1);
  if (!company) return { status: "missing", companyId };

  const phone = normalizePhone(company.phone);
  if (!phone) return { status: "conflict", companyId, reason: "رقم الهاتف غير صالح" };

  // Existing owner member → already provisioned.
  const [ownerRow] = await tx
    .select({ id: portalMembersTable.id, userId: portalMembersTable.userId })
    .from(portalMembersTable)
    .where(
      and(
        eq(portalMembersTable.companyId, companyId),
        eq(portalMembersTable.isOwner, true),
      ),
    )
    .limit(1);
  if (ownerRow) {
    const code = await getActiveCompanyCode(tx, companyId);
    let codeCreated = false;
    if (!code) {
      await generateCompanyCode(tx, companyId, {}, "provision");
      codeCreated = true;
    }
    return {
      status: "exists",
      companyId,
      userId: ownerRow.userId,
      memberId: ownerRow.id,
      codeCreated,
    };
  }

  // Find or create the person by normalized phone.
  let [user] = await tx
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.normalizedPhone, phone))
    .limit(1);

  let emailSkipped = false;
  if (!user) {
    const email = normalizeEmail(company.email);
    let emailToUse: string | null = company.email ?? null;
    if (email) {
      const [clash] = await tx
        .select({ id: portalUsersTable.id })
        .from(portalUsersTable)
        .where(eq(portalUsersTable.normalizedEmail, email))
        .limit(1);
      if (clash) {
        emailToUse = null;
        emailSkipped = true;
      }
    } else {
      emailToUse = null;
    }
    [user] = await tx
      .insert(portalUsersTable)
      .values({
        phone: company.phone,
        normalizedPhone: phone,
        email: emailToUse,
        normalizedEmail: emailToUse ? email : null,
        passwordHash: company.passwordHash,
        fullName: company.fullName,
        status: company.isActive ? "active" : "disabled",
        mustChangePassword: company.mustChangePassword,
        activatedAt: company.activatedAt,
      })
      .returning();
  }
  if (!user) return { status: "conflict", companyId, reason: "تعذر إنشاء المستخدم" };

  const [ownerRole] = await tx
    .select({ id: portalRolesTable.id })
    .from(portalRolesTable)
    .where(and(sql`${portalRolesTable.companyId} IS NULL`, eq(portalRolesTable.key, "owner")))
    .limit(1);
  if (!ownerRole) {
    return { status: "conflict", companyId, reason: "دور owner غير موجود (شغّل migration 0070)" };
  }

  const [member] = await tx
    .insert(portalMembersTable)
    .values({
      companyId,
      userId: user.id,
      roleId: ownerRole.id,
      isOwner: true,
      status: "active",
      joinedVia: opts.joinedVia ?? "migration",
    })
    .onConflictDoNothing()
    .returning({ id: portalMembersTable.id });

  let memberId = member?.id;
  if (!memberId) {
    const [m] = await tx
      .select({ id: portalMembersTable.id })
      .from(portalMembersTable)
      .where(
        and(
          eq(portalMembersTable.companyId, companyId),
          eq(portalMembersTable.userId, user.id),
        ),
      )
      .limit(1);
    if (!m) return { status: "conflict", companyId, reason: "المستخدم عضو بالفعل بشكل غير متوقع" };
    memberId = m.id;
    return {
      status: "conflict",
      companyId,
      reason: "رقم الهاتف مرتبط بعضوية موجودة في نفس الشركة بدون owner",
    };
  }

  await generateCompanyCode(tx, companyId, { memberId }, "provision");

  // Link existing history so nothing is orphaned.
  await tx.execute(sql`
    UPDATE portal_sessions SET user_id = ${user.id}, member_id = ${memberId}, company_id = ${companyId}
    WHERE portal_customer_id = ${companyId} AND user_id IS NULL`);
  await tx.execute(sql`
    UPDATE production_workflow_orders
       SET submitted_by_member_id = ${memberId}, created_by_kind = COALESCE(created_by_kind, 'portal_member')
     WHERE portal_customer_id = ${companyId} AND submitted_by_member_id IS NULL`);
  await tx.execute(sql`
    UPDATE portal_order_batches SET submitted_by_member_id = ${memberId}
    WHERE portal_customer_id = ${companyId} AND submitted_by_member_id IS NULL`);
  await tx.execute(sql`
    UPDATE portal_cart_items SET member_id = ${memberId}
    WHERE portal_customer_id = ${companyId} AND member_id IS NULL`);
  await tx.execute(sql`
    UPDATE portal_wishlist_items SET member_id = ${memberId}
    WHERE portal_customer_id = ${companyId} AND member_id IS NULL`);

  return {
    status: "created",
    companyId,
    userId: user.id,
    memberId,
    codeCreated: true,
    emailSkipped,
  };
}
