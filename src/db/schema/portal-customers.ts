/** @format */
/**
 * Portal Customers — بوابة عملاء الجملة
 *
 * نظام تسجيل دخول منفصل تمامًا عن حسابات الموظفين (system_users) —
 * أي عميل جملة يقدر يعمل حساب لنفسه من غير أي موافقة إدارية مسبقة،
 * ويستخدمه بس عشان يتصفح المنتجات ويبعت طلبات.
 *
 * كل عميل بوابة مرتبط تلقائيًا بسجل حقيقي في جدول contacts (type=customer)
 * عشان يظهر لموظفي الشركة في صفحة العملاء العادية من غير أي خطوة إضافية.
 */
import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { contactsTable, egyptGovernorateSchema } from "./contacts";
import { systemUsersTable } from "./settings";

export const portalCustomersTable = pgTable(
  "portal_customers",
  {
    id: serial("id").primaryKey(),
    // رقم الهاتف هو وسيلة الدخول الأساسية — لازم يكون فريد
    phone: text("phone").notNull(),
    normalizedPhone: text("normalized_phone"),
    // ✅ إضافة: إيميل اختياري — بيبقى وسيلة دخول تانية + قناة استرجاع الباسورد
    email: text("email"),
    normalizedEmail: text("normalized_email"),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    companyName: text("company_name").notNull(),
    normalizedCompanyName: text("normalized_company_name"),
    city: text("city"),
    minimumOrderQuantity: integer("minimum_order_quantity").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    // ربط حقيقي بجدول العملاء — يتعمل تلقائيًا عند التسجيل
    contactId: integer("contact_id")
      .notNull()
      .references(() => contactsTable.id),
    // Phase 7 (Governance & Portal project): المسؤول عن حساب العميل ده —
    // بيستخدمها ورشة عمل المبيعات (طلبات معلّقة + طلبات أسعار) عشان تعرض
    // "المسؤول" على كل عنصر، وهتستخدمها المرحلة 9 كمان لتوجيه شات
    // العميل مع مسؤوله مباشرة. اختياري تمامًا — لو فاضي، أي موظف مبيعات
    // يقدر يرد عادي.
    assignedSalesUserId: integer("assigned_sales_user_id").references(
      () => systemUsersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    phoneUnique: unique("portal_customers_phone_unique").on(table.phone),
    emailUnique: unique("portal_customers_email_unique").on(table.email),
    contactUnique: unique("portal_customers_contact_id_unique").on(table.contactId),
  }),
);

// ✅ جدول طلبات استرجاع الباسورد — بديل بسيط لغاية ما يتفعّل إيميل حقيقي:
// العميل بيطلب، وموظف (hr/admin/manager) بيشوف الطلب وبيعمل ريست يدوي
// ويوصّل الباسورد الجديد للعميل بنفسه (تليفون/واتساب)
export const portalPasswordResetRequestsTable = pgTable(
  "portal_password_reset_requests",
  {
    id: serial("id").primaryKey(),
    portalCustomerId: integer("portal_customer_id")
      .notNull()
      .references(() => portalCustomersTable.id),
    status: text("status").notNull().default("pending"), // pending / resolved
    resolvedById: integer("resolved_by_id"),
    resolvedByName: text("resolved_by_name"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const registerPortalCustomerSchema = z.object({
  fullName: z.string().min(2, "الاسم مطلوب (حرفين على الأقل)"),
  phone: z.string().min(8, "رقم هاتف غير صحيح"),
  email: z.string().email("بريد إلكتروني غير صحيح").optional().nullable(),
  password: z.string().min(6, "كلمة المرور لازم تكون 6 أحرف على الأقل"),
  companyName: z.string().min(2, "اسم الشركة مطلوب"),
  address: z.string().max(500, "العنوان طويل جدًا").optional().nullable(),
  city: egyptGovernorateSchema.optional().nullable(),
});

// ✅ الدخول بقى بـ"معرّف" واحد ممكن يكون رقم الهاتف أو الإيميل
export const loginPortalCustomerSchema = z.object({
  identifier: z.string().min(1, "رقم الهاتف أو البريد الإلكتروني مطلوب"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
  rememberMe: z.boolean().optional().default(false),
});

export const forgotPortalPasswordSchema = z.object({
  identifier: z.string().min(1, "رقم الهاتف أو البريد الإلكتروني مطلوب"),
});

export type PortalCustomer = typeof portalCustomersTable.$inferSelect;
export type PortalPasswordResetRequest =
  typeof portalPasswordResetRequestsTable.$inferSelect;
