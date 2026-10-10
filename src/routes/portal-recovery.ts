/** @format */
/**
 * Plan 03 — password recovery, activation preview, delivery channels.
 *
 * Rules: uniform answers (no account enumeration), one-time credentials,
 * every sensitive step rate limited and audited, no secret ever logged.
 */
import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  portalAuthTokensTable,
  portalChannelsTable,
  portalCustomersTable,
  portalMembersTable,
  portalOutboxTable,
  portalTelegramLinksTable,
  portalUsersTable,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePortalAuth, revokeUserSessions } from "../middleware/portal-auth";
import { PERMISSIONS } from "../lib/permissions";
import { writeAuditEvent } from "../lib/governance";
import { writePortalAudit } from "../lib/portalAudit";
import { normalizeEmail, normalizePortalIdentifier } from "../lib/identityNormalization";
import { provisionLegacyCompaniesForPhone } from "../lib/portalLogin";
import { applyUserPassword, syncOwnerUserFromCompany } from "../lib/portalCredentials";
import { resolveSetting } from "../lib/portalSettings";
import { buildPortalPageUrl } from "../lib/portalConfig";
import { notifyPortalCustomer } from "../lib/portalNotifications";
import {
  consumeAuthToken,
  consumeShortCode,
  hashToken,
  issueAuthToken,
  peekAuthToken,
} from "../lib/authTokens";
import { regenerateRecoveryCodes, countUnusedRecoveryCodes, useRecoveryCode } from "../lib/recoveryCodes";
import { deliver, sendSecurityAlert } from "../lib/channels/deliver";
import { humanDuration } from "../lib/channels/templates";
import { channelStatus, getChannelAdapter } from "../lib/channels/registry";
import { telegramBotUsername, telegramSend } from "../lib/channels/telegram";
import { maskAddress } from "../lib/channels/types";
import { randomBytes } from "node:crypto";
import { buildWhatsAppLink } from "../lib/portalActivation";

const router = Router();

const err = (status: number, code: string, message: string) =>
  Object.assign(new Error(message), { status, code });

const GENERIC_START = "لو الحساب موجود وفيه طريقة استعادة متأكدة، هيوصلك رابط خلال دقايق.";
const BAD_CODE = () => err(400, "INVALID_OR_EXPIRED_CODE", "الكود غلط أو انتهت صلاحيته");

/* ---------- rate limits (per IP + identifier; configurable for tests) ---------- */
const lim = (max: number, windowMs: number, code: string) =>
  rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => {
      const id = typeof req.body?.identifier === "string" ? req.body.identifier.trim().toLowerCase() : "-";
      return `${req.ip || "ip"}:${id}`;
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code, message: "محاولات كتير، جرّب بعد شوية" } },
  });
const RATE = Number(process.env.RECOVERY_RATE_MAX) || 8;
const startLimiter = lim(RATE, 60 * 60_000, "RECOVERY_RATE_LIMIT");
const verifyLimiter = lim(RATE * 2, 15 * 60_000, "RECOVERY_VERIFY_RATE_LIMIT");
const tokenLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: Number(process.env.RECOVERY_TOKEN_RATE_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMIT_EXCEEDED", message: "محاولات كتير، جرّب بعد شوية" } },
});

const identifierSchema = z.string().trim().min(3).max(120);
const passwordSchema = z.string().min(6, "كلمة السر لازم تكون 6 أحرف على الأقل").max(200);

async function findUserByIdentifier(raw: string) {
  const id = normalizePortalIdentifier(raw);
  if (id.channel === "phone") await provisionLegacyCompaniesForPhone(id.value).catch(() => undefined);
  const [user] = await db
    .select()
    .from(portalUsersTable)
    .where(
      id.channel === "email" ? eq(portalUsersTable.normalizedEmail, id.value) : eq(portalUsersTable.normalizedPhone, id.value),
    )
    .limit(1);
  return user && user.status === "active" ? user : null;
}

