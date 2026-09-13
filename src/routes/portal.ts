/** @format */
/**
 * Portal Routes — بوابة عملاء الجملة
 *
 * نقطة دخول عميل الجملة للنظام: يتصفح المنتجات من غير تسجيل دخول، يقدّم
 * طلب انضمام تتم مراجعته، ويبعت طلب (ممكن أكتر من منتج مع بعض في نفس الإرسالة) —
 * كل منتج في الطلب بيتحول لأمر إنتاج حقيقي (production_workflow_orders)
 * بالحالة الأولى "new" بالظبط زي ما لو الاتش آر هو اللي دخّله يدوي —
 * يعني دورة الإنتاج بعد كده تمشي زي ما هي 100% من غير أي تغيير.
 */
import { Router, Request, Response, NextFunction } from "express";
import { and, eq, desc, sql, inArray, gt, isNull, ne, count } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { createHash, randomInt } from "node:crypto";
import { db } from "../db";
import {
  portalCustomersTable,
  portalPasswordResetRequestsTable,
  portalApplicationsTable,
  portalActivationRequestsTable,
  portalActivationTokensTable,
  portalSessionsTable,
  portalOrderReviewsTable,
  loginPortalCustomerSchema,
  forgotPortalPasswordSchema,
  contactsTable,
  bomRecipesTable,
  bomRecipeItemsTable,
  productionWorkflowOrdersTable,
  portalCartItemsTable,
  portalWishlistItemsTable,
  portalOtpCodesTable,
  portalNotificationsTable,
} from "../db/schema";
import {
  requirePortalAuth,
  createPortalSession,
  revokePortalSession,
  revokeAllPortalSessions,
  getAuthenticatedPortalCustomerId,
} from "../middleware/portal-auth";
import { loginRateLimiter, otpRequestRateLimiter } from "../middleware/rateLimiter";
import { notifyRole, notifyRoles } from "../lib/notifications";
import { notifyPortalCustomer } from "../lib/portalNotifications";
import { sendCustomerAlert, sendOtpCode } from "../lib/otpDelivery";
import { generateWorkflowOrderNumber } from "./production-workflow";
import { toPortalOrderItem } from "../domain/portal-orders";
import { z } from "zod";
import { logger } from "../lib/logger";
import { writeAuditEvent } from "../lib/governance";
import { parseIdParam } from "../lib/validate";
import {
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
  normalizePortalIdentifier,
} from "../lib/identityNormalization";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const router = Router();
const applicationReferenceAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const portalDummyPasswordHash = bcrypt.hash(
  "portal-timing-padding-password",
  12,
);
const portalAccountLoginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const rawIdentifier =
      typeof req.body?.identifier === "string" ?
        req.body.identifier
      : "missing";
    const identifier = normalizePortalIdentifier(rawIdentifier).value || "missing";
    return `${req.ip || "unknown"}:${identifier}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "PORTAL_LOGIN_RATE_LIMIT_EXCEEDED",
      message: "محاولات تسجيل دخول كثيرة — حاول مرة أخرى بعد 15 دقيقة",
    },
  },
});
const portalOtpNormalizedRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => {
    const rawIdentifier =
      typeof req.body?.identifier === "string" ?
        req.body.identifier
      : "missing";
    const identifier = normalizePortalIdentifier(rawIdentifier).value || "missing";
    return `${req.ip || "unknown"}:${identifier}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "PORTAL_OTP_REQUEST_RATE_LIMIT_EXCEEDED",
      message: "تم تجاوز الحد المسموح لطلبات الأكواد — حاول مرة أخرى بعد ساعة",
    },
  },
});

function generateApplicationReferenceCode(): string {
  let referenceCode = "";
  for (let i = 0; i < 8; i++) {
    referenceCode += applicationReferenceAlphabet[
      randomInt(applicationReferenceAlphabet.length)
    ];
  }
  return referenceCode;
}

