/** @format */
/**
 * Portal Customers Admin — إدارة حسابات بوابة العملاء من جانب الموظفين
 */
import { Router, Request, Response, NextFunction } from "express";
import { eq, desc, and, inArray, ilike, or, count, max } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "../db";
import {
  contactsTable,
  portalApplicationsTable,
  portalActivationRequestsTable,
  portalActivationTokensTable,
  portalCustomersTable,
  portalPasswordResetRequestsTable,
  productionWorkflowOrdersTable,
  salesOrdersTable,
  egyptGovernorateSchema,
  contactSegmentSchema,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { revokeAllPortalSessions } from "../middleware/portal-auth";
import { PERMISSIONS } from "../lib/permissions";
import { writeAuditEvent } from "../lib/governance";
import { sendPortalSms } from "../lib/portalMessaging";
import {
  buildPortalActivationUrl,
  buildPortalPageUrl,
} from "../lib/portalConfig";
import { z } from "zod";
import { createHash, randomBytes, randomInt } from "node:crypto";

const router = Router();
const reviewerRoles = PERMISSIONS.portalCustomers.write;
const activationTokenLifetimeMs = 24 * 60 * 60 * 1000;

function domainError(status: number, code: string, message: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}

function parsePositiveId(value: string | string[]): number {
  if (Array.isArray(value)) {
    throw domainError(400, "INVALID_ID", "المعرّف غير صحيح");
  }
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw domainError(400, "INVALID_ID", "المعرّف غير صحيح");
  }
  return id;
}

function makeActivationToken(): {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const rawToken = randomBytes(32).toString("base64url");
  return {
    rawToken,
    tokenHash: createHash("sha256").update(rawToken).digest("hex"),
    expiresAt: new Date(Date.now() + activationTokenLifetimeMs),
  };
}

function supportPhone(): string {
  return process.env.PORTAL_SUPPORT_PHONE?.trim() || "رقم خدمة العملاء المعلن من الشركة";
}

function activationMessage(req: Request, customerName: string, rawToken: string): string {
  const activationUrl = buildPortalActivationUrl(req, rawToken);
  return [
    `مرحبًا ${customerName}، تم قبول طلبك في Hyper-Tech.`,
    `افتح رابط التفعيل خلال 24 ساعة لتحديد كلمة مرورك وتفعيل حسابك: ${activationUrl}`,
    "بعد التفعيل يمكنك تسجيل الدخول من بوابة عملاء الجملة.",
  ].join(" ");
}

function applicationContactNotes(application: typeof portalApplicationsTable.$inferSelect): string {
  const details = [
    application.commercialRegisterNo && `السجل التجاري: ${application.commercialRegisterNo}`,
    application.taxId && `الرقم الضريبي: ${application.taxId}`,
    application.expectedMonthlyVolume && `الحجم الشهري المتوقع: ${application.expectedMonthlyVolume}`,
    application.notes && `ملاحظات الطلب: ${application.notes}`,
  ].filter(Boolean);
  return ["تم إنشاؤه تلقائيًا بعد اعتماد طلب الانضمام", ...details].join(" — ");
}

function reviewerNoteSchema(label: string) {
  return z.object({
    reason: z.string().trim().min(2, `${label} مطلوب`).max(1000, `${label} طويل جدًا`),
  });
}