async function userCompanyIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ companyId: portalMembersTable.companyId })
    .from(portalMembersTable)
    .where(and(eq(portalMembersTable.userId, userId), eq(portalMembersTable.status, "active")));
  return rows.map((r) => r.companyId);
}

async function auditUser(userId: number, action: string, req: Request, after?: unknown, actor = "portal_user") {
  for (const companyId of await userCompanyIds(userId)) {
    await writePortalAudit(db, {
      companyId,
      actorLabel: actor,
      action,
      targetType: "portal_user",
      targetId: userId,
      after,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });
  }
}

function resetUrl(req: Request, raw: string): string {
  const u = new URL(buildPortalPageUrl(req, "/portal-activate.html"));
  u.searchParams.set("mode", "reset");
  u.searchParams.set("token", raw);
  return u.toString();
}

async function methods(): Promise<string[]> {
  return resolveSetting<string[]>("auth.recovery.methods", {});
}

/* ============================================================
   GET /portal/recovery/methods — generic list, same for everyone
============================================================ */
router.get("/portal/recovery/methods", async (_req, res, next) => {
  try {
    const nums = await resolveSetting<Array<{ phone: string; enabled: boolean; isDefault: boolean }>>("contact.whatsapp_numbers", {});
    const n = nums.find((x) => x.enabled && x.isDefault) ?? nums.find((x) => x.enabled);
    res.json({
      methods: await methods(),
      support: n ? { whatsappUrl: buildWhatsAppLink(n.phone, "أهلاً، نسيت كلمة السر في Hyper-Tech وعايز مساعدة.") } : null,
    });
  } catch (e) {
    next(e);
  }
});

/* ============================================================
   POST /portal/activate/preview — what is this link? (does not consume it)
============================================================ */
router.post("/portal/activate/preview", tokenLimiter, async (req, res, next) => {
  try {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
    const check = await peekAuthToken(db, token, ["activation", "password_reset", "invite"]);
    if (!check.ok) {
      const map = {
        invalid: [400, "INVALID_TOKEN", "الرابط غلط أو منتهي"],
        expired: [410, "TOKEN_EXPIRED", "الرابط انتهت صلاحيته، اطلب رابط جديد"],
        used: [409, "TOKEN_USED", "الرابط ده اتستخدم قبل كده"],
      } as const;
      const [s, c, m] = map[check.reason];
      throw err(s, c, m);
    }
    const [user] = await db.select({ fullName: portalUsersTable.fullName }).from(portalUsersTable).where(eq(portalUsersTable.id, check.token.userId)).limit(1);
    res.json({
      purpose: check.token.purpose,
      name: user?.fullName ?? "",
      expiresAt: check.token.expiresAt,
    });
  } catch (e) {
    next(e);
  }
});

/* ============================================================
   POST /portal/recovery/start — link via verified email / telegram
============================================================ */
router.post("/portal/recovery/start", startLimiter, async (req, res, next) => {
  try {
    const { identifier } = z.object({ identifier: identifierSchema }).parse(req.body);
    const user = await findUserByIdentifier(identifier);
    const allowed = await methods();
    if (user && (allowed.includes("email") || allowed.includes("telegram"))) {
      const maxPerHour = await resolveSetting<number>("auth.recovery.max_per_hour", {});
      const [recent] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(portalAuthTokensTable)
        .where(
          and(
            eq(portalAuthTokensTable.userId, user.id),
            eq(portalAuthTokensTable.purpose, "password_reset"),
            gt(portalAuthTokensTable.createdAt, new Date(Date.now() - 3_600_000)),
          ),
        );
      if ((recent?.n ?? 0) < maxPerHour) {
        const ttl = await resolveSetting<number>("auth.reset.ttl_minutes", {});
        const issued = await issueAuthToken(db, { userId: user.id, purpose: "password_reset", ttlMinutes: ttl, meta: { kind: "link" } });
        const only = (["email", "telegram"] as const).filter((c) => allowed.includes(c));
        await deliver({
          purpose: "recovery",
          userId: user.id,
          template: "recovery_link",
          vars: { url: resetUrl(req, issued.raw), duration: humanDuration(ttl) },
          only: [...only],
        });
        await auditUser(user.id, "portal.recovery.started", req, { method: "link" });
      }
    }
    res.json({ ok: true, message: GENERIC_START });
  } catch (e) {
    next(e);
  }
});

