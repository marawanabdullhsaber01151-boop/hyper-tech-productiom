/** @format */

// تثبيت: npm install express-rate-limit  (مُضاف في package.json المصلوح)
import { Router } from "express";
import bcrypt from "bcryptjs";
import { eq, and, isNull, ne, desc, count } from "drizzle-orm";
import { db, systemUsersTable } from "../db";
import { loginSessionsTable } from "../db/schema";
import {
  generateToken,
  generateMfaPreAuthToken,
  verifyMfaPreAuthToken,
  requireAuth,
} from "../middleware/auth";
import { loginRateLimiter } from "../middleware/rateLimiter";
import { z } from "zod";
import { writeAuditEvent } from "../lib/governance";
import { failure, success } from "../contracts/api-response";
import {
  isAccountLocked,
  recordFailedLogin,
  clearLockoutState,
  lockoutRemainingSeconds,
  LOCKOUT_MINUTES,
  generateTotpSecret,
  verifyTotpCode,
  generateBackupCodes,
} from "../domain/auth-security";

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1, "اسم المستخدم مطلوب"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});

// ✅ كلمة مرور قوية — 8 أحرف + حرف كبير + حرف صغير + رقم
export const strongPasswordSchema = z
  .string()
  .min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل")
  .regex(/[A-Z]/, "يجب أن تحتوي على حرف كبير واحد على الأقل")
  .regex(/[a-z]/, "يجب أن تحتوي على حرف صغير واحد على الأقل")
  .regex(/[0-9]/, "يجب أن تحتوي على رقم واحد على الأقل");

// Security hardening: account-level brute-force lockout + optional TOTP
// 2FA — see src/domain/auth-security.ts for the (RFC 6238-verified)
// algorithm this route wires up, and docs/reports for the full delivery
// note on what this does and does not cover.

type SessionUser = typeof systemUsersTable.$inferSelect;

/**
 * The part of "finish logging this person in" that is identical whether
 * they only needed a password (no 2FA) or a password + a verified TOTP/
 * backup code: concurrent-session eviction, new-device detection, the
 * login_sessions row, and the real session token. Factored out so the two
 * call sites (plain login, and the post-2FA completion endpoint) cannot
 * drift apart on what "a session" actually is.
 */
async function completeLogin(
  user: SessionUser,
  deviceInfo: string | null,
  ipAddress: string | null,
) {
  if (user.maxConcurrentSessions !== null && user.maxConcurrentSessions !== undefined) {
    const [{ active }] = await db.select({ active: count() }).from(loginSessionsTable)
      .where(and(eq(loginSessionsTable.userId, user.id), isNull(loginSessionsTable.revokedAt)));
    if (Number(active) >= user.maxConcurrentSessions) {
      const [oldest] = await db.select({ id: loginSessionsTable.id }).from(loginSessionsTable)
        .where(and(eq(loginSessionsTable.userId, user.id), isNull(loginSessionsTable.revokedAt)))
        .orderBy(loginSessionsTable.createdAt).limit(1);
      if (oldest) {
        await db.update(loginSessionsTable).set({
          revokedAt: new Date(), revokedReason: "تم إبطال الجلسة تلقائيًا لتجاوز الحد الأقصى",
        }).where(eq(loginSessionsTable.id, oldest.id));
        await writeAuditEvent({
          actorUserId: user.id, actorName: user.username,
          actionKey: "auth.session.auto_revoke", resourceType: "login_session",
          resourceId: oldest.id, decision: "executed",
          reason: "تجاوز الحد الأقصى للجلسات المتزامنة",
        });
      }
    }
  }

  let isNewDevice = false;
  if (deviceInfo || ipAddress) {
    const priorSessions = await db
      .select({ deviceInfo: loginSessionsTable.deviceInfo, ipAddress: loginSessionsTable.ipAddress })
      .from(loginSessionsTable)
      .where(eq(loginSessionsTable.userId, user.id))
      .limit(20);
    const seenBefore = priorSessions.some(
      (s) => (deviceInfo && s.deviceInfo === deviceInfo) || (ipAddress && s.ipAddress === ipAddress),
    );
    isNewDevice = priorSessions.length > 0 && !seenBefore;
  }

  const [session] = await db
    .insert(loginSessionsTable)
    .values({ userId: user.id, deviceInfo, ipAddress, isNewDevice })
    .returning();

  const token = generateToken({ sessionId: session.id });
  return {
    token,
    user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role },
    isNewDevice,
  };
}