const customerListQuerySchema = z.object({
  q: z.string().trim().max(100, "نص البحث طويل جدًا").default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function customerHealth(balance: string | null, creditLimit: string | null, lastOrderAt: Date | null) {
  const daysSinceLastOrder = lastOrderAt
    ? Math.max(0, Math.floor((Date.now() - lastOrderAt.getTime()) / 86_400_000))
    : null;
  const creditUtilization =
    creditLimit === null || Number(creditLimit) <= 0
      ? null
      : Number(balance || 0) / Number(creditLimit);

  if (creditUtilization !== null && creditUtilization >= 1) {
    return { level: "critical", label: "تجاوز الحد الائتماني", daysSinceLastOrder, creditUtilization };
  }
  if (daysSinceLastOrder === null) {
    return { level: "new", label: "لا توجد طلبات بعد", daysSinceLastOrder, creditUtilization };
  }
  if (creditUtilization !== null && creditUtilization >= 0.8) {
    return { level: "warning", label: "قريب من الحد الائتماني", daysSinceLastOrder, creditUtilization };
  }
  if (daysSinceLastOrder > 90) {
    return { level: "warning", label: "يحتاج متابعة", daysSinceLastOrder, creditUtilization };
  }
  return { level: "healthy", label: "مستقر", daysSinceLastOrder, creditUtilization };
}

function customerSearchCondition(query: string) {
  if (!query) return undefined;
  const pattern = `%${query}%`;
  return or(
    ilike(portalCustomersTable.fullName, pattern),
    ilike(portalCustomersTable.phone, pattern),
    ilike(portalCustomersTable.companyName, pattern),
    ilike(contactsTable.name, pattern),
    ilike(contactsTable.phone, pattern),
    ilike(contactsTable.company, pattern),
  );
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

const activationConfirmSchema = z.object({
  contactId: z.coerce.number().int().positive("معرّف العميل غير صحيح"),
});
const activationRejectSchema = reviewerNoteSchema("سبب الرفض");

/* ============================================================
   GET /portal-customers — قائمة كل حسابات البوابة
============================================================ */
router.get(
  "/portal-customers",
  requireAuth,
  requireRole(...PERMISSIONS.portalCustomers.view),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q, page, pageSize } = customerListQuerySchema.parse(req.query);
      const where = customerSearchCondition(q);
      const offset = (page - 1) * pageSize;
      const rows = await db
        .select({
          id: portalCustomersTable.id,
          fullName: portalCustomersTable.fullName,
          phone: portalCustomersTable.phone,
          email: portalCustomersTable.email,
          companyName: portalCustomersTable.companyName,
          contactId: portalCustomersTable.contactId,
          minimumOrderQuantity: portalCustomersTable.minimumOrderQuantity,
          isActive: portalCustomersTable.isActive,
          createdAt: portalCustomersTable.createdAt,
          city: portalCustomersTable.city,
          segment: contactsTable.segment,
          balance: contactsTable.balance,
          creditLimit: contactsTable.creditLimit,
          lastOrderAt: max(salesOrdersTable.createdAt),
        })
        .from(portalCustomersTable)
        .leftJoin(contactsTable, eq(portalCustomersTable.contactId, contactsTable.id))
        .leftJoin(salesOrdersTable, eq(salesOrdersTable.contactId, contactsTable.id))
        .where(where)
        .groupBy(
          portalCustomersTable.id,
          contactsTable.balance,
          contactsTable.creditLimit,
          contactsTable.segment,
        )
        .orderBy(desc(portalCustomersTable.createdAt))
        .limit(pageSize)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(portalCustomersTable)
        .leftJoin(contactsTable, eq(portalCustomersTable.contactId, contactsTable.id))
        .where(where);

      res.json({
        items: rows.map((customer) => ({
          ...customer,
          health: customerHealth(customer.balance, customer.creditLimit, customer.lastOrderAt),
        })),
        total: Number(total),
        page,
        pageSize,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/portal-customers/export.csv",
  requireAuth,
  requireRole(...PERMISSIONS.portalCustomers.view),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q } = customerListQuerySchema.parse(req.query);
      const where = customerSearchCondition(q);
      const customers = await db
        .select({
          fullName: portalCustomersTable.fullName,
          companyName: portalCustomersTable.companyName,
          phone: portalCustomersTable.phone,
          email: portalCustomersTable.email,
          city: portalCustomersTable.city,
          segment: contactsTable.segment,
          isActive: portalCustomersTable.isActive,
          balance: contactsTable.balance,
          creditLimit: contactsTable.creditLimit,
          lastOrderAt: max(salesOrdersTable.createdAt),
        })
        .from(portalCustomersTable)
        .leftJoin(contactsTable, eq(portalCustomersTable.contactId, contactsTable.id))
        .leftJoin(salesOrdersTable, eq(salesOrdersTable.contactId, contactsTable.id))
        .where(where)
        .groupBy(
          portalCustomersTable.id,
          contactsTable.balance,
          contactsTable.creditLimit,
          contactsTable.segment,
        )
        .orderBy(desc(portalCustomersTable.createdAt));

      const lines = [
        ["الاسم", "الشركة", "الهاتف", "البريد", "المحافظة", "التصنيف", "الحالة", "الرصيد", "الحد الائتماني", "آخر طلب", "مؤشر الصحة"],
        ...customers.map((customer) => [
          customer.fullName,
          customer.companyName,
          customer.phone,
          customer.email,
          customer.city,
          customer.segment,
          customer.isActive ? "نشط" : "متوقف",
          customer.balance,
          customer.creditLimit,
          customer.lastOrderAt?.toISOString() || "",
          customerHealth(customer.balance, customer.creditLimit, customer.lastOrderAt).label,
        ]),
      ].map((row) => row.map(csvCell).join(","));

      res
        .status(200)
        .setHeader("Content-Type", "text/csv; charset=utf-8")
        .setHeader("Content-Disposition", 'attachment; filename="portal-customers.csv"')
        .send(`\uFEFF${lines.join("\n")}`);
    } catch (err) {
      next(err);
    }
  },
);

const customerStatusSchema = z.object({
  isActive: z.boolean(),
});
const customerCitySchema = z.object({
  city: egyptGovernorateSchema.nullable(),
});
const customerSegmentSchema = z.object({
  segment: contactSegmentSchema.nullable(),
});

router.patch(
  "/portal-customers/:id/status",
  requireAuth,
  requireRole(...PERMISSIONS.portalCustomers.write),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parsePositiveId(req.params.id);
      const { isActive } = customerStatusSchema.parse(req.body);

      const result = await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.id, id))
          .limit(1);
        if (!before) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الحساب غير موجود");

        const [updated] = await tx
          .update(portalCustomersTable)
          .set({ isActive })
          .where(eq(portalCustomersTable.id, id))
          .returning();
        if (!updated) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الحساب غير موجود");

        if (!isActive) {
          await revokeAllPortalSessions(id, tx);
        }

        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: isActive
            ? "portal.customer.activate"
            : "portal.customer.deactivate",
          resourceType: "portal_customer",
          resourceId: id,
          beforeData: before,
          afterData: updated,
          reason: isActive
            ? "إعادة تفعيل حساب عميل البوابة"
            : "إيقاف حساب عميل البوابة وإلغاء جلساته",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        return updated;
      });

      res.json({
        message: isActive ? "تم تفعيل حساب العميل" : "تم إيقاف حساب العميل",
        customer: result,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/portal-customers/:id/city",
  requireAuth,
  requireRole(...PERMISSIONS.portalCustomers.write),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parsePositiveId(req.params.id);
      const { city } = customerCitySchema.parse(req.body);
      const result = await db.transaction(async (tx) => {
        const [before] = await tx
          .select({
            portal: portalCustomersTable,
            contact: contactsTable,
          })
          .from(portalCustomersTable)
          .leftJoin(contactsTable, eq(portalCustomersTable.contactId, contactsTable.id))
          .where(eq(portalCustomersTable.id, id))
          .limit(1);
        if (!before) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الحساب غير موجود");

        const [updated] = await tx
          .update(portalCustomersTable)
          .set({ city })
          .where(eq(portalCustomersTable.id, id))
          .returning();
        if (!updated) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الحساب غير موجود");
        await tx
          .update(contactsTable)
          .set({ city, updatedAt: new Date() })
          .where(eq(contactsTable.id, updated.contactId));

        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "portal.customer.city.update",
          resourceType: "portal_customer",
          resourceId: id,
          beforeData: before,
          afterData: { ...updated, city },
          reason: "تحديث محافظة عنوان عميل البوابة",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        return updated;
      });
      res.json({ message: "تم تحديث المحافظة", customer: result });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/portal-customers/:id/segment",
  requireAuth,
  requireRole(...PERMISSIONS.portalCustomers.write),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parsePositiveId(req.params.id);
      const { segment } = customerSegmentSchema.parse(req.body);
      const result = await db.transaction(async (tx) => {
        const [before] = await tx
          .select({
            portal: portalCustomersTable,
            contact: contactsTable,
          })
          .from(portalCustomersTable)
          .leftJoin(contactsTable, eq(portalCustomersTable.contactId, contactsTable.id))
          .where(eq(portalCustomersTable.id, id))
          .limit(1);
        if (!before) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الحساب غير موجود");
        if (!before.contact) {
          throw domainError(409, "PORTAL_CUSTOMER_NOT_LINKED", "لا يمكن تصنيف حساب غير مرتبط بجهة اتصال");
        }

        const [updated] = await tx
          .update(contactsTable)
          .set({ segment, updatedAt: new Date() })
          .where(eq(contactsTable.id, before.contact.id))
          .returning();
        if (!updated) throw domainError(404, "CONTACT_NOT_FOUND", "جهة الاتصال غير موجودة");
        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "portal.customer.segment.update",
          resourceType: "portal_customer",
          resourceId: id,
          beforeData: before,
          afterData: { ...before.portal, contact: updated },
          reason: "تحديث تصنيف عميل البوابة",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        return updated;
      });
      res.json({ message: "تم تحديث تصنيف العميل", contact: result });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/portal-customers/:id",
  requireAuth,
  requireRole(...PERMISSIONS.portalCustomers.write),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parsePositiveId(req.params.id);

      await db.transaction(async (tx) => {
        const [customer] = await tx
          .select()
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.id, id))
          .limit(1);
        if (!customer) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الحساب غير موجود");
        if (customer.isActive) {
          throw domainError(
            409,
            "PORTAL_CUSTOMER_MUST_BE_INACTIVE",
            "أوقف الحساب أولًا قبل الحذف النهائي.",
          );
        }

        const [linkedOrder] = await tx
          .select({ id: productionWorkflowOrdersTable.id })
          .from(productionWorkflowOrdersTable)
          .where(eq(productionWorkflowOrdersTable.portalCustomerId, id))
          .limit(1);
        const [linkedInvoice] = await tx
          .select({ id: salesOrdersTable.id })
          .from(salesOrdersTable)
          .where(eq(salesOrdersTable.contactId, customer.contactId))
          .limit(1);
        if (linkedOrder || linkedInvoice) {
          throw domainError(
            409,
            "PORTAL_CUSTOMER_HAS_HISTORY",
            "لا يمكن الحذف النهائي لأن العميل مرتبط بطلبات إنتاج أو فواتير. استخدم إيقاف الحساب بدلًا من ذلك.",
          );
        }

        const [deleted] = await tx
          .delete(portalCustomersTable)
          .where(eq(portalCustomersTable.id, id))
          .returning({ id: portalCustomersTable.id });
        if (!deleted) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الحساب غير موجود");

        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "portal.customer.delete",
          resourceType: "portal_customer",
          resourceId: id,
          beforeData: customer,
          afterData: null,
          reason: "حذف نهائي لحساب عميل بوابة بلا سجل طلبات إنتاج",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
      });

      res.json({ message: "تم حذف حساب العميل نهائيًا" });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   PATCH /portal-customers/:id/minimum-order — تعديل الحد الأدنى
   من جانب الشركة فقط، مع تسجيل التعديل في سجل التدقيق