/* ============================================================
   POST /portal/recovery/ask-owner — employee asks the company owner for a link
============================================================ */
router.post("/portal/recovery/ask-owner", startLimiter, async (req, res, next) => {
  try {
    const { identifier } = z.object({ identifier: identifierSchema }).parse(req.body);
    const user = await findUserByIdentifier(identifier);
    if ((await methods()).includes("owner") && user) {
      const memberships = await db
        .select({ id: portalMembersTable.id, companyId: portalMembersTable.companyId, isOwner: portalMembersTable.isOwner })
        .from(portalMembersTable)
        .where(and(eq(portalMembersTable.userId, user.id), eq(portalMembersTable.status, "active")));
      for (const m of memberships.filter((x) => !x.isOwner)) {
        await notifyPortalCustomer(m.companyId, {
          type: "portal_member_reset_request",
          title: "موظف طلب استعادة كلمة السر",
          body: `${user.fullName} نسي كلمة السر ومحتاج رابط جديد. ادخل على الفريق واضغط «رابط كلمة سر جديدة».`,
          referenceType: "portal_member",
          referenceId: m.id,
        });
        await writePortalAudit(db, {
          companyId: m.companyId,
          actorLabel: "portal_user",
          action: "portal.recovery.owner_requested",
          targetType: "portal_member",
          targetId: m.id,
          ip: req.ip,
          userAgent: req.get("user-agent"),
        });
      }
    }
    res.json({ ok: true, message: "لو الحساب موجود، رئيس الشركة هيوصله طلبك." });
  } catch (e) {
    next(e);
  }
});

/* ============================================================
   POST /portal/recovery/verify  (+ /use-recovery-code alias)
   admin code (8 digits) or one-time recovery code → short-lived reset ticket
============================================================ */
async function verifyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = z
      .object({
        identifier: identifierSchema,
        code: z.string().trim().min(6).max(20).optional(),
        recoveryCode: z.string().trim().min(6).max(20).optional(),
      })
      .refine((b) => b.code || b.recoveryCode)
      .parse(req.body);
    const user = await findUserByIdentifier(body.identifier);
    if (!user) throw BAD_CODE();
    const allowed = await methods();
    let ok = false;
    let via = "";
    if (body.recoveryCode && allowed.includes("recovery_code")) {
      ok = await useRecoveryCode(db, user.id, body.recoveryCode);
      via = "recovery_code";
    } else if (body.code && allowed.includes("admin")) {
      const r = await consumeShortCode(db, user.id, "password_reset", body.code, new Date(), (t) => t.meta?.kind === "admin_code");
      ok = r.ok;
      via = "admin_code";
    }
    if (!ok) throw BAD_CODE();
    const issued = await issueAuthToken(db, { userId: user.id, purpose: "password_reset", ttlMinutes: 10, meta: { kind: "ticket", via } });
    await auditUser(user.id, "portal.recovery.verified", req, { via });
    if (via === "recovery_code") void sendSecurityAlert(user.id, "recovery_code_used");
    res.json({ ok: true, resetToken: issued.raw, expiresAt: issued.expiresAt });
  } catch (e) {
    next(e);
  }
}
router.post("/portal/recovery/verify", verifyLimiter, verifyHandler);
router.post("/portal/recovery/use-recovery-code", verifyLimiter, verifyHandler);