// Kept for the legacy activation-request contact lookup; its identity
// matching is handled in the later contact-linking phase.
function normalizeLookupValue(value: string): string {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function portalIdentifierCondition(
  identifier: string,
  channel: "phone" | "email",
) {
  return channel === "email"
    ? eq(portalCustomersTable.normalizedEmail, identifier)
    : eq(portalCustomersTable.normalizedPhone, identifier);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

const configuredMinimumOrderQuantityRaw = Number(
  process.env.PORTAL_MIN_ORDER_QTY || "1",
);
const configuredMinimumOrderQuantity =
  (
    Number.isFinite(configuredMinimumOrderQuantityRaw) &&
    Number.isInteger(configuredMinimumOrderQuantityRaw)
  ) ?
    Math.max(1, configuredMinimumOrderQuantityRaw)
  : 1;

const productionTimelineStatuses = new Set([
  "in_production",
  "quality_check",
  "completed",
  "delivery_pending_customer",
  "delivery_pending_warehouse",
  "delivered_customer",
  "delivered_warehouse",
]);
const readyTimelineStatuses = new Set([
  "completed",
  "delivery_pending_customer",
  "delivery_pending_warehouse",
  "delivered_customer",
  "delivered_warehouse",
]);
const deliveredTimelineStatuses = new Set([
  "delivered_customer",
  "delivered_warehouse",
]);
const reviewCompletedStatuses = new Set([
  "materials_requested",
  "materials_approved",
  "materials_partial",
  "materials_rejected",
  ...productionTimelineStatuses,
]);

const configuredOtpTtlMinutesRaw = Number(
  process.env.PORTAL_OTP_TTL_MINUTES || "10",
);
const configuredOtpTtlMinutes =
  Number.isFinite(configuredOtpTtlMinutesRaw) &&
  configuredOtpTtlMinutesRaw >= 5 &&
  configuredOtpTtlMinutesRaw <= 10
    ? configuredOtpTtlMinutesRaw
    : 10;
const configuredOtpMaxAttemptsRaw = Number(
  process.env.PORTAL_OTP_MAX_ATTEMPTS || "5",
);
const configuredOtpMaxAttempts =
  Number.isInteger(configuredOtpMaxAttemptsRaw) &&
  configuredOtpMaxAttemptsRaw >= 1 &&
  configuredOtpMaxAttemptsRaw <= 10
    ? configuredOtpMaxAttemptsRaw
    : 5;

/**
 * The production table has no dedicated timestamps for `in_production` and
 * `completed`. For the customer-facing timeline, production starts at
 * teamAssignedAt (or receivedAt when that is the only available milestone),
 * and completion is represented by qualityDoneAt after a passed quality gate.
 * These fallbacks keep older orders useful without inventing dates.
 */
function buildPortalTimeline(
  order: typeof productionWorkflowOrdersTable.$inferSelect,
  review: typeof portalOrderReviewsTable.$inferSelect | undefined,
) {
  const status = order.workflowStatus;
  const reviewReached =
    Boolean(order.supervisorAcceptedAt) ||
    reviewCompletedStatuses.has(status) ||
    Boolean(review);
  const priced = review?.status === "confirmed";
  const productionStarted = productionTimelineStatuses.has(status);
  const productionAt =
    productionStarted ? order.teamAssignedAt || order.receivedAt : null;
  const ready =
    readyTimelineStatuses.has(status) ||
    (order.qualityStatus === "passed" && Boolean(order.qualityDoneAt));
  const delivered =
    deliveredTimelineStatuses.has(status) || Boolean(order.deliveredAt);

  let currentKey: string | null = null;
  if (!reviewReached) currentKey = "review";
  else if (!priced) currentKey = "priced";
  else if (!productionStarted) currentKey = "production";
  else if (!ready) currentKey = "ready";
  else if (!delivered) currentKey = "delivered";

  return [
    {
      key: "received",
      label: "تم الاستلام",
      state: "reached",
      at: order.createdAt,
    },
    {
      key: "review",
      label: "قيد المراجعة",
      state: reviewReached ? "reached" : currentKey === "review" ? "current" : "upcoming",
      at: order.supervisorAcceptedAt || null,
    },
    {
      key: "priced",
      label: "تم التسعير",
      state: priced ? "reached" : currentKey === "priced" ? "current" : "upcoming",
      at: priced ? review?.createdAt || null : null,
    },
    {
      key: "production",
      label: "قيد التصنيع",
      state:
        productionStarted ? "reached"
        : currentKey === "production" ? "current"
        : "upcoming",
      at: productionAt,
    },
    {
      key: "ready",
      label: "جاهز للتسليم",
      state: ready ? "reached" : currentKey === "ready" ? "current" : "upcoming",
      at:
        ready && order.qualityStatus === "passed" ?
          order.qualityDoneAt || null
        : null,
    },
    {
      key: "delivered",
      label: "تم التسليم",
      state:
        delivered ? "reached"
        : currentKey === "delivered" ? "current"
        : "upcoming",
      at: delivered ? order.deliveredAt || null : null,
    },
  ];
}

function priorityLabel(p: string): string {
  return (
    { low: "منخفضة", normal: "عادية", high: "مرتفعة", urgent: "عاجلة جداً" }[
      p
    ] || p
  );
}

/* ============================================================
   POST /portal/register — معطّل عمدًا منذ 2026-09-03
   استُبدل بـ /portal/applications و/portal/activation-requests.
   الكود القديم محفوظ في التعليق أدناه لأغراض التوثيق التاريخي فقط.
============================================================ */
router.post(
  "/portal/register",
  loginRateLimiter,
  async (_req: Request, res: Response) => {
    res.status(410).json({
      error: {
        code: "PORTAL_SELF_REGISTRATION_DISABLED",
        message:
          "التسجيل المباشر لم يعد متاحًا، يرجى التقديم كعميل جديد عبر البوابة",
      },
    });
  },
);

/*
  LEGACY /portal/register implementation — intentionally retained as
  documentation only. It used to create a contact, create a portal customer,
  and start a session directly from a password supplied by the visitor.
  It must not be re-enabled; approved access now goes through the review,
  activation-token, and one-time activation flows.

  Former flow (kept disabled):
  // const data = registerPortalCustomerSchema.parse(req.body);
  // const passwordHash = await bcrypt.hash(data.password, 12);
  // const contact = await tx.insert(contactsTable).values({...data}).returning();
  // const customer = await tx.insert(portalCustomersTable).values({
  //   ...data, passwordHash, contactId: contact.id,
  // }).returning();
  // const token = await createPortalSession(customer.id);
  // res.status(201).json({ token, customer });
*/

/* ============================================================
   POST /portal/applications — طلب انضمام بدون إنشاء حساب
============================================================ */
const portalApplicationSchema = z.object({
  fullName: z.string().trim().min(2, "الاسم مطلوب (حرفين على الأقل)"),
  phone: z.string().trim().min(8, "رقم هاتف غير صحيح"),
  email: z
    .string()
    .trim()
    .email("بريد إلكتروني غير صحيح")
    .optional()
    .nullable(),
  address: z.string().trim().max(500, "العنوان طويل جدًا").optional().nullable(),
  city: z.string().trim().max(80, "اسم المحافظة طويل جدًا").optional().nullable(),
  companyName: z.string().trim().min(2, "اسم الشركة مطلوب"),
  commercialRegisterNo: z.string().trim().max(120).optional().nullable(),
  taxId: z.string().trim().max(120).optional().nullable(),
  expectedMonthlyVolume: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

router.post(
  "/portal/applications",
  loginRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = portalApplicationSchema.parse(req.body);
      const phone = data.phone.trim();

       const [existingCustomer] = await db
        .select({ id: portalCustomersTable.id })
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.phone, phone))
        .limit(1);
       if (existingCustomer) {
         res.status(202).json({
           message:
             "لو البيانات مؤهلة، هيتواصل معاك فريق المبيعات لاستكمال الطلب",
         });
         return;
       }

      const [existingApplication] = await db
        .select({
          referenceCode: portalApplicationsTable.referenceCode,
        })
        .from(portalApplicationsTable)
        .where(
          and(
            eq(portalApplicationsTable.phone, phone),
            inArray(portalApplicationsTable.status, ["pending", "needs_info"]),
          ),
        )
        .orderBy(desc(portalApplicationsTable.createdAt))
        .limit(1);
      if (existingApplication) {
        res.status(202).json({
          message:
            "لو البيانات مؤهلة، هيتواصل معاك فريق المبيعات لاستكمال الطلب",
        });
        return;
      }

      const [application] = await db
        .insert(portalApplicationsTable)
        .values({
          referenceCode: generateApplicationReferenceCode(),
          fullName: data.fullName,
          companyName: data.companyName,
          phone,
          email: normalizeOptionalText(data.email),
          address: normalizeOptionalText(data.address) || "",
          city: normalizeOptionalText(data.city),
          commercialRegisterNo: normalizeOptionalText(data.commercialRegisterNo),
          taxId: normalizeOptionalText(data.taxId),
          expectedMonthlyVolume: normalizeOptionalText(data.expectedMonthlyVolume),
          notes: normalizeOptionalText(data.notes),
        })
        .returning({ referenceCode: portalApplicationsTable.referenceCode });

      if (!application) {
        throw new Error("تعذر حفظ طلب الانضمام");
      }

      res.status(201).json({ referenceCode: application.referenceCode });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   POST /portal/activation-requests — عميل موجود يطلب دخول البوابة
============================================================ */
const portalActivationRequestSchema = z.object({
  companyName: z.string().trim().min(2, "اسم الشركة مطلوب"),
  phone: z.string().trim().min(8, "رقم هاتف غير صحيح"),
});

async function findPortalActivationContact(
  companyName: string,
  phone: string,
): Promise<number | null> {
  const normalizedPhone = normalizeLookupValue(phone);
  const [phoneMatch] = await db
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(
      sql`lower(regexp_replace(coalesce(${contactsTable.phone}, ''), '[[:space:]]', '', 'g')) = ${normalizedPhone}`,
    )
    .limit(1);

  const normalizedCompany = normalizeLookupValue(companyName);
  const [companyMatch] = await db
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(
      sql`lower(regexp_replace(coalesce(${contactsTable.company}, ''), '[[:space:]]', '', 'g')) = ${normalizedCompany}`,
    )
    .limit(1);
  // Run both lookups for every request so a phone match does not create a
  // noticeably shorter path than a company-only match.
  return phoneMatch?.id ?? companyMatch?.id ?? null;
}

router.post(
  "/portal/activation-requests",
  loginRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = portalActivationRequestSchema.parse(req.body);
      const phone = data.phone.trim();
      const companyName = data.companyName.trim();

      const [existingCustomer] = await db
        .select({ id: portalCustomersTable.id })
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.phone, phone))
        .limit(1);
      if (existingCustomer) {
        res.status(202).json({
          message:
            "لو البيانات مؤهلة، هيتواصل معاك فريق المبيعات لاستكمال الطلب",
        });
        return;
      }

      const matchedContactId = await findPortalActivationContact(
        companyName,
        phone,
      );
      await db.insert(portalActivationRequestsTable).values({
        companyNameEntered: companyName,
        phoneEntered: phone,
        matchedContactId,
        status: "pending",
      });

      res.json({
        message:
          "طلبك وصل لفريق المبيعات، هيتواصلوا معاك أو هتوصلك بيانات الدخول قريبًا",
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   GET /portal/applications/track — تتبع طلب الانضمام
============================================================ */
router.get(
  "/portal/applications/track",
  loginRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const referenceCode =
        typeof req.query.referenceCode === "string" ?
          req.query.referenceCode.trim()
        : "";
      const phone =
        typeof req.query.phone === "string" ? req.query.phone.trim() : "";

      if (!referenceCode || !phone) {
        res.status(400).json({
          error: {
            code: "INVALID_TRACKING_REQUEST",
            message: "رقم الطلب ورقم الهاتف مطلوبان لمتابعة الحالة",
          },
        });
        return;
      }

      const [application] = await db
        .select({
          status: portalApplicationsTable.status,
          reviewerNote: portalApplicationsTable.reviewerNote,
        })
        .from(portalApplicationsTable)
        .where(
          and(
            eq(portalApplicationsTable.referenceCode, referenceCode),
            eq(portalApplicationsTable.phone, phone),
          ),
        )
        .limit(1);

      if (!application) {
        res.status(404).json({
          error: {
            code: "APPLICATION_NOT_FOUND",
            message: "رقم الطلب أو رقم الهاتف غير صحيح",
          },
        });
        return;
      }

      res.json({
        status: application.status,
        reviewerNote: application.reviewerNote,
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   POST /portal/login
============================================================ */
router.post(
  "/portal/login",
  loginRateLimiter,
  portalAccountLoginRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = loginPortalCustomerSchema.parse(req.body);
      // ✅ الدخول بقى يقبل رقم الهاتف أو الإيميل في نفس الخانة
      const identifier = normalizePortalIdentifier(data.identifier);
      const [customer] = await db
        .select()
        .from(portalCustomersTable)
        .where(
          and(
            portalIdentifierCondition(identifier.value, identifier.channel),
            eq(portalCustomersTable.isActive, true),
          ),
        )
        .limit(1);

      const passwordMatches = await bcrypt.compare(
        data.password,
        customer?.passwordHash ?? (await portalDummyPasswordHash),
      );
      if (!customer || !passwordMatches) {
        res.status(401).json({ error: { message: "بيانات الدخول غير صحيحة" } });
        return;
      }

      const token = await createPortalSession(customer.id, {
        rememberMe: data.rememberMe,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json({
        token,
        rememberMe: data.rememberMe,
        customer: {
          id: customer.id,
          fullName: customer.fullName,
          phone: customer.phone,
          email: customer.email,
          companyName: customer.companyName,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   POST /portal/logout — إلغاء الجلسة الحالية فورًا
============================================================ */
router.post(
  "/portal/logout",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authorization = req.headers.authorization!;
      const sessionToken = authorization.slice(7).trim();
      await revokePortalSession(sessionToken);
      res.json({ message: "تم تسجيل الخروج وإلغاء الجلسة الحالية" });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   POST /portal/forgot-password — ✅ جديد: العميل نسي الباسورد
   من غير خدمة إيميل حقيقية دلوقتي، الطلب بيوصل لفريق المبيعات/الاتش آر
   يقدروا يعملوا ريست يدوي ويوصّلوا الباسورد الجديد للعميل بأنفسهم
============================================================ */
router.post(
  "/portal/forgot-password",
  loginRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = forgotPortalPasswordSchema.parse(req.body);
      const identifier = normalizePortalIdentifier(data.identifier);
      const [customer] = await db
        .select()
        .from(portalCustomersTable)
        .where(
          portalIdentifierCondition(identifier.value, identifier.channel),
        )
        .limit(1);

      // ✅ رسالة موحّدة سواء الحساب موجود أو لأ — عشان محدش يقدر "يجرب" أرقام
      // عشوائية يعرف بيها مين عميل عندنا ومين لأ
      const genericMessage =
        "لو الحساب موجود، طلب استرجاع كلمة المرور وصل لفريقنا وهيتواصلوا معاك قريب";

      if (customer) {
        await db
          .insert(portalPasswordResetRequestsTable)
          .values({ portalCustomerId: customer.id });
        void notifyRoles(["hr", "hr_manager", "chairman"], {
          type: "portal_password_reset",
          title: "طلب استرجاع كلمة مرور — بوابة العملاء",
          body: `العميل "${customer.fullName}" (${customer.phone}) طلب استرجاع كلمة المرور`,
        }).catch((error) => {
          logger.error("Failed to notify portal password reset reviewers", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      res.json({ message: genericMessage });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   POST /portal/otp/request — طلب كود استرجاع تلقائي
   الرد موحّد عمدًا حتى لا يكشف وجود الحساب من عدمه.
============================================================ */
router.post(
  "/portal/otp/request",
  otpRequestRateLimiter,
  portalOtpNormalizedRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { identifier: rawIdentifier } = forgotPortalPasswordSchema.parse(
        req.body,
      );
      const normalizedIdentifier = normalizePortalIdentifier(rawIdentifier);
      const identifier = normalizedIdentifier.value;
      const channel = normalizedIdentifier.channel;
      const genericMessage =
        "لو الحساب موجود، هيوصلك كود استرجاع من 6 أرقام خلال دقائق";

      await db.transaction(async (tx: Transaction) => {
        // Lock the customer row so concurrent requests for the same account
        // cannot leave multiple active password-reset codes.
        const [customer] = await tx
          .select({
            id: portalCustomersTable.id,
            phone: portalCustomersTable.phone,
            email: portalCustomersTable.email,
          })
          .from(portalCustomersTable)
          .where(portalIdentifierCondition(identifier, channel))
          .for("update")
          .limit(1);

        if (!customer) return;

        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        const now = new Date();
        const expiresAt = new Date(
          now.getTime() + configuredOtpTtlMinutes * 60 * 1000,
        );
        const destination = channel === "email" ? customer.email : customer.phone;

          // A newly requested code supersedes older unused codes for this
          // customer and purpose, so only one active code can be accepted.
        await tx
          .update(portalOtpCodesTable)
          .set({ consumedAt: now })
          .where(
            and(
              eq(portalOtpCodesTable.portalCustomerId, customer.id),
              eq(portalOtpCodesTable.purpose, "password_reset"),
              isNull(portalOtpCodesTable.consumedAt),
              gt(portalOtpCodesTable.expiresAt, now),
            ),
          );

        const codeHash = await bcrypt.hash(code, 12);
        const [created] = await tx
          .insert(portalOtpCodesTable)
          .values({
            portalCustomerId: customer.id,
            channel,
            codeHash,
            purpose: "password_reset",
            expiresAt,
            attemptCount: 0,
          })
          .returning({ id: portalOtpCodesTable.id });

        if (!created) throw new Error("تعذر إنشاء كود الاسترجاع");

        await writeAuditEvent({
          executor: tx,
          actorName: "portal_customer_otp",
          actionKey: "portal.customer.password_reset_otp_requested",
          resourceType: "portal_customer",
          resourceId: customer.id,
          beforeData: null,
          afterData: {
            otpId: created.id,
            channel,
            expiresAt,
          },
          decision: "requested",
          reason: "طلب استرجاع كلمة المرور عبر OTP",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        // Never leave a usable OTP behind when delivery is unavailable. The
        // generic response remains unchanged to avoid account enumeration.
        const delivery = destination ?
            await sendOtpCode({ channel, destination, code })
          : { delivered: false };
        if (!delivery.delivered) {
          await tx
            .update(portalOtpCodesTable)
            .set({ consumedAt: now })
            .where(
              and(
                eq(portalOtpCodesTable.id, created.id),
                isNull(portalOtpCodesTable.consumedAt),
              ),
            );
        }
      });

      res.json({ message: genericMessage });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   POST /portal/otp/verify — التحقق من الكود وتغيير كلمة المرور ذريًا
============================================================ */
const verifyPortalOtpSchema = z.object({
  identifier: forgotPortalPasswordSchema.shape.identifier,
  code: z.string().regex(/^\d{6}$/, "الكود يجب أن يتكون من 6 أرقام"),
  newPassword: z.string().min(6, "كلمة المرور لازم تكون 6 أحرف على الأقل"),
});

router.post(
  "/portal/otp/verify",
  loginRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = verifyPortalOtpSchema.parse(req.body);
       const normalizedIdentifier = normalizePortalIdentifier(data.identifier);
       const identifier = normalizedIdentifier.value;
       const channel = normalizedIdentifier.channel;
      const now = new Date();

      const verification = await db.transaction(async (tx: Transaction) => {
        const [customer] = await tx
          .select({ id: portalCustomersTable.id })
          .from(portalCustomersTable)
          .where(portalIdentifierCondition(identifier, channel))
          .limit(1);

        if (!customer) {
          return {
            success: false as const,
            status: 400,
            code: "INVALID_OR_EXPIRED_OTP",
            message: "الكود غير صحيح أو انتهت صلاحيته",
          };
        }

        const [otp] = await tx
          .select()
          .from(portalOtpCodesTable)
          .where(
            and(
              eq(portalOtpCodesTable.portalCustomerId, customer.id),
              eq(portalOtpCodesTable.channel, channel),
              eq(portalOtpCodesTable.purpose, "password_reset"),
              isNull(portalOtpCodesTable.consumedAt),
            ),
          )
          .orderBy(desc(portalOtpCodesTable.createdAt))
          .for("update")
          .limit(1);

        if (!otp || otp.expiresAt <= now) {
          if (otp) {
            await tx
              .update(portalOtpCodesTable)
              .set({ consumedAt: now })
              .where(eq(portalOtpCodesTable.id, otp.id));
          }
          return {
            success: false as const,
            status: 400,
            code: "INVALID_OR_EXPIRED_OTP",
            message: "الكود غير صحيح أو انتهت صلاحيته",
          };
        }

        if (otp.attemptCount >= configuredOtpMaxAttempts) {
          await tx
            .update(portalOtpCodesTable)
            .set({ consumedAt: now })
            .where(eq(portalOtpCodesTable.id, otp.id));
          return {
            success: false as const,
            status: 429,
            code: "OTP_ATTEMPTS_EXCEEDED",
            message: "تم إبطال الكود بعد محاولات خاطئة كثيرة — اطلب كودًا جديدًا",
          };
        }

        const codeMatches = await bcrypt.compare(data.code, otp.codeHash);
        if (!codeMatches) {
          const attemptCount = otp.attemptCount + 1;
          if (attemptCount >= configuredOtpMaxAttempts) {
            await tx
              .update(portalOtpCodesTable)
              .set({ attemptCount, consumedAt: now })
              .where(eq(portalOtpCodesTable.id, otp.id));
            return {
              success: false as const,
              status: 429,
              code: "OTP_ATTEMPTS_EXCEEDED",
              message: `تم إبطال الكود بعد ${configuredOtpMaxAttempts} محاولات خاطئة — اطلب كودًا جديدًا`,
            };
          }
          await tx
            .update(portalOtpCodesTable)
            .set({ attemptCount })
            .where(eq(portalOtpCodesTable.id, otp.id));
          return {
            success: false as const,
            status: 400,
            code: "INVALID_OTP",
            message: `الكود غير صحيح — متبقي ${
              configuredOtpMaxAttempts - attemptCount
            } محاولات`,
          };
        }

        const passwordHash = await bcrypt.hash(data.newPassword, 12);
        const [updatedCustomer] = await tx
          .update(portalCustomersTable)
          .set({ passwordHash })
          .where(eq(portalCustomersTable.id, customer.id))
          .returning({ id: portalCustomersTable.id });
        if (!updatedCustomer) {
          throw Object.assign(new Error("حساب البوابة غير موجود"), {
            status: 404,
            code: "PORTAL_ACCOUNT_NOT_FOUND",
          });
        }

        await tx
          .update(portalOtpCodesTable)
          .set({ consumedAt: now })
          .where(
            and(
              eq(portalOtpCodesTable.id, otp.id),
              isNull(portalOtpCodesTable.consumedAt),
            ),
          );

        const [closedResetRequest] = await tx
          .update(portalPasswordResetRequestsTable)
          .set({
            status: "resolved",
            resolvedByName: "portal_customer_self_service",
            resolvedAt: now,
          })
          .where(
            and(
              eq(portalPasswordResetRequestsTable.portalCustomerId, customer.id),
              eq(portalPasswordResetRequestsTable.status, "pending"),
            ),
          )
          .returning({ id: portalPasswordResetRequestsTable.id });

        const revokedSessionCount = await revokeAllPortalSessions(
          customer.id,
          tx,
          now,
        );

        await writeAuditEvent({
          executor: tx,
          actorName: "portal_customer_otp",
          actionKey: "portal.customer.password_reset_otp_verified",
          resourceType: "portal_customer",
          resourceId: customer.id,
          beforeData: { otpId: otp.id, attemptCount: otp.attemptCount },
          afterData: {
            passwordChanged: true,
            otpConsumedAt: now,
            resetRequestClosed: Boolean(closedResetRequest),
            sessionsRevoked: revokedSessionCount,
          },
          decision: "password_reset",
          reason: "تغيير كلمة المرور بعد التحقق من OTP",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        return { success: true as const };
      });

      if (!verification.success) {
        res.status(verification.status).json({
          error: { code: verification.code, message: verification.message },
        });
        return;
      }

      res.json({ message: "تم تغيير كلمة المرور بنجاح، يمكنك تسجيل الدخول الآن" });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   Portal customer notifications — مستقلة تمامًا عن إشعارات الموظفين
============================================================ */
router.get(
  "/portal/notifications",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestedPage = Number(req.query.page ?? 1);
      const requestedLimit = Number(req.query.limit ?? 50);
      const page =
        Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      const limit =
        Number.isInteger(requestedLimit) && requestedLimit > 0
          ? Math.min(requestedLimit, 100)
          : 50;
      const offset = (page - 1) * limit;
      const notifications = await db
        .select()
        .from(portalNotificationsTable)
        .where(
          eq(
            portalNotificationsTable.portalCustomerId,
            getAuthenticatedPortalCustomerId(req),
          ),
        )
        .orderBy(desc(portalNotificationsTable.createdAt))
        .limit(limit)
        .offset(offset);
      res.json({
        data: notifications,
        pagination: { page, limit, hasMore: notifications.length === limit },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/portal/notifications/unread-count",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [result] = await db
        .select({ count: count() })
        .from(portalNotificationsTable)
        .where(
          and(
            eq(
              portalNotificationsTable.portalCustomerId,
              getAuthenticatedPortalCustomerId(req),
            ),
            eq(portalNotificationsTable.isRead, false),
          ),
        );
      res.json({ count: result?.count ?? 0 });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/portal/notifications/:id/read",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [updated] = await db
        .update(portalNotificationsTable)
        .set({ isRead: true })
        .where(
          and(
            eq(portalNotificationsTable.id, id),
            eq(
              portalNotificationsTable.portalCustomerId,
              getAuthenticatedPortalCustomerId(req),
            ),
          ),
        )
        .returning();
      if (!updated) {
        res.status(404).json({ error: { message: "الإشعار غير موجود" } });
        return;
      }
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   GET /portal/me — بيانات العميل الحالي (للتحقق من صلاحية الجلسة)
============================================================ */
router.get(
  "/portal/me",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [customer] = await db
        .select({
          portal: portalCustomersTable,
          contact: contactsTable,
        })
        .from(portalCustomersTable)
        .innerJoin(
          contactsTable,
          eq(portalCustomersTable.contactId, contactsTable.id),
        )
        .where(
          eq(portalCustomersTable.id, getAuthenticatedPortalCustomerId(req)),
        )
        .limit(1);
      if (!customer) {
        res.status(404).json({ error: { message: "الحساب غير موجود" } });
        return;
      }
      // ✅ إصلاح: الإيميل كان محفوظ في الحساب بالفعل لكن مش راجع في الرد —
      // العميل ملوش طريقة يشوف بياناته المسجلة كاملة
      res.json({
        id: customer.portal.id,
        fullName: customer.contact.name,
        phone: customer.contact.phone || customer.portal.phone,
        email: customer.contact.email || customer.portal.email,
        companyName: customer.contact.company || customer.portal.companyName,
        address: customer.contact.address,
          city: customer.contact.city || customer.portal.city,
      });
    } catch (err) {
      next(err);
    }
  },
);

function parsePortalSessionId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error("معرّف الجلسة غير صحيح"), {
      status: 400,
      code: "INVALID_SESSION_ID",
    });
  }
  return id;
}

/**
 * Session IPs are deliberately masked before leaving the API. The customer
 * can recognize a device/network without exposing a complete address in the
 * browser UI or an intercepted response.
 */
function maskPortalIpAddress(ipAddress: string | null): string | null {
  const ip = ipAddress?.trim();
  if (!ip) return null;
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return parts.length === 4
      ? `${parts[0]}.${parts[1]}.***.***`
      : `${parts[0]}.***`;
  }
  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean);
    return parts.length > 1 ? `${parts.slice(0, 2).join(":")}:…` : "…";
  }
  return "…";
}

/* ============================================================
   GET /portal/sessions — جلسات العميل النشطة فقط
============================================================ */
router.get(
  "/portal/sessions",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const now = new Date();
      const sessions = await db
        .select({
          id: portalSessionsTable.id,
          deviceLabel: portalSessionsTable.deviceLabel,
          ipAddress: portalSessionsTable.ipAddress,
          lastActiveAt: portalSessionsTable.lastActiveAt,
          expiresAt: portalSessionsTable.expiresAt,
          rememberMe: portalSessionsTable.rememberMe,
        })
        .from(portalSessionsTable)
        .where(
          and(
            eq(
              portalSessionsTable.portalCustomerId,
              getAuthenticatedPortalCustomerId(req),
            ),
            isNull(portalSessionsTable.revokedAt),
            gt(portalSessionsTable.expiresAt, now),
          ),
        )
        .orderBy(desc(portalSessionsTable.lastActiveAt));

      res.json(
        sessions.map((session) => ({
          id: session.id,
          deviceLabel: session.deviceLabel || "متصفح غير معروف",
          ipAddress: maskPortalIpAddress(session.ipAddress),
          lastActiveAt: session.lastActiveAt,
          expiresAt: session.expiresAt,
          rememberMe: session.rememberMe,
          current: session.id === req.portalCustomer!.sessionId,
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   DELETE /portal/sessions/:id — إلغاء جلسة واحدة فورًا
============================================================ */
router.delete(
  "/portal/sessions/:id",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = parsePortalSessionId(String(req.params.id));
      const revokedAt = new Date();
      await db.transaction(async (tx) => {
        const [revoked] = await tx
          .update(portalSessionsTable)
          .set({ revokedAt })
          .where(
            and(
              eq(portalSessionsTable.id, sessionId),
              eq(
                portalSessionsTable.portalCustomerId,
                getAuthenticatedPortalCustomerId(req),
              ),
              isNull(portalSessionsTable.revokedAt),
            ),
          )
          .returning({
            id: portalSessionsTable.id,
            portalCustomerId: portalSessionsTable.portalCustomerId,
          });
        if (!revoked) {
          throw Object.assign(new Error("جلسة الدخول غير موجودة"), {
            status: 404,
            code: "PORTAL_SESSION_NOT_FOUND",
          });
        }

        await writeAuditEvent({
          executor: tx,
          actorName: "portal_customer",
          actionKey: "portal.session.revoked",
          resourceType: "portal_session",
          resourceId: sessionId,
          beforeData: { portalCustomerId: revoked.portalCustomerId },
          afterData: { revokedAt },
          decision: "revoked",
          reason: "إلغاء جلسة دخول من لوحة العميل",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
      });

      res.json({ message: "تم إلغاء جلسة الدخول فورًا" });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   POST /portal/sessions/revoke-others — إلغاء كل الجلسات الأخرى
============================================================ */
router.post(
  "/portal/sessions/revoke-others",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentSessionId = req.portalCustomer!.sessionId;
      const revokedAt = new Date();
      const revokedCount = await db.transaction(async (tx) => {
        const revoked = await tx
          .update(portalSessionsTable)
          .set({ revokedAt })
          .where(
            and(
              eq(
                portalSessionsTable.portalCustomerId,
                getAuthenticatedPortalCustomerId(req),
              ),
              ne(portalSessionsTable.id, currentSessionId),
              isNull(portalSessionsTable.revokedAt),
            ),
          )
          .returning({ id: portalSessionsTable.id });

        await writeAuditEvent({
          executor: tx,
          actorName: "portal_customer",
          actionKey: "portal.sessions.other_sessions_revoked",
          resourceType: "portal_customer",
          resourceId: getAuthenticatedPortalCustomerId(req),
          beforeData: { currentSessionId },
          afterData: { revokedAt, revokedCount: revoked.length },
          decision: "revoked_others",
          reason: "تسجيل الخروج من كل الأجهزة الأخرى",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        return revoked.length;
      });

      res.json({
        message: "تم تسجيل الخروج من كل الأجهزة الأخرى",
        revokedCount,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/portal/config", (_req: Request, res: Response) => {
  res.json({
    minimumOrderQuantity: configuredMinimumOrderQuantity,
    supportPhone: process.env.PORTAL_SUPPORT_PHONE?.trim() || "",
  });
});

/* ============================================================
   POST /portal/activate — استهلاك رابط التفعيل لمرة واحدة
   التوكن الخام لا يُحفظ ولا يُعاد في أي استجابة؛ يُحوّل إلى SHA-256
   ويُستهلك داخل transaction مع تغيير كلمة المرور وتسجيل التدقيق.
============================================================ */
const portalActivationSchema = z
  .object({
    token: z.string().trim().min(20).max(200),
    password: z.string().min(6, "كلمة المرور لازم تكون 6 أحرف على الأقل"),
    confirmPassword: z.string().min(6, "تأكيد كلمة المرور مطلوب"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "تأكيد كلمة المرور غير مطابق",
  });

router.post(
  "/portal/activate",
  loginRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = portalActivationSchema.parse(req.body);
      const tokenHash = createHash("sha256").update(data.token).digest("hex");
      const now = new Date();
      const customer = await db.transaction(async (tx) => {
        const [activation] = await tx
          .select({
            id: portalActivationTokensTable.id,
            portalCustomerId: portalActivationTokensTable.portalCustomerId,
            expiresAt: portalActivationTokensTable.expiresAt,
            consumedAt: portalActivationTokensTable.consumedAt,
          })
          .from(portalActivationTokensTable)
          .where(eq(portalActivationTokensTable.tokenHash, tokenHash))
          .for("update")
          .limit(1);

        if (!activation) {
          throw Object.assign(new Error("رابط التفعيل غير صحيح أو منتهي"), {
            status: 400,
            code: "INVALID_ACTIVATION_TOKEN",
          });
        }
        if (activation.consumedAt) {
          throw Object.assign(new Error("تم استخدام رابط التفعيل من قبل"), {
            status: 409,
            code: "ACTIVATION_TOKEN_ALREADY_USED",
          });
        }
        if (activation.expiresAt <= now) {
          throw Object.assign(new Error("انتهت صلاحية رابط التفعيل"), {
            status: 410,
            code: "ACTIVATION_TOKEN_EXPIRED",
          });
        }

        const passwordHash = await bcrypt.hash(data.password, 12);
        const [updatedCustomer] = await tx
          .update(portalCustomersTable)
          .set({ passwordHash })
          .where(eq(portalCustomersTable.id, activation.portalCustomerId))
          .returning({
            id: portalCustomersTable.id,
            fullName: portalCustomersTable.fullName,
            phone: portalCustomersTable.phone,
            email: portalCustomersTable.email,
          });
        if (!updatedCustomer) {
          throw Object.assign(new Error("حساب البوابة غير موجود"), {
            status: 404,
            code: "PORTAL_ACCOUNT_NOT_FOUND",
          });
        }

        const [consumed] = await tx
          .update(portalActivationTokensTable)
          .set({ consumedAt: now })
          .where(
            and(
              eq(portalActivationTokensTable.id, activation.id),
              isNull(portalActivationTokensTable.consumedAt),
            ),
          )
          .returning({ id: portalActivationTokensTable.id });
        if (!consumed) {
          throw Object.assign(new Error("تم استخدام رابط التفعيل من قبل"), {
            status: 409,
            code: "ACTIVATION_TOKEN_ALREADY_USED",
          });
        }

        await writeAuditEvent({
          executor: tx,
          actorName: "portal_customer_activation",
          actionKey: "portal.customer.password_activated",
          resourceType: "portal_customer",
          resourceId: updatedCustomer.id,
          beforeData: {
            activationTokenId: activation.id,
            activationExpiresAt: activation.expiresAt,
          },
          afterData: { activationTokenConsumedAt: now },
          decision: "activated",
          reason: "تفعيل حساب العميل عبر رابط التفعيل",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        return updatedCustomer;
      });

      res.json({
        message: "تم تفعيل حسابك بنجاح",
        customer: {
          id: customer.id,
          fullName: customer.fullName,
          phone: customer.phone,
          email: customer.email,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);
const updatePortalProfileSchema = z.object({
  currentPassword: z.string().min(1, "كلمة المرور الحالية مطلوبة"),
  fullName: z.string().min(2, "الاسم مطلوب (حرفين على الأقل)"),
  phone: z.string().min(8, "رقم هاتف غير صحيح"),
  email: z.string().email("بريد إلكتروني غير صحيح").optional().nullable(),
  companyName: z.string().min(2, "اسم الشركة مطلوب"),
  address: z.string().max(500, "العنوان طويل جدًا").optional().nullable(),
  city: z.string().max(80, "اسم المحافظة طويل جدًا").optional().nullable(),
});
router.patch(
  "/portal/me",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = updatePortalProfileSchema.parse(req.body);
      const normalizedPhone = normalizePhone(data.phone);
      const normalizedEmail = normalizeEmail(data.email);
      const normalizedCompanyName = normalizeCompanyName(data.companyName);
      if (!normalizedPhone) {
        res.status(400).json({ error: { message: "رقم هاتف غير صحيح" } });
        return;
      }
      const [existing] = await db
        .select()
        .from(portalCustomersTable)
        .where(
          eq(portalCustomersTable.id, getAuthenticatedPortalCustomerId(req)),
        )
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "الحساب غير موجود" } });
        return;
      }
      if (
        !(await bcrypt.compare(data.currentPassword, existing.passwordHash))
      ) {
        res
          .status(401)
          .json({ error: { message: "كلمة المرور الحالية غير صحيحة" } });
        return;
      }
      if (normalizedPhone !== existing.normalizedPhone) {
        const [phoneTaken] = await db
          .select({ id: portalCustomersTable.id })
          .from(portalCustomersTable)
          .where(
            and(
              eq(portalCustomersTable.normalizedPhone, normalizedPhone),
              ne(portalCustomersTable.id, existing.id),
            ),
          )
          .limit(1);
        if (phoneTaken) {
          res
            .status(409)
            .json({ error: { message: "رقم الهاتف مستخدم بالفعل" } });
          return;
        }
      }
      const existingNormalizedEmail =
        existing.normalizedEmail ?? normalizeEmail(existing.email);
      if (normalizedEmail && normalizedEmail !== existingNormalizedEmail) {
        const [emailTaken] = await db
          .select({ id: portalCustomersTable.id })
          .from(portalCustomersTable)
          .where(
            and(
              eq(portalCustomersTable.normalizedEmail, normalizedEmail),
              ne(portalCustomersTable.id, existing.id),
            ),
          )
          .limit(1);
        if (emailTaken) {
          res
            .status(409)
            .json({ error: { message: "البريد الإلكتروني مستخدم بالفعل" } });
          return;
        }
      }
      const updated = await db.transaction(async (tx) => {
        const [portal] = await tx
          .update(portalCustomersTable)
          .set({
            fullName: data.fullName,
            phone: data.phone.trim(),
            normalizedPhone,
            email: normalizeOptionalText(data.email),
            normalizedEmail: normalizedEmail || null,
            companyName: data.companyName,
            normalizedCompanyName,
            city: data.city ?? null,
          })
          .where(eq(portalCustomersTable.id, existing.id))
          .returning();
        await tx
          .update(contactsTable)
          .set({
            name: data.fullName,
            phone: data.phone.trim(),
            email: normalizeOptionalText(data.email),
            company: data.companyName.trim(),
            address: data.address ?? null,
            city: data.city ?? null,
            updatedAt: new Date(),
          })
          .where(eq(contactsTable.id, existing.contactId));
        return portal;
      });
      res.json({
        id: updated.id,
        fullName: data.fullName,
        phone: data.phone,
        email: data.email ?? null,
        companyName: data.companyName,
        address: data.address ?? null,
        city: data.city ?? null,
      });
    } catch (err) {
      next(err);
    }
  },
);

const portalCartMutationSchema = z.object({
  bomRecipeId: z.number().int().positive(),
  qty: z.coerce.number().int().min(1, "الكمية يجب أن تكون رقمًا صحيحًا موجبًا"),
  mode: z.enum(["add", "set"]).default("add"),
});
const portalRecipeParam = z.coerce.number().int().positive();

/* ============================================================
   Cart + wishlist — ملكية العميل مشتقة من التوكن فقط
============================================================ */
router.get(
  "/portal/cart",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await db
        .select({
          id: portalCartItemsTable.id,
          recipeId: portalCartItemsTable.bomRecipeId,
          productName: bomRecipesTable.productName,
          productCode: bomRecipesTable.productCode,
          qty: portalCartItemsTable.qty,
          available: bomRecipesTable.isActive,
          createdAt: portalCartItemsTable.createdAt,
          updatedAt: portalCartItemsTable.updatedAt,
        })
        .from(portalCartItemsTable)
        .innerJoin(
          bomRecipesTable,
          eq(portalCartItemsTable.bomRecipeId, bomRecipesTable.id),
        )
        .where(
          eq(
            portalCartItemsTable.portalCustomerId,
            getAuthenticatedPortalCustomerId(req),
          ),
        )
        .orderBy(portalCartItemsTable.createdAt);
      res.json(items);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/portal/cart",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = portalCartMutationSchema.parse(req.body);
      const customerId = getAuthenticatedPortalCustomerId(req);
      const result = await db.transaction(async (tx) => {
        const [customer] = await tx
          .select({ minimumOrderQuantity: portalCustomersTable.minimumOrderQuantity })
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.id, customerId))
          .limit(1);
        if (!customer) {
          throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
        }

        const [recipe] = await tx
          .select({
            id: bomRecipesTable.id,
            productName: bomRecipesTable.productName,
            productCode: bomRecipesTable.productCode,
            isActive: bomRecipesTable.isActive,
          })
          .from(bomRecipesTable)
          .where(eq(bomRecipesTable.id, data.bomRecipeId))
          .limit(1);
        if (!recipe?.isActive) {
          throw Object.assign(new Error("المنتج غير موجود في الكتالوج الحالي"), {
            status: 404,
          });
        }

        const [existing] = await tx
          .select({ qty: portalCartItemsTable.qty })
          .from(portalCartItemsTable)
          .where(
            and(
              eq(portalCartItemsTable.portalCustomerId, customerId),
              eq(portalCartItemsTable.bomRecipeId, data.bomRecipeId),
            ),
          )
          .limit(1);
        const minimum = Math.max(
          configuredMinimumOrderQuantity,
          customer.minimumOrderQuantity,
        );
        const nextQty =
          data.mode === "add" ?
            Number(existing?.qty || 0) + data.qty
          : data.qty;
        if (!Number.isFinite(nextQty) || nextQty < minimum) {
          throw Object.assign(
            new Error(`الحد الأدنى للكمية هو ${minimum} قطعة لكل منتج`),
            { status: 400 },
          );
        }

        const [saved] = await tx
          .insert(portalCartItemsTable)
          .values({
            portalCustomerId: customerId,
            bomRecipeId: recipe.id,
            qty: String(nextQty),
          })
          .onConflictDoUpdate({
            target: [
              portalCartItemsTable.portalCustomerId,
              portalCartItemsTable.bomRecipeId,
            ],
            set: { qty: String(nextQty), updatedAt: new Date() },
          })
          .returning({
            id: portalCartItemsTable.id,
            qty: portalCartItemsTable.qty,
            recipeId: portalCartItemsTable.bomRecipeId,
          });
        return { ...saved, ...recipe };
      });
      res.json(result);
    } catch (err: any) {
      if (err?.status) {
        res.status(err.status).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  },
);

router.delete(
  "/portal/cart/:bomRecipeId",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bomRecipeId = portalRecipeParam.parse(req.params.bomRecipeId);
      await db
        .delete(portalCartItemsTable)
        .where(
          and(
            eq(
              portalCartItemsTable.portalCustomerId,
              getAuthenticatedPortalCustomerId(req),
            ),
            eq(portalCartItemsTable.bomRecipeId, bomRecipeId),
          ),
        );
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/portal/wishlist",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await db
        .select({
          id: portalWishlistItemsTable.id,
          recipeId: portalWishlistItemsTable.bomRecipeId,
          productName: bomRecipesTable.productName,
          productCode: bomRecipesTable.productCode,
          description: bomRecipesTable.description,
          available: bomRecipesTable.isActive,
          createdAt: portalWishlistItemsTable.createdAt,
        })
        .from(portalWishlistItemsTable)
        .innerJoin(
          bomRecipesTable,
          eq(portalWishlistItemsTable.bomRecipeId, bomRecipesTable.id),
        )
        .where(
          eq(
            portalWishlistItemsTable.portalCustomerId,
            getAuthenticatedPortalCustomerId(req),
          ),
        )
        .orderBy(desc(portalWishlistItemsTable.createdAt));
      res.json(items);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/portal/wishlist",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bomRecipeId = portalRecipeParam.parse(req.body?.bomRecipeId);
      const customerId = getAuthenticatedPortalCustomerId(req);
      const [recipe] = await db
        .select({
          id: bomRecipesTable.id,
          productName: bomRecipesTable.productName,
          productCode: bomRecipesTable.productCode,
        })
        .from(bomRecipesTable)
        .where(
          and(
            eq(bomRecipesTable.id, bomRecipeId),
            eq(bomRecipesTable.isActive, true),
          ),
        )
        .limit(1);
      if (!recipe) {
        res
          .status(404)
          .json({ error: { message: "المنتج غير موجود في الكتالوج الحالي" } });
        return;
      }
      const [saved] = await db
        .insert(portalWishlistItemsTable)
        .values({ portalCustomerId: customerId, bomRecipeId })
        .onConflictDoNothing({
          target: [
            portalWishlistItemsTable.portalCustomerId,
            portalWishlistItemsTable.bomRecipeId,
          ],
        })
        .returning({ id: portalWishlistItemsTable.id });
      res.status(201).json({
        id: saved?.id || null,
        recipeId: recipe.id,
        productName: recipe.productName,
        productCode: recipe.productCode,
        active: true,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/portal/wishlist/:bomRecipeId",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bomRecipeId = portalRecipeParam.parse(req.params.bomRecipeId);
      await db
        .delete(portalWishlistItemsTable)
        .where(
          and(
            eq(
              portalWishlistItemsTable.portalCustomerId,
              getAuthenticatedPortalCustomerId(req),
            ),
            eq(portalWishlistItemsTable.bomRecipeId, bomRecipeId),
          ),
        );
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   GET /portal/my-orders — تتبع حقيقي لطلبات العميل
   بنجمّع أوامر الإنتاج الحقيقية بتاعة العميل حسب الإرسالية (batchRef)،
   وبنرجّع workflowStatus الحالي مباشرة من أمر الإنتاج.
============================================================ */
router.get(
  "/portal/my-orders",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getAuthenticatedPortalCustomerId(req);
      const requestedPage = Number(req.query.page ?? 1);
      const requestedLimit = Number(req.query.limit ?? 20);
      const page =
        Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      const limit =
        Number.isInteger(requestedLimit) && requestedLimit > 0
          ? Math.min(requestedLimit, 50)
          : 20;
      const offset = (page - 1) * limit;
      const rawOrders = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(eq(productionWorkflowOrdersTable.portalCustomerId, customerId))
        .orderBy(desc(productionWorkflowOrdersTable.createdAt))
        .limit(limit)
        .offset(offset);
      const recipeIds = [
        ...new Set(
          rawOrders.flatMap((order) =>
            order.bomRecipeId ? [order.bomRecipeId] : [],
          ),
        ),
      ];
      const recipeCodes = recipeIds.length
        ? await db
            .select({
              id: bomRecipesTable.id,
              productCode: bomRecipesTable.productCode,
            })
            .from(bomRecipesTable)
            .where(inArray(bomRecipesTable.id, recipeIds))
        : [];
      const productCodeByRecipe = new Map(
        recipeCodes.map((recipe) => [recipe.id, recipe.productCode]),
      );
      const orders = rawOrders.map((order) => ({
        ...order,
        productCode: order.bomRecipeId
          ? productCodeByRecipe.get(order.bomRecipeId) || null
          : null,
      }));

      // تجميع الأصناف حسب مرجع الإرسالة الواحدة (batchRef) — نفس المنطق
      // المستخدم في صفحة مراجعة الطلبات عند الموظف (portal-orders.ts)
      const batchesMap = new Map<
        string,
        { batchRef: string; createdAt: Date; items: typeof orders }
      >();
      for (const o of orders) {
        const ref = o.salesOrderRef || o.orderNumber;
        if (!batchesMap.has(ref))
          batchesMap.set(ref, {
            batchRef: ref,
            createdAt: o.createdAt,
            items: [],
          });
        batchesMap.get(ref)!.items.push(o);
      }

      const batchRefs = [...batchesMap.keys()];
      const reviews =
        batchRefs.length ?
          await db
            .select()
            .from(portalOrderReviewsTable)
            .where(inArray(portalOrderReviewsTable.batchRef, batchRefs))
        : [];
      const reviewByBatch = new Map(reviews.map((r) => [r.batchRef, r]));
      const data = [...batchesMap.values()]
        .map((b) => ({
          batchRef: b.batchRef,
          createdAt: b.createdAt,
          items: b.items.map((item) => {
            const review = reviewByBatch.get(b.batchRef);
            const rejection =
              item.workflowStatus === "cancelled" ?
                {
                  type: "cancelled",
                  reason: item.notes || null,
                }
              : item.workflowStatus === "materials_rejected" ?
                {
                  type: "materials_rejected",
                  reason: item.warehouseComment || null,
                }
              : review?.status === "rejected" ?
                {
                  type: "review_rejected",
                  reason: review.rejectReason || review.replyMessage || null,
                }
              : null;
            return {
              ...toPortalOrderItem(item),
              bomRecipeId: item.bomRecipeId,
              productCode: item.productCode,
              timeline: buildPortalTimeline(item, review),
              rejection,
            };
          }),
          review:
            reviewByBatch.get(b.batchRef) ?
              {
                status: reviewByBatch.get(b.batchRef)!.status,
                replyMessage: reviewByBatch.get(b.batchRef)!.replyMessage,
                rejectReason: reviewByBatch.get(b.batchRef)!.rejectReason,
                expectedDelivery:
                  reviewByBatch.get(b.batchRef)!.expectedDelivery,
                createdAt: reviewByBatch.get(b.batchRef)!.createdAt,
              }
            : null,
        }))
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

      res.json({
        data,
        pagination: {
          page,
          limit,
          hasMore: rawOrders.length === limit,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   GET /portal/products — كتالوج المنتجات (عام، من غير تسجيل دخول)
   بيسحب من وصفات التصنيع الحقيقية — أي منتج يتضاف في bom.html يظهر هنا تلقائي
============================================================ */
router.get(
  "/portal/products",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const recipes = await db
        .select({
          id: bomRecipesTable.id,
          productCode: bomRecipesTable.productCode,
          productName: bomRecipesTable.productName,
          description: bomRecipesTable.description,
          isActive: bomRecipesTable.isActive,
          orderCount: sql<number>`count(${productionWorkflowOrdersTable.id})::int`,
        })
        .from(bomRecipesTable)
        .leftJoin(
          productionWorkflowOrdersTable,
          eq(
            productionWorkflowOrdersTable.bomRecipeId,
            bomRecipesTable.id,
          ),
        )
        .where(eq(bomRecipesTable.isActive, true))
        .groupBy(
          bomRecipesTable.id,
          bomRecipesTable.productCode,
          bomRecipesTable.productName,
          bomRecipesTable.description,
          bomRecipesTable.isActive,
        )
        .orderBy(bomRecipesTable.productName);
      res.json(recipes);
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   GET /portal/products/:id — تفاصيل منتج واحد (لما العميل يدوس على الاسم)
============================================================ */
router.get(
  "/portal/products/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!id) {
        res.status(400).json({ error: { message: "منتج غير صحيح" } } as any);
        return;
      }

      const [recipe] = await db
        .select()
        .from(bomRecipesTable)
        .where(
          and(eq(bomRecipesTable.id, id), eq(bomRecipesTable.isActive, true)),
        )
        .limit(1);
      if (!recipe) {
        res.status(404).json({ error: { message: "المنتج غير موجود" } });
        return;
      }

      const items = await db
        .select()
        .from(bomRecipeItemsTable)
        .where(eq(bomRecipeItemsTable.recipeId, id));
      res.json({
        id: recipe.id,
        productCode: recipe.productCode,
        productName: recipe.productName,
         description: recipe.description,
        componentsCount: items.length,
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   POST /portal/orders — إرسال طلب (ممكن أكتر من منتج في نفس الإرسالة)
   كل منتج بيتحول لأمر إنتاج مستقل بالحالة "new"، وكل الأوامر دي بتتشارك
   نفس "مرجع الإرسالة" (batchRef) عشان الاتش آر يشوفهم مجمّعين مع بعض.
============================================================ */
export const submitOrderSchema = z.object({
  items: z
    .array(
      z.object({
        bomRecipeId: z.number().int().positive(),
        qty: z
          .string()
          .regex(/^(?=.*[1-9])[0-9]{1,6}(?:\.[0-9]{1,3})?$/),
        unit: z.string().optional().default("قطعة"),
      }),
    )
    .min(1, "لازم تختار منتج واحد على الأقل")
    .max(50, "لا يمكن إرسال أكثر من 50 منتجًا في الطلب الواحد"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  notes: z.string().max(1000).optional().nullable(),
  idempotencyKey: z.string().min(8).max(150),
});

router.post(
  "/portal/orders",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = submitOrderSchema.parse(req.body);
      const [customer] = await db
        .select()
        .from(portalCustomersTable)
        .where(
          eq(portalCustomersTable.id, getAuthenticatedPortalCustomerId(req)),
        )
        .limit(1);
      if (!customer) {
        res.status(404).json({ error: { message: "الحساب غير موجود" } });
        return;
      }
      for (const item of data.items) {
        const quantity = Number(item.qty);
        if (
          !Number.isFinite(quantity) ||
          quantity < Math.max(
            configuredMinimumOrderQuantity,
            customer.minimumOrderQuantity,
          )
        ) {
          res.status(400).json({
            error: {
              message: `الحد الأدنى للكمية هو ${Math.max(
                configuredMinimumOrderQuantity,
                customer.minimumOrderQuantity,
              )} قطعة لكل منتج`,
            },
          });
          return;
        }
      }
      // batchRef بسيط لتجميع منتجات نفس الإرسالة بصريًا عند الاتش آر
      const batchRef = `PORTAL-${Date.now().toString(36).toUpperCase()}`;

      const createdOrders = await db.transaction(async (tx: Transaction) => {
        const results = [];
        for (const item of data.items) {
          const [recipe] = await tx
            .select()
            .from(bomRecipesTable)
            .where(
              and(
                eq(bomRecipesTable.id, item.bomRecipeId),
                eq(bomRecipesTable.isActive, true),
              ),
            )
            .limit(1);
          if (!recipe) {
            throw Object.assign(
              new Error(
                `أحد المنتجات المختارة غير موجود (رقم ${item.bomRecipeId})`,
              ),
              { status: 400 },
            );
          }
          const orderNumber = await generateWorkflowOrderNumber(tx);
          const [inserted] = await tx
            .insert(productionWorkflowOrdersTable)
            .values({
              orderNumber,
              workflowStatus: "new",
              productName: recipe.productName,
              qty: item.qty,
              unit: item.unit,
              bomRecipeId: item.bomRecipeId,
              customerName:
                customer.companyName ?
                  `${customer.fullName} — ${customer.companyName}`
                : customer.fullName,
              customerPhone: customer.phone,
              orderSource: "website",
              salesOrderRef: batchRef,
               portalCustomerId: customer.id,
              priority: data.priority,
              notes: data.notes ?? null,
              // ✅ عميل البوابة مش موظف، فمفيش له userId حقيقي في نظام الموظفين —
              // بنسجّل رقمه هو نفسه هنا (namespace مختلف عن system_users، مرجعي بس)
              createdById: customer.id,
              createdByName: `${customer.fullName} (عبر بوابة العملاء)`,
            })
            .returning();
          results.push(inserted);
        }
        return results;
      });

      const totalItems = createdOrders.length;
      await notifyRole("hr", {
        type: "portal_order_received",
        title: `طلب جديد من بوابة العملاء — ${customer.fullName}`,
        body: `${customer.fullName}${customer.companyName ? " (" + customer.companyName + ")" : ""} بعت طلب فيه ${totalItems} ${totalItems === 1 ? "منتج" : "منتجات"}. الأولوية: ${priorityLabel(data.priority)}.`,
        referenceType: "production_workflow",
        referenceId: createdOrders[0].id,
      });
      await notifyRole("chairman", {
        type: "portal_order_received",
        title: `طلب جديد من بوابة العملاء — ${customer.fullName}`,
        body: `${customer.fullName}${customer.companyName ? " (" + customer.companyName + ")" : ""} بعت طلب فيه ${totalItems} ${totalItems === 1 ? "منتج" : "منتجات"}.`,
        referenceType: "production_workflow",
        referenceId: createdOrders[0].id,
      });

      res.status(201).json({
        message: "تم إرسال طلبك بنجاح، وهيتم التواصل معك قريبًا",
        orders: createdOrders,
        batchRef,
      });
    } catch (err: any) {
      if (err?.status) {
        res.status(err.status).json({ error: { message: err.message } } as any);
        return;
      }
      next(err);
    }
  },
);

export default router;