============================================================ */
const minimumOrderSchema = z.object({
  minimumOrderQuantity: z.coerce
    .number()
    .int("الحد الأدنى لازم يكون رقمًا صحيحًا")
    .min(1, "الحد الأدنى لازم يكون 1 على الأقل"),
});

router.patch(
  "/portal-customers/:id/minimum-order",
  requireAuth,
  requireRole(...PERMISSIONS.portalCustomers.write),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: { message: "معرّف غير صحيح" } });
        return;
      }

      const { minimumOrderQuantity } = minimumOrderSchema.parse(req.body);
      const [before] = await db
        .select({
          id: portalCustomersTable.id,
          fullName: portalCustomersTable.fullName,
          companyName: portalCustomersTable.companyName,
          minimumOrderQuantity: portalCustomersTable.minimumOrderQuantity,
        })
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, id))
        .limit(1);

      if (!before) {
        res.status(404).json({ error: { message: "الحساب غير موجود" } });
        return;
      }

      const [updated] = await db
        .update(portalCustomersTable)
        .set({ minimumOrderQuantity })
        .where(eq(portalCustomersTable.id, id))
        .returning({
          id: portalCustomersTable.id,
          fullName: portalCustomersTable.fullName,
          companyName: portalCustomersTable.companyName,
          minimumOrderQuantity: portalCustomersTable.minimumOrderQuantity,
        });

      if (!updated) {
        res.status(404).json({ error: { message: "الحساب غير موجود" } });
        return;
      }

      await writeAuditEvent({
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: "portal.customer.minimumOrder.update",
        resourceType: "portal_customer",
        resourceId: id,
        beforeData: before,
        afterData: updated,
        reason: "تعديل الحد الأدنى للطلب من لوحة إدارة العملاء",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        message: "تم تحديث الحد الأدنى للطلب",
        customer: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   GET /portal-customers/password-reset-requests — طلبات استرجاع الباسورد المعلّقة
============================================================ */
router.get(
  "/portal-customers/password-reset-requests",
  requireAuth,
  requireRole(...PERMISSIONS.portalCustomers.write),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const requests = await db
        .select({
          id: portalPasswordResetRequestsTable.id,
          status: portalPasswordResetRequestsTable.status,
          createdAt: portalPasswordResetRequestsTable.createdAt,
          customerName: portalCustomersTable.fullName,
          customerPhone: portalCustomersTable.phone,
          portalCustomerId: portalCustomersTable.id,
        })
        .from(portalPasswordResetRequestsTable)
        .innerJoin(
          portalCustomersTable,
          eq(
            portalPasswordResetRequestsTable.portalCustomerId,
            portalCustomersTable.id,
          ),
        )
        .where(eq(portalPasswordResetRequestsTable.status, "pending"))
        .orderBy(desc(portalPasswordResetRequestsTable.createdAt));
      res.json(requests);
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   PATCH /portal-customers/:id/reset-password — ✅ الحل البديل السريع لغاية
   ما يتفعّل إيميل حقيقي: الموظف بيحدد باسورد جديد للعميل (أو يسيب النظام
   يولّد واحد عشوائي قوي)، ويقفل أي طلب استرجاع معلّق ليه تلقائيًا
============================================================ */
const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(6, "كلمة المرور لازم تكون 6 أحرف على الأقل")
    .optional(),
});

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let result = "";
  for (let i = 0; i < 10; i++)
    result += chars[randomInt(chars.length)];
  return result;
}