// POST /api/v1/auth/login — ✅ محمي بـ loginRateLimiter (IP) + قفل الحساب
// (independent, per-account — انظر src/domain/auth-security.ts)
router.post("/auth/login", loginRateLimiter, async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const deviceInfo = req.headers["user-agent"] || null;
    const ipAddress = req.ip || null;

    const [user] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.username, username))
      .limit(1);

    // ✅ رسالة موحّدة — لا تكشف إن كان اسم المستخدم موجوداً أم لا
    if (!user) {
      res.status(401).json(failure("UNAUTHORIZED", "اسم المستخدم أو كلمة المرور غير صحيحة"));
      return;
    }

    if (isAccountLocked(user.lockedUntil)) {
      const remaining = lockoutRemainingSeconds(user.lockedUntil);
      await writeAuditEvent({
        actorUserId: user.id, actorName: user.username, actionKey: "auth.login.blocked_locked",
        resourceType: "system_user", resourceId: user.id, decision: "blocked",
        reason: `الحساب مقفول (${remaining} ثانية متبقية)`, ipAddress, userAgent: deviceInfo,
      });
      res.status(423).json(failure(
        "ACCOUNT_LOCKED",
        `الحساب مقفول مؤقتًا بسبب محاولات دخول فاشلة متكررة — حاول تاني بعد ${Math.ceil(remaining / 60)} دقيقة`,
      ));
      return;
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      const lockoutState = recordFailedLogin(user.failedLoginAttempts);
      await db.update(systemUsersTable).set({
        failedLoginAttempts: lockoutState.failedLoginAttempts,
        lockedUntil: lockoutState.lockedUntil,
      }).where(eq(systemUsersTable.id, user.id));
      const justLocked = lockoutState.lockedUntil !== null;
      await writeAuditEvent({
        actorUserId: user.id, actorName: user.username,
        actionKey: justLocked ? "auth.login.locked" : "auth.login.failed",
        resourceType: "system_user", resourceId: user.id,
        decision: justLocked ? "locked" : "rejected",
        reason: `محاولة دخول فاشلة رقم ${lockoutState.failedLoginAttempts}`,
        ipAddress, userAgent: deviceInfo,
      });
      if (justLocked) {
        res.status(423).json(failure(
          "ACCOUNT_LOCKED",
          `تم قفل الحساب مؤقتًا بعد ${lockoutState.failedLoginAttempts} محاولات فاشلة — حاول تاني بعد ${LOCKOUT_MINUTES} دقيقة`,
        ));
        return;
      }
      res.status(401).json(failure("UNAUTHORIZED", "اسم المستخدم أو كلمة المرور غير صحيحة"));
      return;
    }

    if (user.status === "inactive") {
      res.status(403).json(failure("FORBIDDEN", "هذا الحساب موقوف — يرجى التواصل مع المدير"));
      return;
    }

    // كلمة المرور صحيحة — أي عداد محاولات فاشلة سابق بقى بلا معنى
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      const cleared = clearLockoutState();
      await db.update(systemUsersTable).set(cleared).where(eq(systemUsersTable.id, user.id));
    }

    if (user.totpEnabled) {
      // لسه محتاجين خطوة ثانية — مفيش جلسة حقيقية اتعملت لسه، وده مقصود.
      await writeAuditEvent({
        actorUserId: user.id, actorName: user.username, actionKey: "auth.login.password_ok_awaiting_totp",
        resourceType: "system_user", resourceId: user.id, decision: "pending", ipAddress, userAgent: deviceInfo,
      });
      res.json(success({
        requiresTotp: true,
        preAuthToken: generateMfaPreAuthToken(user.id),
      }));
      return;
    }

    const result = await completeLogin(user, deviceInfo, ipAddress);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

const totpLoginSchema = z.object({
  preAuthToken: z.string().min(1),
  code: z.string().min(1, "أدخل رمز التحقق"),
});

