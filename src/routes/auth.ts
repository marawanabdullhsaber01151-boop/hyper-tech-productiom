/** @format */

// تثبيت: npm install express-rate-limit  (مُضاف في package.json المصلوح)
import { Router } from "express";
import bcrypt from "bcryptjs";
import { eq, and, isNull, ne, desc, count } from "drizzle-orm";
import { db, systemUsersTable } from "../db";
import { loginSessionsTable } from "../db/schema";
import { generateToken, requireAuth } from "../middleware/auth";
import { loginRateLimiter } from "../middleware/rateLimiter";
import { z } from "zod";
import { writeAuditEvent } from "../lib/governance";
import { failure, success } from "../contracts/api-response";

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

// POST /api/v1/auth/login — ✅ محمي بـ loginRateLimiter
router.post("/auth/login", loginRateLimiter, async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const [user] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.username, username))
      .limit(1);

    // ✅ رسالة موحّدة — لا تكشف إن كان اسم المستخدم موجوداً أم لا
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json(failure("UNAUTHORIZED", "اسم المستخدم أو كلمة المرور غير صحيحة"));
      return;
    }

    if (user.status === "inactive") {
      res.status(403).json(failure("FORBIDDEN", "هذا الحساب موقوف — يرجى التواصل مع المدير"));
      return;
    }

    const deviceInfo = req.headers["user-agent"] || null;
    const ipAddress = req.ip || null;

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

    // ✨ مفاجأة: هل الجهاز/الـ IP ده أول مرة يدخل بيه المستخدم ده؟
    let isNewDevice = false;
    if (deviceInfo || ipAddress) {
      const priorSessions = await db
        .select({
          deviceInfo: loginSessionsTable.deviceInfo,
          ipAddress: loginSessionsTable.ipAddress,
        })
        .from(loginSessionsTable)
        .where(eq(loginSessionsTable.userId, user.id))
        .limit(20);
      const seenBefore = priorSessions.some(
        (s) =>
          (deviceInfo && s.deviceInfo === deviceInfo) ||
          (ipAddress && s.ipAddress === ipAddress),
      );
      isNewDevice = priorSessions.length > 0 && !seenBefore;
    }

    const [session] = await db
      .insert(loginSessionsTable)
      .values({ userId: user.id, deviceInfo, ipAddress, isNewDevice })
      .returning();

    const token = generateToken({ sessionId: session.id });

    res.json(success({
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      },
      // ✨ تنبيه للمستخدم نفسه لو الدخول ده من جهاز/مكان جديد عليه
      isNewDevice,
    }));
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

export default router;
