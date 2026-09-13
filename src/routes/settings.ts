/** @format */

import { Router } from "express";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, systemSettingsTable, systemUsersTable } from "../db";
import {
  loginSessionsTable,
  permissionOverridesTable,
  grantPermissionOverrideSchema,
  contactsTable,
  salesOrdersTable,
  inventoryItemsTable,
  stockMovementsTable,
  productionWorkflowOrdersTable,
} from "../db/schema";
import { requireAuth, requirePermission } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { moveToTrash } from "../lib/trash";
import { strongPasswordSchema } from "./auth";
import { USER_ROLES } from "../lib/roles";
import { ACTION_REGISTRY } from "../lib/actionRegistry";
import { notifyUser } from "../lib/notifications";
import { z } from "zod";

const router = Router();
const requireSettings = requirePermission("settings.manageUsers");
const requirePermissions = requirePermission("settings.managePermissions");

// ✅ القائمة البيضاء للمفاتيح المسموح بها — أي مفتاح خارجها يُرفض
const ALLOWED_SETTING_KEYS = new Set([
  "company_name",
  "company_logo",
  "company_address",
  "company_phone",
  "company_email",
  "currency",
  "currency_symbol",
  "fiscal_year_start",
  "language",
  "timezone",
  "low_stock_alert_enabled",
  "default_payment_terms",
  "invoice_footer_note",
  "vat_rate",
  "vat_enabled",
]);