// POST /api/v1/auth/login/verify-totp — الخطوة الثانية لحساب مفعّل عليه 2FA.
// محمي بنفس loginRateLimiter (على مستوى الـIP) عشان محدش يجرب يخمّن رمز
// الـTOTP بمحاولات لا نهائية حتى لو معاه كلمة المرور الصحيحة.
router.post("/auth/login/verify-totp", loginRateLimiter, async (req, res, next) => {
  try {
    const { preAuthToken, code } = totpLoginSchema.parse(req.body);
    const deviceInfo = req.headers["user-agent"] || null;
    const ipAddress = req.ip || null;

    const userId = verifyMfaPreAuthToken(preAuthToken);
    if (!userId) {
      res.status(401).json(failure("UNAUTHORIZED", "انتهت صلاحية جلسة التحقق — سجّل الدخول من جديد"));
      return;
    }

    const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, userId)).limit(1);
    if (!user || !user.totpEnabled || !user.totpSecret) {
      res.status(401).json(failure("UNAUTHORIZED", "انتهت صلاحية جلسة التحقق — سجّل الدخول من جديد"));
      return;
    }

    let matchedBackupCode: string | null = null;
    const codeIsValid = verifyTotpCode(user.totpSecret, code);
    if (!codeIsValid) {
      // جرّب كأنه backup code بدل رمز TOTP — كل كود منهم يُستخدم مرة واحدة بس.
      const backupCodes = (user.totpBackupCodes as string[] | null) ?? [];
      for (const hashed of backupCodes) {
        if (await bcrypt.compare(code.trim().toUpperCase(), hashed)) {
          matchedBackupCode = hashed;
          break;
        }
      }
    }

    if (!codeIsValid && !matchedBackupCode) {
      await writeAuditEvent({
        actorUserId: user.id, actorName: user.username, actionKey: "auth.login.totp_failed",
        resourceType: "system_user", resourceId: user.id, decision: "rejected", ipAddress, userAgent: deviceInfo,
      });
      res.status(401).json(failure("UNAUTHORIZED", "رمز التحقق غير صحيح"));
      return;
    }

    if (matchedBackupCode) {
      const remaining = ((user.totpBackupCodes as string[] | null) ?? []).filter((c) => c !== matchedBackupCode);
      await db.update(systemUsersTable).set({ totpBackupCodes: remaining }).where(eq(systemUsersTable.id, user.id));
      await writeAuditEvent({
        actorUserId: user.id, actorName: user.username, actionKey: "auth.login.totp_backup_code_used",
        resourceType: "system_user", resourceId: user.id, decision: "executed",
        reason: `تبقّى ${remaining.length} كود احتياطي`, ipAddress, userAgent: deviceInfo,
      });
    }

    const result = await completeLogin(user, deviceInfo, ipAddress);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/me
router.get("/auth/me", requireAuth, async (req, res, next) => {
  try {
    const [user] = await db
      .select({
        id: systemUsersTable.id,
        username: systemUsersTable.username,
        fullName: systemUsersTable.fullName,
        role: systemUsersTable.role,
        status: systemUsersTable.status,
        createdAt: systemUsersTable.createdAt,
      })
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, req.user!.userId))
      .limit(1);

    if (!user) {
      res.status(404).json(failure("NOT_FOUND", "المستخدم غير موجود"));
      return;
    }
    res.json(success(user));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/logout — ✅ جديد: يقفل الجلسة الحالية فعليًا (مش بس مسح التوكن من المتصفح)
router.post("/auth/logout", requireAuth, async (req, res, next) => {
  try {
    await db
      .update(loginSessionsTable)
      .set({ revokedAt: new Date(), revokedReason: "تسجيل خروج طبيعي" })
      .where(eq(loginSessionsTable.id, req.user!.sessionId));
    res.json(success(null, { message: "تم تسجيل الخروج" }));
  } catch (err) {
    next(err);
  }
});

// ✨ GET /api/v1/auth/sessions — الجلسات الحالية للمستخدم نفسه (كل الأجهزة الداخل منها)
router.get("/auth/sessions", requireAuth, async (req, res, next) => {
  try {
    const sessions = await db
      .select()
      .from(loginSessionsTable)
      .where(
        and(
          eq(loginSessionsTable.userId, req.user!.userId),
          isNull(loginSessionsTable.revokedAt),
        ),
      )
      .orderBy(desc(loginSessionsTable.lastActiveAt));

    res.json(success(
      sessions.map((s) => ({
        ...s,
        isCurrent: s.id === req.user!.sessionId,
      })),
    ));
  } catch (err) {
    next(err);
  }
});

// ✨ DELETE /api/v1/auth/sessions/:id — المستخدم يقفل جلسة تانية بتاعته (زي جهاز ضاع)
router.delete("/auth/sessions/:id", requireAuth, async (req, res, next) => {
  try {
    const sessionId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(sessionId)) {
      res.status(400).json(failure("VALIDATION_ERROR", "معرّف الجلسة غير صحيح"));
      return;
    }

    const [updated] = await db
      .update(loginSessionsTable)
      .set({
        revokedAt: new Date(),
        revokedReason: "أُقفلت يدويًا من المستخدم",
      })
      .where(
        and(
          eq(loginSessionsTable.id, sessionId),
          eq(loginSessionsTable.userId, req.user!.userId),
          ne(loginSessionsTable.id, req.user!.sessionId), // مايقدرش يقفل نفس الجلسة اللي شغال بيها دلوقتي
        ),
      )
      .returning();

    if (!updated) {
      res
        .status(404)
        .json(failure("NOT_FOUND", "الجلسة غير موجودة أو لا يمكن إقفالها"));
      return;
    }
    res.json(success(null, { message: "تم إقفال الجلسة" }));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/change-password
router.post("/auth/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: strongPasswordSchema,
      })
      .parse(req.body);

    const [user] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, req.user!.userId))
      .limit(1);

    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      res
        .status(400)
        .json(failure("VALIDATION_ERROR", "كلمة المرور الحالية غير صحيحة"));
      return;
    }

    await db
      .update(systemUsersTable)
      .set({
        passwordHash: await bcrypt.hash(newPassword, 12),
        updatedAt: new Date(),
      })
      .where(eq(systemUsersTable.id, req.user!.userId));

    res.json(success(null, { message: "تم تغيير كلمة المرور بنجاح" }));
  } catch (err) {
    next(err);
  }
});