router.patch(
  "/portal-customers/:id/reset-password",
  requireAuth,
  requireRole(...PERMISSIONS.portalCustomers.write),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!id) {
        res.status(400).json({ error: { message: "معرّف غير صحيح" } });
        return;
      }

      const { newPassword } = resetPasswordSchema.parse(req.body);
      // ✨ لو الموظف مكتبش باسورد جديد، النظام يولّد واحد عشوائي قوي بنفسه
      const finalPassword = newPassword || generateTempPassword();

      const customer = await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.id, id))
          .limit(1);
        if (!before) {
          throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الحساب غير موجود");
        }

        const [updated] = await tx
          .update(portalCustomersTable)
          .set({ passwordHash: await bcrypt.hash(finalPassword, 12) })
          .where(eq(portalCustomersTable.id, id))
          .returning({
            id: portalCustomersTable.id,
            fullName: portalCustomersTable.fullName,
            phone: portalCustomersTable.phone,
          });
        if (!updated) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الحساب غير موجود");
        await tx
          .update(portalPasswordResetRequestsTable)
          .set({
            status: "resolved",
            resolvedById: req.user!.userId,
            resolvedByName: req.user!.username,
            resolvedAt: new Date(),
          })
          .where(
            and(
              eq(portalPasswordResetRequestsTable.portalCustomerId, id),
              eq(portalPasswordResetRequestsTable.status, "pending"),
            ),
          );
        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "portal.customer.password.reset",
          resourceType: "portal_customer",
          resourceId: id,
          beforeData: { id: before.id, fullName: before.fullName, phone: before.phone },
          afterData: updated,
          reason: "إعادة تعيين كلمة مرور حساب عميل البوابة",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        return updated;
      });

      // ✅ الباسورد الجديد بيترجع في الرد عشان الموظف يوصّله للعميل تليفونيًا/واتساب
      res.json({
        message: "تم تعيين كلمة مرور جديدة",
        customer,
        newPassword: finalPassword,
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   GET /portal-applications — طلبات الانضمام الجديدة
============================================================ */
router.get(
  "/portal-applications",
  requireAuth,
  requireRole(...reviewerRoles),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestedStatus =
        typeof req.query.status === "string" ? req.query.status : "active";
      const statuses =
        requestedStatus === "all" ? ["pending", "needs_info", "approved", "rejected"] :
        requestedStatus === "needs_info" ? ["needs_info"] :
        requestedStatus === "approved" ? ["approved"] :
        requestedStatus === "rejected" ? ["rejected"] :
        ["pending", "needs_info"];

      const applications = await db
        .select()
        .from(portalApplicationsTable)
        .where(inArray(portalApplicationsTable.status, statuses))
        .orderBy(desc(portalApplicationsTable.createdAt));
      const duplicateFilters = applications.flatMap((application) => [
        eq(contactsTable.phone, application.phone),
        ilike(contactsTable.company, application.companyName),
      ]);
      const duplicateContacts = duplicateFilters.length
        ? await db
            .select({ id: contactsTable.id, phone: contactsTable.phone, company: contactsTable.company })
            .from(contactsTable)
            .where(or(...duplicateFilters))
        : [];
      res.json(applications.map((application) => ({
        ...application,
        duplicateContactId: duplicateContacts.find((contact) =>
          contact.phone === application.phone ||
          contact.company?.toLocaleLowerCase() === application.companyName.toLocaleLowerCase()
        )?.id ?? null,
      })));
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/portal-applications/:id/city",
  requireAuth,
  requireRole(...reviewerRoles),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const applicationId = parsePositiveId(req.params.id);
      const { city } = customerCitySchema.parse(req.body);
      const result = await db.transaction(async (tx) => {
        const [application] = await tx
          .select()
          .from(portalApplicationsTable)
          .where(eq(portalApplicationsTable.id, applicationId))
          .for("update");
        if (!application) throw domainError(404, "APPLICATION_NOT_FOUND", "طلب الانضمام غير موجود");
        if (!["pending", "needs_info"].includes(application.status)) {
          throw domainError(409, "APPLICATION_ALREADY_DECIDED", "لا يمكن تعديل محافظة طلب تمت مراجعته");
        }
        const [updated] = await tx
          .update(portalApplicationsTable)
          .set({ city, updatedAt: new Date() })
          .where(eq(portalApplicationsTable.id, applicationId))
          .returning();
        if (!updated) throw new Error("تعذر تحديث محافظة الطلب");
        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "portal.application.city.update",
          resourceType: "portal_application",
          resourceId: applicationId,
          beforeData: application,
          afterData: updated,
          reason: "تحديث محافظة عنوان طلب الانضمام",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        return updated;
      });
      res.json({ message: "تم تحديث محافظة الطلب", application: result });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   PATCH /portal-applications/:id/approve
   إنشاء contact + portal customer + وسيلة التفعيل في transaction واحدة
============================================================ */
router.patch(
  "/portal-applications/:id/approve",
  requireAuth,
  requireRole(...reviewerRoles),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const applicationId = parsePositiveId(req.params.id);
      const result = await db.transaction(async (tx) => {
        const [application] = await tx
          .select()
          .from(portalApplicationsTable)
          .where(eq(portalApplicationsTable.id, applicationId))
          .for("update");

        if (!application) throw domainError(404, "APPLICATION_NOT_FOUND", "طلب الانضمام غير موجود");
        if (!["pending", "needs_info"].includes(application.status)) {
          throw domainError(409, "APPLICATION_ALREADY_DECIDED", "تم اتخاذ قرار في طلب الانضمام ده بالفعل");
        }

        const [samePhone] = await tx
          .select({ id: portalCustomersTable.id })
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.phone, application.phone))
          .limit(1);
        if (samePhone) {
          throw domainError(409, "PORTAL_ACCOUNT_EXISTS", "رقم الهاتف ده مرتبط بحساب بوابة بالفعل");
        }
        if (application.email) {
          const [sameEmail] = await tx
            .select({ id: portalCustomersTable.id })
            .from(portalCustomersTable)
            .where(eq(portalCustomersTable.email, application.email))
            .limit(1);
          if (sameEmail) {
            throw domainError(409, "PORTAL_ACCOUNT_EXISTS", "البريد الإلكتروني ده مرتبط بحساب بوابة بالفعل");
          }
        }

        const [contact] = await tx
          .insert(contactsTable)
          .values({
            type: "customer",
            name: application.fullName,
            company: application.companyName,
            phone: application.phone,
            email: application.email,
            address: application.address,
            city: application.city,
            notes: applicationContactNotes(application),
          })
          .returning();
        if (!contact) throw new Error("تعذر إنشاء جهة اتصال للطلب");

        const bootstrapSecret = randomBytes(32).toString("base64url");
        const [customer] = await tx
          .insert(portalCustomersTable)
          .values({
            phone: application.phone,
            email: application.email,
            passwordHash: await bcrypt.hash(bootstrapSecret, 12),
            fullName: application.fullName,
            companyName: application.companyName,
            city: application.city,
            contactId: contact.id,
            minimumOrderQuantity: 1,
          })
          .returning({
            id: portalCustomersTable.id,
            fullName: portalCustomersTable.fullName,
            phone: portalCustomersTable.phone,
            companyName: portalCustomersTable.companyName,
            contactId: portalCustomersTable.contactId,
          });
        if (!customer) throw new Error("تعذر إنشاء حساب البوابة");

        const activation = makeActivationToken();
        await tx.insert(portalActivationTokensTable).values({
          portalCustomerId: customer.id,
          tokenHash: activation.tokenHash,
          expiresAt: activation.expiresAt,
        });

        const reviewedAt = new Date();
        const [updated] = await tx
          .update(portalApplicationsTable)
          .set({
            status: "approved",
            reviewedByUserId: req.user!.userId,
            reviewedAt,
            updatedAt: reviewedAt,
          })
          .where(eq(portalApplicationsTable.id, applicationId))
          .returning();
        if (!updated) throw new Error("تعذر تحديث حالة طلب الانضمام");

        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "portal.application.approved",
          resourceType: "portal_application",
          resourceId: applicationId,
          beforeData: application,
          afterData: {
            application: updated,
            contactId: contact.id,
            portalCustomerId: customer.id,
            activation: { status: "ready_for_delivery", expiresAt: activation.expiresAt },
          },
          decision: "approved",
          reason: "اعتماد طلب انضمام عميل جديد",
        });

        return {
          application: updated,
          customer,
          activationReady: true,
          activationExpiresAt: activation.expiresAt,
          activationToken: activation.rawToken,
        };
      });
      const { activationToken, ...safeResult } = result;
      const sms = await sendPortalSms({
        phone: result.customer.phone,
        message: activationMessage(req, result.customer.fullName, activationToken),
      });
      res.json({
        message: "تم اعتماد الطلب وإنشاء الحساب وإرسال طريقة التفعيل",
        ...safeResult,
        messaging: { delivered: sms.delivered },
      });
    } catch (err) {
      next(err);
    }
  },
);