// GET /api/v1/settings
// الإعدادات بيانات إدارية حساسة وليست جزءًا من التشغيل اليومي؛
// لذلك لا يكفي تسجيل الدخول لقراءتها، ولا يملكها المدير التنفيذي.
router.get("/settings", requireAuth, requireSettings, async (_req, res, next) => {
  try {
    const settings = await db
      .select()
      .from(systemSettingsTable)
      .orderBy(systemSettingsTable.key);
    res.json(Object.fromEntries(settings.map((s) => [s.key, s.value])));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/settings
router.put(
  "/settings",
  requireAuth,
  requireSettings,
  async (req, res, next) => {
    try {
      const data = z.record(z.string()).parse(req.body);

      const unknownKeys = Object.keys(data).filter(
        (k) => !ALLOWED_SETTING_KEYS.has(k),
      );
      if (unknownKeys.length > 0) {
        res.status(400).json({
          error: {
            code: "UNKNOWN_SETTING_KEYS",
            message: `المفاتيح التالية غير مسموح بها: ${unknownKeys.join(", ")}`,
          },
        });
        return;
      }

      for (const [key, value] of Object.entries(data)) {
        await db
          .insert(systemSettingsTable)
          .values({ key, value })
          .onConflictDoUpdate({
            target: systemSettingsTable.key,
            set: { value, updatedAt: new Date() },
          });
      }

      const settings = await db.select().from(systemSettingsTable);
      res.json(Object.fromEntries(settings.map((s) => [s.key, s.value])));
    } catch (err) {
      next(err);
    }
  },
);

// ─── System Users ─────────────────────────────────────────────────────────────

// GET /api/v1/users
router.get(
  "/users",
  requireAuth,
  requireSettings,
  async (_req, res, next) => {
    try {
      const users = await db
        .select({
          id: systemUsersTable.id,
          username: systemUsersTable.username,
          fullName: systemUsersTable.fullName,
          role: systemUsersTable.role,
          status: systemUsersTable.status,
          createdAt: systemUsersTable.createdAt,
        })
        .from(systemUsersTable)
        .orderBy(systemUsersTable.fullName);
      res.json(users);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/users
router.post(
  "/users",
  requireAuth,
  requireSettings,
  async (req, res, next) => {
    try {
      const schema = z.object({
        username: z
          .string()
          .min(3, "اسم المستخدم يجب أن يكون 3 أحرف على الأقل"),
        fullName: z.string().min(1, "الاسم الكامل مطلوب"),
        role: z.enum(USER_ROLES).default("sales_manager"),
        status: z.enum(["active", "inactive"]).default("active"),
        password: strongPasswordSchema, // ✅ كلمة مرور قوية
      });
      const { password, ...userData } = schema.parse(req.body);
      const [created] = await db
        .insert(systemUsersTable)
        .values({ ...userData, passwordHash: await bcrypt.hash(password, 12) })
        .returning({
          id: systemUsersTable.id,
          username: systemUsersTable.username,
          fullName: systemUsersTable.fullName,
          role: systemUsersTable.role,
          status: systemUsersTable.status,
          createdAt: systemUsersTable.createdAt,
        });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/users/:id
router.patch(
  "/users/:id",
  requireAuth,
  requireSettings,
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      // ✅ إصلاح حرج: username كانت مفقودة من مصفوفة التحقق (zod) بالكامل —
      // zod.parse() بيتجاهل أي حقل مش معرّف هنا بصمت من غير أي error، يعني
      // اسم الدخول الجديد كان بيتبعت من الواجهة ويوصل هنا ويتشال قبل ما يوصل
      // لقاعدة البيانات، والرد بيرجع نجاح وكأن التعديل حصل فعلاً.
      const schema = z.object({
        username: z.string().min(3).optional(),
        fullName: z.string().optional(),
        role: z.enum(USER_ROLES).optional(),
        status: z.enum(["active", "inactive"]).optional(),
        password: strongPasswordSchema.optional(), // ✅ كلمة مرور قوية
      });
      const { password, ...data } = schema.parse(req.body);
      const updateData: Record<string, unknown> = {
        ...data,
        updatedAt: new Date(),
      };
      if (password) updateData.passwordHash = await bcrypt.hash(password, 12);

      const [updated] = await db
        .update(systemUsersTable)
        .set(updateData)
        .where(eq(systemUsersTable.id, id))
        .returning({
          id: systemUsersTable.id,
          username: systemUsersTable.username,
          fullName: systemUsersTable.fullName,
          role: systemUsersTable.role,
          status: systemUsersTable.status,
        });
      if (!updated) {
        res.status(404).json({ error: { message: "المستخدم غير موجود" } });
        return;
      }

      // ✅ الإصلاح الجوهري: لو الحساب اتوقف أو الدور اتغيّر أو الباسورد اتغيّر،
      // اقفل كل جلساته النشطة فورًا — كانت الجلسة القديمة بتفضل شغالة لحد 7
      // أيام حتى بعد تغيير الباسورد، يعني لو حد سرّب باسورد موظف والأدمن غيّره،
      // أي جلسة مسروقة من قبل كانت بتفضل صالحة برغم كده.
      if (data.status === "inactive" || data.role !== undefined || password) {
        await db
          .update(loginSessionsTable)
          .set({
            revokedAt: new Date(),
            revokedBy: req.user!.userId,
            revokedReason:
              data.status === "inactive" ? "تم إيقاف الحساب"
              : password ? "تم تغيير كلمة المرور بواسطة المدير"
              : "تم تغيير الدور",
          })
          .where(
            and(
              eq(loginSessionsTable.userId, id),
              isNull(loginSessionsTable.revokedAt),
            ),
          );
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ✨ GET /api/v1/users/:id/sessions — الـ admin يشوف كل جلسات مستخدم معين (شاشة "الجلسات النشطة")
router.get(
  "/users/:id/sessions",
  requireAuth,
  requireSettings,
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const sessions = await db
        .select()
        .from(loginSessionsTable)
        .where(eq(loginSessionsTable.userId, id))
        .orderBy(desc(loginSessionsTable.lastActiveAt));
      res.json(sessions);
    } catch (err) {
      next(err);
    }
  },
);

// ✨ DELETE /api/v1/users/:id/sessions/:sessionId — الـ admin يقفل جلسة معينة لمستخدم بعينه فورًا
router.delete(
  "/users/:id/sessions/:sessionId",
  requireAuth,
  requireSettings,
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const sessionId = parseInt(String(req.params.sessionId), 10);
      if (Number.isNaN(sessionId)) {
        res.status(400).json({ error: { message: "معرّف الجلسة غير صحيح" } });
        return;
      }

      const [updated] = await db
        .update(loginSessionsTable)
        .set({
          revokedAt: new Date(),
          revokedBy: req.user!.userId,
          revokedReason: "أُقفلت يدويًا بمعرفة الإدارة",
        })
        .where(
          and(
            eq(loginSessionsTable.userId, id),
            eq(loginSessionsTable.id, sessionId),
          ),
        )
        .returning();
      if (!updated) {
        res.status(404).json({ error: { message: "الجلسة غير موجودة" } });
        return;
      }
      res.json({ message: "تم إقفال الجلسة" });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/users/:id
router.delete(
  "/users/:id",
  requireAuth,
  requireSettings,
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      if (id === req.user!.userId) {
        res
          .status(400)
          .json({ error: { message: "لا يمكنك حذف حسابك الخاص" } });
        return;
      }
      const [existing] = await db
        .select()
        .from(systemUsersTable)
        .where(eq(systemUsersTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "المستخدم غير موجود" } });
        return;
      }
      await moveToTrash(
        db,
        "system_users",
        existing,
        req.user!.userId,
        req.user!.username,
        existing.fullName,
      );
      await db.delete(systemUsersTable).where(eq(systemUsersTable.id, id));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/action-registry — قائمة كل الإجراءات القابلة للتحكم فيها (لبناء شاشة الإدارة)
router.get(
  "/action-registry",
  requireAuth,
  requirePermissions,
  async (_req, res) => {
    res.json(ACTION_REGISTRY);
  },
);

// ✨ GET /api/v1/my-permission-overrides — أي مستخدم يقدر يشوف استثناءاته
// النشطة هو بنفسه (مش محتاج صلاحية أدمن — دي بياناته الشخصية). بتستخدمها
// شارة الشفافية في الواجهة عشان أي حد يعرف على طول لو عنده صلاحية إضافية
// أو مقيّدة دلوقتي من غير ما يسأل حد.
router.get("/my-permission-overrides", requireAuth, async (req, res, next) => {
  try {
    const overrides = await db
      .select()
      .from(permissionOverridesTable)
      .where(
        and(
          eq(permissionOverridesTable.userId, req.user!.userId),
          isNull(permissionOverridesTable.revokedAt),
        ),
      );
    const now = new Date();
    const active = overrides.filter((o) => !o.expiresAt || o.expiresAt > now);
    res.json(
      active.map((o) => ({
        actionKey: o.actionKey,
        label:
          ACTION_REGISTRY.find((a) => a.key === o.actionKey)?.label ??
          o.actionKey,
        allowed: o.allowed,
        reason: o.reason,
        expiresAt: o.expiresAt,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/users/:id/permission-overrides — كل استثناءات مستخدم معيّن (نشطة ومنتهية)
router.get(
  "/users/:id/permission-overrides",
  requireAuth,
  requirePermissions,
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const overrides = await db
        .select()
        .from(permissionOverridesTable)
        .where(eq(permissionOverridesTable.userId, id))
        .orderBy(desc(permissionOverridesTable.createdAt));
      res.json(overrides);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/permission-overrides — منح أو سحب صلاحية مخصّصة (دائم أو بتاريخ انتهاء)
router.post(
  "/permission-overrides",
  requireAuth,
  requirePermissions,
  async (req, res, next) => {
    try {
      const data = grantPermissionOverrideSchema.parse(req.body);

      if (data.userId === req.user!.userId) {
        throw Object.assign(
          new Error("لا يمكنك منح أو سحب صلاحية من حسابك الخاص"),
          { status: 400 },
        );
      }
      const action = ACTION_REGISTRY.find((a) => a.key === data.actionKey);
      if (!action) {
        throw Object.assign(new Error("مفتاح الإجراء غير معروف"), {
          status: 400,
        });
      }
      const [target] = await db
        .select({
          id: systemUsersTable.id,
          fullName: systemUsersTable.fullName,
        })
        .from(systemUsersTable)
        .where(eq(systemUsersTable.id, data.userId))
        .limit(1);
      if (!target) {
        throw Object.assign(new Error("المستخدم غير موجود"), { status: 404 });
      }

      // ✅ أي استثناء سابق نشط على نفس المستخدم + نفس الإجراء يتقفل تلقائيًا
      // قبل ما نضيف الجديد — عشان مايتراكمش أكتر من استثناء نشط على نفس المفتاح
      await db
        .update(permissionOverridesTable)
        .set({ revokedAt: new Date(), revokedBy: req.user!.userId })
        .where(
          and(
            eq(permissionOverridesTable.userId, data.userId),
            eq(permissionOverridesTable.actionKey, data.actionKey),
            isNull(permissionOverridesTable.revokedAt),
          ),
        );

      const [created] = await db
        .insert(permissionOverridesTable)
        .values({
          userId: data.userId,
          actionKey: data.actionKey,
          allowed: data.allowed,
          reason: data.reason ?? null,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          grantedBy: req.user!.userId,
        })
        .returning();

      const until =
        data.expiresAt ?
          ` حتى ${new Date(data.expiresAt).toLocaleDateString("ar-EG")}`
        : " (دائم)";
      await notifyUser(data.userId, {
        type: "permission_override",
        title: data.allowed ? "تم منحك صلاحية جديدة" : "تم إيقاف إحدى صلاحياتك",
        body: `${data.allowed ? "تم منحك" : "تم إيقاف"} صلاحية "${action.label}"${until}.${data.reason ? ` السبب: ${data.reason}` : ""}`,
      });

      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/permission-overrides/:id — إلغاء استثناء قبل ميعاده (رجوع للدور الافتراضي فورًا)
router.delete(
  "/permission-overrides/:id",
  requireAuth,
  requirePermissions,
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [existing] = await db
        .select()
        .from(permissionOverridesTable)
        .where(eq(permissionOverridesTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "الاستثناء غير موجود" } });
        return;
      }
      if (existing.revokedAt) {
        res
          .status(400)
          .json({ error: { message: "الاستثناء ده ملغي بالفعل" } });
        return;
      }

      await db
        .update(permissionOverridesTable)
        .set({ revokedAt: new Date(), revokedBy: req.user!.userId })
        .where(eq(permissionOverridesTable.id, id));

      const action = ACTION_REGISTRY.find((a) => a.key === existing.actionKey);
      await notifyUser(existing.userId, {
        type: "permission_override",
        title: "تم إلغاء استثناء صلاحية",
        body: `تم إلغاء استثناء صلاحية "${action?.label ?? existing.actionKey}" ورجعت لصلاحيات دورك الافتراضية.`,
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ✅ إصلاح جذري: قسم "عن النظام" في الإعدادات كان بيقول حرفيًا "التخزين:
// LocalStorage Browser" و"Vanilla JS" — بقايا من مرحلة قبل ما النظام يتحول
// لباك إند حقيقي (Express + PostgreSQL)، محدش حدّثها. ودالة renderSystemInfo
// في الفرونت كانت بتقرا من localStorage الفاضي أصلاً (كود ميت تمامًا —
// العناصر اللي بتستهدفها مش موجودة في الـHTML من زمان).
//
// ✨ بدل ما نصلح الكذبة بس، خليتها فعلاً مفيدة: نبضة حية حقيقية من قاعدة
// البيانات — عدد سجلات كل قسم، حجم قاعدة البيانات الفعلي، ومدة تشغيل
// السيرفر — حاجة أدمن حقيقي محتاجها فعلاً، مش ديكور.
router.get(
  "/system-info",
  requireAuth,
  requirePermissions,
  async (_req, res, next) => {
    try {
      const [
        contactsCount,
        salesCount,
        inventoryCount,
        usersCount,
        dbSizeResult,
        todayResult,
      ] = await Promise.all([
        db.select({ n: sql<number>`count(*)::int` }).from(contactsTable),
        db.select({ n: sql<number>`count(*)::int` }).from(salesOrdersTable),
        db.select({ n: sql<number>`count(*)::int` }).from(inventoryItemsTable),
        db.select({ n: sql<number>`count(*)::int` }).from(systemUsersTable),
        db.execute<{ size: string }>(
          sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
        ),
        // ✨ نبضة اليوم: كام سجل اتعمل النهارده في كل الأقسام الرئيسية مع بعض
        db.execute<{ n: number }>(sql`
        SELECT (
          (SELECT count(*) FROM ${salesOrdersTable} WHERE created_at::date = current_date) +
          (SELECT count(*) FROM ${stockMovementsTable} WHERE created_at::date = current_date) +
          (SELECT count(*) FROM ${productionWorkflowOrdersTable} WHERE created_at::date = current_date)
        )::int AS n
      `),
      ]);

      res.json({
        version: "2.0.0",
        stack: "Express + TypeScript + PostgreSQL + Drizzle ORM",
        storage: "PostgreSQL Database",
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        databaseSize: dbSizeResult.rows[0]?.size ?? "—",
        todayActivity: todayResult.rows[0]?.n ?? 0,
        modules: {
          contacts: contactsCount[0].n,
          sales: salesCount[0].n,
          inventory: inventoryCount[0].n,
          users: usersCount[0].n,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