// ── إدارة المصادقة الثنائية (2FA) — كل المسارات دي محتاجة تسجيل دخول عادي
// أول (requireAuth)، مش جزء من تدفق تسجيل الدخول نفسه. ──

router.get("/auth/2fa/status", requireAuth, async (req, res, next) => {
  try {
    const [user] = await db
      .select({ totpEnabled: systemUsersTable.totpEnabled, totpEnabledAt: systemUsersTable.totpEnabledAt })
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, req.user!.userId))
      .limit(1);
    if (!user) { res.status(404).json(failure("NOT_FOUND", "المستخدم غير موجود")); return; }
    res.json(success(user));
  } catch (err) { next(err); }
});

// POST /api/v1/auth/2fa/setup — يولّد سر جديد (لسه مش مفعّل) ويرجّع رابط
// otpauth:// عشان يتضاف يدويًا أو عن طريق QR في تطبيق مصادقة (Google
// Authenticator / Authy / Microsoft Authenticator). السر ده لوحده مبيفعّلش
// حاجة لحد ما يتأكد بكود صحيح عن طريق /auth/2fa/confirm — فمحاولة setup
// فاشلة أو متروكة منتصفها متأثرش على حساب المستخدم خالص.
router.post("/auth/2fa/setup", requireAuth, async (req, res, next) => {
  try {
    const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, req.user!.userId)).limit(1);
    if (!user) { res.status(404).json(failure("NOT_FOUND", "المستخدم غير موجود")); return; }
    if (user.totpEnabled) {
      res.status(409).json(failure("ALREADY_ENABLED", "المصادقة الثنائية مفعّلة بالفعل — عطّلها الأول لو عايز تولّد سر جديد"));
      return;
    }
    const secret = generateTotpSecret();
    await db.update(systemUsersTable).set({ totpPendingSecret: secret }).where(eq(systemUsersTable.id, user.id));
    const issuer = "HyperTech";
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    res.json(success({ secret, otpauthUrl }));
  } catch (err) { next(err); }
});

// أداء: bcrypt cost أقل هنا عمدًا (8 بدل 12 المستخدمة لكلمات المرور) —
// أكواد الاحتياط دي عشوائية عالية الإنتروبيا أصلًا (8 محارف من أبجدية 33
// حرف ≈ 40 بت)، مش كلمة مرور بشرية الاختيار سهلة التخمين، فمش محتاجة نفس
// تكلفة bcrypt. المهم عمليًا: تسجيل الدخول بكود احتياطي غلط بيتحقق من لغاية
// 10 هاشات بالتتابع (كل الأكواد المتبقية) قبل ما يرفض — بتكلفة 12 كان ده
// هيضيف أكتر من ثانية زيادة على استجابة تسجيل الدخول في أسوأ حالة؛ بتكلفة 8
// الزمن ده ينزل لأجزاء من الثانية، من غير ما يضعّف الحماية الفعلية للكود.
const BACKUP_CODE_BCRYPT_COST = 8;

const totpConfirmSchema = z.object({ code: z.string().min(1) });

