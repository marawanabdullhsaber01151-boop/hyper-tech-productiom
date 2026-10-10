/** @format */
import bcrypt from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Request } from "express";
import { db } from "../db";
import { portalChannelsTable, portalCustomersTable, portalMembersTable, portalUsersTable } from "../db/schema";
import { consumeAuthToken, peekAuthToken } from "./authTokens";
import { applyUserPassword } from "./portalCredentials";
import { regenerateRecoveryCodes } from "./recoveryCodes";
import { writePortalAudit } from "./portalAudit";
import { normalizeEmail } from "./identityNormalization";

const fail = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });

/**
 * Activation through the new token table. Returns null when the token is not
 * one of ours (caller then tries the legacy table). On success the person gets
 * a password, a verified email channel (only if the link really went to that
 * email) and 8 one-time recovery codes — shown ONCE in this response.
 */
export async function activateWithAuthToken(req: Request, rawToken: string, password: string) {
  const peek = await peekAuthToken(db, rawToken, ["activation", "invite"]);
  if (!peek.ok && peek.reason === "invalid") return null;
  if (!peek.ok) {
    throw peek.reason === "expired" ?
        fail(410, "ACTIVATION_TOKEN_EXPIRED", "انتهت صلاحية رابط التفعيل")
      : fail(409, "ACTIVATION_TOKEN_ALREADY_USED", "تم استخدام رابط التفعيل من قبل");
  }
  const hash = await bcrypt.hash(password, 12);
  const now = new Date();
  return db.transaction(async (tx) => {
    const c = await consumeAuthToken(tx, rawToken, ["activation", "invite"], now);
    if (!c.ok) throw fail(409, "ACTIVATION_TOKEN_ALREADY_USED", "تم استخدام رابط التفعيل من قبل");
    const userId = c.token.userId;
    await applyUserPassword(tx, userId, hash);
    await tx
      .update(portalUsersTable)
      .set({ activatedAt: sql`coalesce(${portalUsersTable.activatedAt}, ${now.toISOString()}::timestamptz)` })
      .where(eq(portalUsersTable.id, userId));
    const owned = await tx
      .select({ companyId: portalMembersTable.companyId })
      .from(portalMembersTable)
      .where(and(eq(portalMembersTable.userId, userId), eq(portalMembersTable.isOwner, true)));
    for (const { companyId } of owned) {
      await tx
        .update(portalCustomersTable)
        .set({ activatedAt: now })
        .where(and(eq(portalCustomersTable.id, companyId), isNull(portalCustomersTable.activatedAt)));
    }
    const [user] = await tx
      .select({ id: portalUsersTable.id, fullName: portalUsersTable.fullName, phone: portalUsersTable.phone, email: portalUsersTable.email })
      .from(portalUsersTable)
      .where(eq(portalUsersTable.id, userId))
      .limit(1);
    if (c.token.meta?.viaEmail && user?.email) {
      await tx
        .insert(portalChannelsTable)
        .values({ userId, type: "email", address: normalizeEmail(user.email), verifiedAt: now, isPrimary: true })
        .onConflictDoUpdate({
          target: [portalChannelsTable.userId, portalChannelsTable.type, portalChannelsTable.address],
          set: { verifiedAt: now },
        });
    }
    const recoveryCodes = await regenerateRecoveryCodes(tx, userId);
    const memberships = await tx.select({ companyId: portalMembersTable.companyId }).from(portalMembersTable).where(eq(portalMembersTable.userId, userId));
    for (const m of memberships) {
      await writePortalAudit(tx, {
        companyId: m.companyId,
        actorLabel: "portal_user",
        action: "portal.activation.completed",
        targetType: "portal_user",
        targetId: userId,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
    }
    return {
      message: "تم تفعيل حسابك بنجاح",
      customer: { id: owned[0]?.companyId ?? memberships[0]?.companyId ?? 0, fullName: user?.fullName, phone: user?.phone, email: user?.email },
      recoveryCodes,
    };
  });
}