async function reviewApplication(
  req: Request,
  applicationId: number,
  status: "needs_info" | "rejected",
  reason: string,
) {
  return db.transaction(async (tx) => {
    const [application] = await tx
      .select()
      .from(portalApplicationsTable)
      .where(eq(portalApplicationsTable.id, applicationId))
      .for("update");
    if (!application) throw domainError(404, "APPLICATION_NOT_FOUND", "طلب الانضمام غير موجود");
    if (!["pending", "needs_info"].includes(application.status)) {
      throw domainError(409, "APPLICATION_ALREADY_DECIDED", "تم اتخاذ قرار في طلب الانضمام ده بالفعل");
    }

    const reviewedAt = new Date();
    const [updated] = await tx
      .update(portalApplicationsTable)
      .set({
        status,
        reviewerNote: reason,
        reviewedByUserId: req.user!.userId,
        reviewedAt,
        updatedAt: reviewedAt,
      })
      .where(eq(portalApplicationsTable.id, applicationId))
      .returning();
    if (!updated) throw new Error("تعذر تحديث حالة طلب الانضمام");

    await writeAuditEvent({
      executor: tx,
      actorUserId: req.user!.userId,
      actorName: req.user!.username,
      actionKey: `portal.application.${status === "needs_info" ? "needs_info" : "rejected"}`,
      resourceType: "portal_application",
      resourceId: applicationId,
      beforeData: application,
      afterData: updated,
      decision: status,
      reason,
    });
     return { application: updated, phone: application.phone };
  });
}