// POST /api/v1/auth/2fa/confirm — يتأكد إن المستخدم فعلًا ضاف السر صح
// لتطبيق المصادقة (بطلب كود حالي منه)، وبعدين وبعدين بس يفعّل 2FA
// فعليًا ويولّد أكواد احتياطية بتتعرض نص واحد مرة واحدة بس.
router.post("/auth/2fa/confirm", requireAuth, async (req, res, next) => {
  try {
    const { code } = totpConfirmSchema.parse(req.body);
    const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, req.user!.userId)).limit(1);
    if (!user || !user.totpPendingSecret) {
      res.status(400).json(failure("VALIDATION_ERROR", "ابدأ إعداد المصادقة الثنائية الأول عن طريق /auth/2fa/setup"));
      return;
    }
    if (!verifyTotpCode(user.totpPendingSecret, code)) {
      res.status(400).json(failure("VALIDATION_ERROR", "رمز التحقق غير صحيح — تأكد إن ساعة جهازك مظبوطة وجرّب تاني"));
      return;
    }
    const backupCodes = generateBackupCodes(10);
    const hashedBackupCodes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, BACKUP_CODE_BCRYPT_COST)));
    await db.update(systemUsersTable).set({
      totpSecret: user.totpPendingSecret,
      totpPendingSecret: null,
      totpEnabled: true,
      totpEnabledAt: new Date(),
      totpBackupCodes: hashedBackupCodes,
    }).where(eq(systemUsersTable.id, user.id));
    await writeAuditEvent({
      actorUserId: user.id, actorName: user.username, actionKey: "auth.2fa.enabled",
      resourceType: "system_user", resourceId: user.id, decision: "executed",
    });
    // الأكواد الاحتياطية بترجع نص صريح هنا مرة واحدة بس في حياتها —
    // بعد كده بس النسخة المُشفّرة (bcrypt) هي اللي متخزّنة، زي الباسورد
    // بالظبط، ومفيش أي مسار تاني يرجّعها تاني.
    res.json(success({ enabled: true, backupCodes }));
  } catch (err) { next(err); }
});

const totpDisableSchema = z.object({ password: z.string().min(1, "كلمة المرور مطلوبة لتعطيل المصادقة الثنائية") });

// POST /api/v1/auth/2fa/disable — بيطلب كلمة المرور الحالية تاني عمدًا
// (مش بس requireAuth) — عشان لو حد سرق جلسة مفتوحة (توكن) لمستخدم، ميقدرش
// يعطّل الحماية الإضافية دي من غير ما يعرف الباسورد الحقيقي كمان.
router.post("/auth/2fa/disable", requireAuth, async (req, res, next) => {
  try {
    const { password } = totpDisableSchema.parse(req.body);
    const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, req.user!.userId)).limit(1);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(400).json(failure("VALIDATION_ERROR", "كلمة المرور غير صحيحة"));
      return;
    }
    await db.update(systemUsersTable).set({
      totpEnabled: false, totpSecret: null, totpPendingSecret: null,
      totpEnabledAt: null, totpBackupCodes: null,
    }).where(eq(systemUsersTable.id, user.id));
    await writeAuditEvent({
      actorUserId: user.id, actorName: user.username, actionKey: "auth.2fa.disabled",
      resourceType: "system_user", resourceId: user.id, decision: "executed",
    });
    res.json(success(null, { message: "تم تعطيل المصادقة الثنائية" }));
  } catch (err) { next(err); }
});

// POST /api/v1/auth/2fa/regenerate-backup-codes — لو المستخدم استهلك
// أكواده الاحتياطية أو ضيّعهم. برضو بيطلب كلمة المرور لنفس سبب /disable.
router.post("/auth/2fa/regenerate-backup-codes", requireAuth, async (req, res, next) => {
  try {
    const { password } = totpDisableSchema.parse(req.body);
    const [user] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, req.user!.userId)).limit(1);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(400).json(failure("VALIDATION_ERROR", "كلمة المرور غير صحيحة"));
      return;
    }
    if (!user.totpEnabled) {
      res.status(409).json(failure("NOT_ENABLED", "المصادقة الثنائية مش مفعّلة أصلًا"));
      return;
    }
    const backupCodes = generateBackupCodes(10);
    const hashedBackupCodes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, BACKUP_CODE_BCRYPT_COST)));
    await db.update(systemUsersTable).set({ totpBackupCodes: hashedBackupCodes }).where(eq(systemUsersTable.id, user.id));
    await writeAuditEvent({
      actorUserId: user.id, actorName: user.username, actionKey: "auth.2fa.backup_codes_regenerated",
      resourceType: "system_user", resourceId: user.id, decision: "executed",
    });
    res.json(success({ backupCodes }));
  } catch (err) { next(err); }
});

export default router;