/* ============================================================
   POST /portal/recovery/complete — new password with a reset token
============================================================ */
router.post("/portal/recovery/complete", tokenLimiter, async (req, res, next) => {
  try {
    const body = z.object({ token: z.string().min(20).max(200), newPassword: passwordSchema }).parse(req.body);
    const hash = await bcrypt.hash(body.newPassword, 12);
    const now = new Date();
    const userId = await db.transaction(async (tx) => {
      const c = await consumeAuthToken(tx, body.token, ["password_reset"], now);
      if (!c.ok) throw err(c.reason === "expired" ? 410 : 400, "INVALID_OR_EXPIRED_TOKEN", "الرابط غلط أو انتهت صلاحيته، اطلب رابط جديد");
      await applyUserPassword(tx, c.token.userId, hash);
      await tx.update(portalUsersTable).set({ activatedAt: sql`coalesce(${portalUsersTable.activatedAt}, ${now.toISOString()}::timestamptz)` }).where(eq(portalUsersTable.id, c.token.userId));
      await revokeUserSessions(c.token.userId, tx, undefined, now);
      return c.token.userId;
    });
    await auditUser(userId, "portal.recovery.completed", req);
    void sendSecurityAlert(userId, "password_changed");
    res.json({ ok: true, message: "اتغيّرت كلمة السر، ادخل بيها دلوقتي" });
  } catch (e) {
    next(e);
  }
});

/* ============================================================
   Staff: admin code, delivery status, outbox, channel health
============================================================ */
const staffWrite = [requireAuth, requireRole(...PERMISSIONS.portalCustomers.write)] as const;