router.patch(
  "/portal-applications/:id/needs-info",
  requireAuth,
  requireRole(...reviewerRoles),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reason } = reviewerNoteSchema("طلب المعلومات").parse(req.body);
      const result = await reviewApplication(req, parsePositiveId(req.params.id), "needs_info", reason);
      const sms = await sendPortalSms({
        phone: result.phone,
        message: [
          "Hyper-Tech: فريق المبيعات يحتاج معلومات إضافية لاستكمال مراجعة طلب انضمامك.",
          `الرسالة: ${reason}`,
          `للمساعدة تواصل مع خدمة العملاء: ${supportPhone()}`,
        ].join(" "),
      });
      res.json({
        message: "تم تسجيل طلب المعلومات الإضافية وإرسال إشعار للعميل",
        application: result.application,
        messaging: { delivered: sms.delivered },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/portal-applications/:id/reject",
  requireAuth,
  requireRole(...reviewerRoles),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reason } = reviewerNoteSchema("سبب الرفض").parse(req.body);
      const result = await reviewApplication(req, parsePositiveId(req.params.id), "rejected", reason);
      res.json({ message: "تم رفض طلب الانضمام وتسجيل السبب", application: result.application });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   GET /portal-activation-requests — طلبات عملاء موجودين بالفعل
============================================================ */
router.get(
  "/portal-activation-requests",
  requireAuth,
  requireRole(...reviewerRoles),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestedStatus =
        typeof req.query.status === "string" ? req.query.status : "pending";
      const statuses =
        requestedStatus === "all" ? ["pending", "confirmed", "rejected"] :
        requestedStatus === "confirmed" ? ["confirmed"] :
        requestedStatus === "rejected" ? ["rejected"] :
        ["pending"];

      const requests = await db
        .select({
          id: portalActivationRequestsTable.id,
          companyNameEntered: portalActivationRequestsTable.companyNameEntered,
          phoneEntered: portalActivationRequestsTable.phoneEntered,
          matchedContactId: portalActivationRequestsTable.matchedContactId,
          matchedPortalCustomerId: portalActivationRequestsTable.matchedPortalCustomerId,
          status: portalActivationRequestsTable.status,
          rejectionReason: portalActivationRequestsTable.rejectionReason,
          decidedAt: portalActivationRequestsTable.decidedAt,
          createdAt: portalActivationRequestsTable.createdAt,
          matchedContact: {
            id: contactsTable.id,
            name: contactsTable.name,
            company: contactsTable.company,
            phone: contactsTable.phone,
            email: contactsTable.email,
          },
        })
        .from(portalActivationRequestsTable)
        .leftJoin(
          contactsTable,
          eq(portalActivationRequestsTable.matchedContactId, contactsTable.id),
        )
        .where(inArray(portalActivationRequestsTable.status, statuses))
        .orderBy(desc(portalActivationRequestsTable.createdAt));
      res.json(requests);
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/portal-activation-requests/:id/confirm",
  requireAuth,
  requireRole(...reviewerRoles),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = parsePositiveId(req.params.id);
      const { contactId } = activationConfirmSchema.parse(req.body);
      const result = await db.transaction(async (tx) => {
        const [request] = await tx
          .select()
          .from(portalActivationRequestsTable)
          .where(eq(portalActivationRequestsTable.id, requestId))
          .for("update");
        if (!request) throw domainError(404, "ACTIVATION_REQUEST_NOT_FOUND", "طلب التفعيل غير موجود");
        if (request.status !== "pending") {
          throw domainError(409, "ACTIVATION_REQUEST_ALREADY_DECIDED", "تم اتخاذ قرار في طلب التفعيل ده بالفعل");
        }

        const [contact] = await tx
          .select()
          .from(contactsTable)
          .where(eq(contactsTable.id, contactId))
          .limit(1);
        if (!contact) throw domainError(404, "CONTACT_NOT_FOUND", "جهة الاتصال المختارة غير موجودة");

        const [existingByContact] = await tx
          .select({ id: portalCustomersTable.id })
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.contactId, contactId))
          .limit(1);
        if (existingByContact) {
          throw domainError(409, "PORTAL_ACCOUNT_EXISTS", "العميل ده عنده حساب بوابة بالفعل");
        }

        const customerPhone = contact.phone?.trim() || request.phoneEntered.trim();
        const [existingByPhone] = await tx
          .select({ id: portalCustomersTable.id })
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.phone, customerPhone))
          .limit(1);
        if (existingByPhone) {
          throw domainError(409, "PORTAL_ACCOUNT_EXISTS", "رقم هاتف العميل مرتبط بحساب بوابة بالفعل");
        }
        const customerEmail = contact.email?.trim() || null;
        if (customerEmail) {
          const [existingByEmail] = await tx
            .select({ id: portalCustomersTable.id })
            .from(portalCustomersTable)
            .where(eq(portalCustomersTable.email, customerEmail))
            .limit(1);
          if (existingByEmail) {
            throw domainError(409, "PORTAL_ACCOUNT_EXISTS", "البريد الإلكتروني للعميل مرتبط بحساب بوابة بالفعل");
          }
        }

        const bootstrapSecret = randomBytes(32).toString("base64url");
        const [customer] = await tx
          .insert(portalCustomersTable)
          .values({
            phone: customerPhone,
            email: customerEmail,
            passwordHash: await bcrypt.hash(bootstrapSecret, 12),
            fullName: contact.name,
            companyName: contact.company || request.companyNameEntered,
            city: contact.city || null,
            contactId,
            minimumOrderQuantity: 1,
          })
          .returning({
            id: portalCustomersTable.id,
            fullName: portalCustomersTable.fullName,
            phone: portalCustomersTable.phone,
            companyName: portalCustomersTable.companyName,
            contactId: portalCustomersTable.contactId,
          });
        if (!customer) throw new Error("تعذر إنشاء حساب البوابة");

        const activation = makeActivationToken();
        await tx.insert(portalActivationTokensTable).values({
          portalCustomerId: customer.id,
          tokenHash: activation.tokenHash,
          expiresAt: activation.expiresAt,
        });

        const decidedAt = new Date();
        const [updated] = await tx
          .update(portalActivationRequestsTable)
          .set({
            status: "confirmed",
            matchedContactId: contactId,
            matchedPortalCustomerId: customer.id,
            decidedByUserId: req.user!.userId,
            decidedAt,
          })
          .where(eq(portalActivationRequestsTable.id, requestId))
          .returning();
        if (!updated) throw new Error("تعذر تحديث حالة طلب التفعيل");

        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "portal.activation_request.confirmed",
          resourceType: "portal_activation_request",
          resourceId: requestId,
          beforeData: request,
          afterData: {
            request: updated,
            contactId,
            portalCustomerId: customer.id,
            activation: { status: "ready_for_delivery", expiresAt: activation.expiresAt },
          },
          decision: "confirmed",
          reason: "تأكيد ربط عميل موجود بحساب البوابة",
        });
        return {
          request: updated,
          customer,
          activationReady: true,
          activationExpiresAt: activation.expiresAt,
          activationToken: activation.rawToken,
        };
      });
      const { activationToken, ...safeResult } = result;
      const sms = await sendPortalSms({
        phone: result.customer.phone,
        message: activationMessage(req, result.customer.fullName, activationToken),
      });
      res.json({
        message: "تم تأكيد الطلب وإنشاء الحساب وإرسال طريقة التفعيل",
        ...safeResult,
        messaging: { delivered: sms.delivered },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/portal-activation-requests/:id/reject",
  requireAuth,
  requireRole(...reviewerRoles),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = parsePositiveId(req.params.id);
      const { reason } = activationRejectSchema.parse(req.body);
      const result = await db.transaction(async (tx) => {
        const [request] = await tx
          .select()
          .from(portalActivationRequestsTable)
          .where(eq(portalActivationRequestsTable.id, requestId))
          .for("update");
        if (!request) throw domainError(404, "ACTIVATION_REQUEST_NOT_FOUND", "طلب التفعيل غير موجود");
        if (request.status !== "pending") {
          throw domainError(409, "ACTIVATION_REQUEST_ALREADY_DECIDED", "تم اتخاذ قرار في طلب التفعيل ده بالفعل");
        }

        const decidedAt = new Date();
        const [updated] = await tx
          .update(portalActivationRequestsTable)
          .set({
            status: "rejected",
            rejectionReason: reason,
            decidedByUserId: req.user!.userId,
            decidedAt,
          })
          .where(eq(portalActivationRequestsTable.id, requestId))
          .returning();
        if (!updated) throw new Error("تعذر تحديث حالة طلب التفعيل");

        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "portal.activation_request.rejected",
          resourceType: "portal_activation_request",
          resourceId: requestId,
          beforeData: request,
          afterData: updated,
          decision: "rejected",
          reason,
        });
        return updated;
      });
      const sms = await sendPortalSms({
        phone: result.phoneEntered,
        message: [
          "Hyper-Tech: لم نتمكن من اعتماد طلب تفعيل دخولك حاليًا.",
          `للمساعدة لديك خياران: 1) تواصل مباشرة مع خدمة العملاء على ${supportPhone()}.`,
          `2) قدّم كعميل جديد من خلال هذا الرابط: ${buildPortalPageUrl(req, "/portal-login.html#new-customer")}`,
        ].join(" "),
      });
      res.json({
        message: "تم رفض طلب التفعيل وتسجيل السبب وإرسال خيارات المساعدة",
        request: result,
        messaging: { delivered: sms.delivered },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
