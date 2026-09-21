/** @format */

import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { USER_ROLES } from "../../lib/roles";

export const systemSettingsTable = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const systemUsersTable = pgTable("system_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
    role: text("role").notNull().default("sales_manager"),
  status: text("status").notNull().default("active"),
  scopeId: text("scope_id"),
  maxConcurrentSessions: integer("max_concurrent_sessions"),
  // ✅ خزنة المدير الكامل — كلمة مرور منفصلة تمامًا عن باسورد الدخول
  // تُستخدم فقط لصفحة سلة المهملات ومسح البيانات الشامل. فارغة = لسه متعملتش
  vaultPasswordHash: text("vault_password_hash"),
  vaultSecurityQuestion: text("vault_security_question"),
  vaultSecurityAnswerHash: text("vault_security_answer_hash"),
  // Security hardening: account-level brute-force lockout (independent of
  // the IP-based rate limiter) + optional TOTP 2FA — see
  // src/domain/auth-security.ts for the algorithm (verified against the
  // official RFC 6238 test vectors) and src/routes/auth.ts for the flow.
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  totpSecret: text("totp_secret"),
  totpPendingSecret: text("totp_pending_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  totpBackupCodes: jsonb("totp_backup_codes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ✅ إصلاح: جلسات الدخول — بدل ما الـ JWT يحمل الدور جوّه نفسه ويفضل صالح لحد
// 7 أيام حتى لو الحساب اتوقف، كل تسجيل دخول بياخد سطر هنا، والـ JWT بيحمل
// بس رقم الجلسة. كل طلب بيتأكد من قاعدة البيانات مباشرة (الدور + حالة
// الحساب + هل الجلسة اتقفلت)، فأي تعطيل أو تغيير دور بيتفعّل فورًا.
export const loginSessionsTable = pgTable(
  "login_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => systemUsersTable.id, { onDelete: "cascade" }),
    deviceInfo: text("device_info"), // User-Agent
    ipAddress: text("ip_address"),
    // ✨ مفاجأة: علامة تلقائية لو الجهاز/الـ IP ده أول مرة يدخل بيه المستخدم ده
    isNewDevice: boolean("is_new_device").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: integer("revoked_by").references(() => systemUsersTable.id),
    revokedReason: text("revoked_reason"),
  },
  (table) => ({
    userIdx: index("login_sessions_user_idx").on(table.userId),
  }),
);

export const insertSystemSettingSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export const insertSystemUserSchema = z.object({
  username: z.string().min(3, "اسم المستخدم يجب أن يكون 3 أحرف على الأقل"),
  passwordHash: z.string(),
  fullName: z.string().min(1, "الاسم الكامل مطلوب"),
  role: z.enum(USER_ROLES).default("sales_manager"),
  status: z.enum(["active", "inactive"]).default("active"),
  scopeId: z.string().max(120).optional().nullable(),
  maxConcurrentSessions: z.number().int().positive().optional().nullable(),
});

export type LoginSession = typeof loginSessionsTable.$inferSelect;

// ✨ نظام الصلاحيات المخصّصة — طبقة فوق نظام الأدوار الحالي، مش بديل له.
// كل إجراء في النظام له "مفتاح" ثابت (زي "sales.delete" أو "inventory.edit").
// الأدوار (PERMISSIONS matrix) بتفضل هي الأساس الافتراضي لكل المستخدمين،
// لكن أي مستخدم بعينه ممكن يتاخد له استثناء صريح — سواء منح صلاحية إضافية
// (allowed=true) مش موجودة في دوره الأصلي، أو سحب صلاحية كانت متاحة له
// (allowed=false)، بشكل دائم أو مؤقت (expiresAt) — ده نفس الآلية اللي
// بيتبني عليها "التفويض المؤقت وقت الإجازة": مجرد استثناء بتاريخ انتهاء.
export const permissionOverridesTable = pgTable(
  "permission_overrides",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => systemUsersTable.id, { onDelete: "cascade" }),
    actionKey: text("action_key").notNull(), // مثال: "sales.delete", "inventory.movements.create"
    allowed: boolean("allowed").notNull(), // true = سماح استثنائي، false = منع استثنائي
    reason: text("reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // null = دائم
    grantedBy: integer("granted_by")
      .notNull()
      .references(() => systemUsersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: integer("revoked_by").references(() => systemUsersTable.id),
  },
  (table) => ({
    userIdx: index("permission_overrides_user_idx").on(table.userId),
    userActionIdx: index("permission_overrides_user_action_idx").on(
      table.userId,
      table.actionKey,
    ),
  }),
);

export const grantPermissionOverrideSchema = z.object({
  userId: z.number().int().positive(),
  actionKey: z.string().min(1),
  allowed: z.boolean(),
  reason: z.string().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(), // ISO — null/undefined = دائم
});

export type PermissionOverride = typeof permissionOverridesTable.$inferSelect;

export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;
export type SystemSetting = typeof systemSettingsTable.$inferSelect;
export type InsertSystemUser = z.infer<typeof insertSystemUserSchema>;
export type SystemUser = typeof systemUsersTable.$inferSelect;