router.post("/portal-customers/:id/admin-code", ...staffWrite, async (req, res, next) => {
  try {
    const companyId = Number(req.params.id);
    if (!Number.isInteger(companyId) || companyId <= 0) throw err(400, "BAD_ID", "رقم غير صحيح");
    const { memberId } = z.object({ memberId: z.number().int().positive().optional() }).parse(req.body ?? {});
    const [company] = await db.select({ id: portalCustomersTable.id, activatedAt: portalCustomersTable.activatedAt }).from(portalCustomersTable).where(eq(portalCustomersTable.id, companyId)).limit(1);
    if (!company) throw err(404, "PORTAL_CUSTOMER_NOT_FOUND", "الحساب غير موجود");
    let userId: number | null;
    if (memberId) {
      const [m] = await db.select({ userId: portalMembersTable.userId }).from(portalMembersTable).where(and(eq(portalMembersTable.id, memberId), eq(portalMembersTable.companyId, companyId))).limit(1);
      userId = m?.userId ?? null;
    } else {
      userId = await syncOwnerUserFromCompany(db, companyId);
    }
    if (!userId) throw err(404, "MEMBER_NOT_FOUND", "العضو غير موجود");
    const ttl = await resolveSetting<number>("auth.admin_code.ttl_minutes", {});
    const issued = await issueAuthToken(db, { userId, purpose: "password_reset", ttlMinutes: ttl, withCode: true, createdByStaffId: req.user!.userId, meta: { kind: "admin_code" } });
    await writeAuditEvent({
      executor: db,
      actorUserId: req.user!.userId,
      actorName: req.user!.username,
      actionKey: "portal.admin_code.issued",
      resourceType: "portal_customer",
      resourceId: companyId,
      afterData: { tokenId: issued.id, expiresAt: issued.expiresAt },
      reason: "كود إدارة لاستعادة كلمة السر",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    await writePortalAudit(db, { companyId, actorStaffUserId: req.user!.userId, actorLabel: req.user!.username, action: "portal.admin_code.issued", targetType: "portal_user", targetId: userId, ip: req.ip, userAgent: req.get("user-agent") });
    res.json({ code: issued.code, expiresAt: issued.expiresAt, minutes: ttl, message: "اديه الكود للعميل — صالح مرة واحدة ومدة قصيرة" });
  } catch (e) {
    next(e);
  }
});

router.get("/portal-admin/channels/status", requireAuth, requireRole(...PERMISSIONS.portalCustomers.view), (_req, res) => {
  res.json({ channels: channelStatus() });
});

router.post("/portal-admin/channels/email/test", ...staffWrite, async (req, res, next) => {
  try {
    const { to } = z.object({ to: z.string().email() }).parse(req.body);
    const adapter = getChannelAdapter("email");
    if (!adapter.isConfigured()) {
      res.json({ ok: false, configured: false, message: "الإيميل مش متظبط لسه (SMTP_HOST / EMAIL_FROM)" });
      return;
    }
    const r = await adapter.send({ to: normalizeEmail(to), subject: "تجربة Hyper-Tech", text: "لو وصلتلك الرسالة دي، إعدادات الإيميل شغالة." });
    res.json({ ok: r.ok, configured: true, errorCode: r.errorCode ?? null, message: r.ok ? "اتبعتت رسالة التجربة" : "الإرسال فشل، راجع إعدادات SMTP" });
  } catch (e) {
    next(e);
  }
});

router.get("/portal-customers/:id/outbox", requireAuth, requireRole(...PERMISSIONS.portalCustomers.view), async (req, res, next) => {
  try {
    const companyId = Number(req.params.id);
    const rows = await db.select().from(portalOutboxTable).where(eq(portalOutboxTable.companyId, companyId)).orderBy(desc(portalOutboxTable.createdAt)).limit(30);
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.post("/portal-outbox/:id/mark-sent", ...staffWrite, async (req, res, next) => {
  try {
    const [row] = await db
      .update(portalOutboxTable)
      .set({ status: "manual_sent", sentAt: new Date() })
      .where(and(eq(portalOutboxTable.id, Number(req.params.id)), eq(portalOutboxTable.status, "manual_pending")))
      .returning({ id: portalOutboxTable.id, status: portalOutboxTable.status });
    if (!row) throw err(404, "OUTBOX_NOT_PENDING", "مفيش رسالة يدوية معلّقة بالرقم ده");
    res.json({ ok: true, item: row });
  } catch (e) {
    next(e);
  }
});

/* ============================================================
   Owner: reset link for an employee
============================================================ */
router.post("/portal/team/members/:memberId/reset-link", requirePortalAuth, async (req, res, next) => {
  try {
    const a = req.portalAuth!;
    if (!a.can("team.manage")) throw err(403, "FORBIDDEN", "مش مسموحلك بالإجراء ده");
    const memberId = Number(req.params.memberId);
    const [m] = await db
      .select({ id: portalMembersTable.id, userId: portalMembersTable.userId, isOwner: portalMembersTable.isOwner, fullName: portalUsersTable.fullName, phone: portalUsersTable.phone })
      .from(portalMembersTable)
      .innerJoin(portalUsersTable, eq(portalUsersTable.id, portalMembersTable.userId))
      .where(and(eq(portalMembersTable.id, memberId), eq(portalMembersTable.companyId, a.companyId)))
      .limit(1);
    if (!m) throw err(404, "MEMBER_NOT_FOUND", "الموظف غير موجود");
    if (m.isOwner || m.userId === a.userId) throw err(409, "CANNOT_RESET_OWNER", "مينفعش تعمل رابط لنفسك أو لرئيس الشركة من هنا");
    const ttl = await resolveSetting<number>("auth.reset.ttl_minutes", {});
    const issued = await issueAuthToken(db, { userId: m.userId, purpose: "password_reset", ttlMinutes: ttl, createdByMemberId: a.memberId, meta: { kind: "owner_link", companyId: a.companyId } });
    const url = resetUrl(req, issued.raw);
    const r = await deliver({ purpose: "recovery", userId: m.userId, companyId: a.companyId, template: "owner_reset_link", vars: { owner: "رئيس الشركة", url, duration: humanDuration(ttl) }, actor: { memberId: a.memberId }, allowUnverified: false, only: ["email", "telegram"], includeManual: true });
    await writePortalAudit(db, { companyId: a.companyId, actorMemberId: a.memberId, actorLabel: "owner", action: "portal.recovery.started", targetType: "portal_member", targetId: m.id, after: { method: "owner_link" }, ip: req.ip, userAgent: req.get("user-agent") });
    res.json({ url, expiresAt: issued.expiresAt, delivered: r.delivered, whatsappUrl: r.whatsappUrl ?? buildWhatsAppLink(m.phone, `رابط كلمة سر جديدة (صالح ${humanDuration(ttl)}): ${url}`) });
  } catch (e) {
    next(e);
  }
});

/* ============================================================
   Self-service channels + recovery codes (signed-in person)
============================================================ */
router.get("/portal/me/channels", requirePortalAuth, async (req, res, next) => {
  try {
    const userId = req.portalAuth!.userId;
    const rows = await db.select().from(portalChannelsTable).where(eq(portalChannelsTable.userId, userId));
    res.json({
      channels: rows.map((c) => ({ id: c.id, type: c.type, masked: maskAddress(c.type as "email", c.address), verified: Boolean(c.verifiedAt), primary: c.isPrimary })),
      recoveryCodesLeft: await countUnusedRecoveryCodes(db, userId),
      telegramBot: process.env.TELEGRAM_BOT_TOKEN ? telegramBotUsername(await resolveSetting<string>("channels.telegram.username", {})) : null,
    });
  } catch (e) {
    next(e);
  }
});

router.post("/portal/me/channels/email", requirePortalAuth, tokenLimiter, async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().trim().email().max(160) }).parse(req.body);
    const address = normalizeEmail(email);
    const userId = req.portalAuth!.userId;
    const issued = await issueAuthToken(db, { userId, purpose: "channel_link", ttlMinutes: 15, withCode: true, meta: { type: "email", address } });
    const r = await deliver({ purpose: "channel_verify", userId, template: "channel_verify", vars: { code: issued.code!, duration: "15 دقيقة" }, only: ["email"], explicitTo: { email: address } });
    res.json({ ok: true, sent: r.delivered, message: r.delivered ? "بعتنالك كود على الإيميل" : "الإيميل مش متظبط على السيرفر لسه، كلّم الدعم" });
  } catch (e) {
    next(e);
  }
});

router.post("/portal/me/channels/email/verify", requirePortalAuth, tokenLimiter, async (req, res, next) => {
  try {
    const { code } = z.object({ code: z.string().trim().min(6).max(12) }).parse(req.body);
    const userId = req.portalAuth!.userId;
    const r = await consumeShortCode(db, userId, "channel_link", code, new Date(), (t) => t.meta?.type === "email");
    if (!r.ok) throw BAD_CODE();
    const address = String(r.token.meta.address);
    const has = await db.select({ id: portalChannelsTable.id }).from(portalChannelsTable).where(and(eq(portalChannelsTable.userId, userId), eq(portalChannelsTable.type, "email"), eq(portalChannelsTable.isPrimary, true)));
    await db
      .insert(portalChannelsTable)
      .values({ userId, type: "email", address, verifiedAt: new Date(), isPrimary: has.length === 0 })
      .onConflictDoUpdate({ target: [portalChannelsTable.userId, portalChannelsTable.type, portalChannelsTable.address], set: { verifiedAt: new Date(), enabled: true } });
    await auditUser(userId, "portal.channel.added", req, { type: "email" });
    res.json({ ok: true, message: "الإيميل اتأكد واتحفظ" });
  } catch (e) {
    next(e);
  }
});

router.post("/portal/me/channels/telegram/link", requirePortalAuth, tokenLimiter, async (req, res, next) => {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) throw err(503, "TELEGRAM_NOT_CONFIGURED", "تيليجرام مش متظبط على السيرفر لسه");
    const userId = req.portalAuth!.userId;
    const raw = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    await db.insert(portalTelegramLinksTable).values({ userId, tokenHash: hashToken(raw), expiresAt });
    const bot = telegramBotUsername(await resolveSetting<string>("channels.telegram.username", {}));
    res.json({ url: `https://t.me/${bot}?start=${raw}`, expiresAt });
  } catch (e) {
    next(e);
  }
});

router.delete("/portal/me/channels/:id", requirePortalAuth, async (req, res, next) => {
  try {
    const userId = req.portalAuth!.userId;
    const [row] = await db.delete(portalChannelsTable).where(and(eq(portalChannelsTable.id, Number(req.params.id)), eq(portalChannelsTable.userId, userId))).returning({ type: portalChannelsTable.type });
    if (!row) throw err(404, "CHANNEL_NOT_FOUND", "القناة غير موجودة");
    await auditUser(userId, "portal.channel.removed", req, { type: row.type });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/portal/me/recovery-codes/regenerate", requirePortalAuth, tokenLimiter, async (req, res, next) => {
  try {
    const { currentPassword } = z.object({ currentPassword: z.string().min(1) }).parse(req.body);
    const userId = req.portalAuth!.userId;
    const [u] = await db.select({ h: portalUsersTable.passwordHash }).from(portalUsersTable).where(eq(portalUsersTable.id, userId)).limit(1);
    if (!u || !(await bcrypt.compare(currentPassword, u.h))) throw err(401, "WRONG_CURRENT_PASSWORD", "كلمة السر الحالية غلط");
    const codes = await regenerateRecoveryCodes(db, userId);
    await auditUser(userId, "portal.recovery_codes.regenerated", req);
    res.json({ codes, message: "احفظ الأكواد دي في مكان آمن — مش هتظهر تاني" });
  } catch (e) {
    next(e);
  }
});

/* ============================================================
   Telegram webhook — links a chat to a person via /start <token>
============================================================ */
router.post("/portal/telegram/webhook", async (req, res) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const given = String(req.get("x-telegram-bot-api-secret-token") ?? "");
  if (!secret) {
    res.status(503).json({ ok: false });
    return;
  }
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ ok: false });
    return;
  }
  try {
    const msg = req.body?.message;
    const chatId = msg?.chat?.id;
    const text: string = typeof msg?.text === "string" ? msg.text : "";
    const m = /^\/start\s+(\S{10,80})$/.exec(text.trim());
    if (chatId && m) {
      const now = new Date();
      const [link] = await db
        .update(portalTelegramLinksTable)
        .set({ consumedAt: now })
        .where(and(eq(portalTelegramLinksTable.tokenHash, hashToken(m[1]!)), sql`${portalTelegramLinksTable.consumedAt} IS NULL`, gt(portalTelegramLinksTable.expiresAt, now)))
        .returning();
      if (link) {
        const has = await db.select({ id: portalChannelsTable.id }).from(portalChannelsTable).where(and(eq(portalChannelsTable.userId, link.userId), eq(portalChannelsTable.type, "telegram")));
        await db
          .insert(portalChannelsTable)
          .values({ userId: link.userId, type: "telegram", address: String(chatId), verifiedAt: now, isPrimary: has.length === 0 })
          .onConflictDoUpdate({ target: [portalChannelsTable.userId, portalChannelsTable.type, portalChannelsTable.address], set: { verifiedAt: now, enabled: true } });
        await auditUser(link.userId, "portal.channel.added", req, { type: "telegram" }, "telegram_bot");
        await telegramSend(String(chatId), "اتربط حسابك في Hyper-Tech بتيليجرام ✅");
      } else {
        await telegramSend(String(chatId), "الرابط ده انتهى أو اتستخدم. اطلب رابط جديد من إعدادات حسابك.");
      }
    }
  } catch {
    /* always 200 so Telegram does not retry forever; nothing sensitive is logged */
  }
  res.json({ ok: true });
});

export default router;
