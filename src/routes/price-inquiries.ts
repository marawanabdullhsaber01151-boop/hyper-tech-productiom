/** @format */
/**
 * Phase 6 (Governance & Portal project) — "اطلب سعر" (ask-before-you-order).
 *
 * Customer picks a product + quantity and asks sales for a price WITHOUT
 * committing to an order. Sales answers with a price — defaulting to the
 * product's snapshotted reference price if they send without changing it,
 * or their own typed value if they override it. Answering never creates an
 * order or touches inventory; placing a real order stays a fully separate,
 * deliberate action (see POST /portal/orders in src/routes/portal.ts).
 *
 * Performance: see the notes at the top of
 * src/db/schema/portal-price-inquiries.ts — denormalized fields, a
 * snapshotted price, indexes matching this codebase's existing patterns, and
 * no new client-side polling loop (answers surface through the portal
 * notification system the customer already polls).
 */
import { Router, Request, Response, NextFunction } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import {
  portalPriceInquiriesTable,
  createPriceInquirySchema,
  answerPriceInquirySchema,
  bomRecipesTable,
  foundationItemsTable,
  foundationUnitConversionsTable,
  portalCustomersTable,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePortalAuth, getAuthenticatedPortalCustomerId } from "../middleware/portal-auth";
import { PERMISSIONS } from "../lib/permissions";
import { notifyRoles } from "../lib/notifications";
import { notifyPortalCustomer } from "../lib/portalNotifications";
import { resolveFinalPrice } from "../lib/priceInquiry";
import { getAssignedSalesByCustomerId } from "../lib/salesAssignment";

const router = Router();

/* ============================================================
   POST /portal/price-inquiries — العميل بيطلب سعر منتج وكمية معيّنة
============================================================ */
router.post(
  "/portal/price-inquiries",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createPriceInquirySchema.parse(req.body);
      const portalCustomerId = getAuthenticatedPortalCustomerId(req);

      const [customer] = await db
        .select()
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, portalCustomerId))
        .limit(1);
      if (!customer) {
        res.status(404).json({ error: { message: "الحساب غير موجود" } });
        return;
      }

      const [recipe] = await db
        .select()
        .from(bomRecipesTable)
        .where(
          and(
            eq(bomRecipesTable.id, data.bomRecipeId),
            eq(bomRecipesTable.isActive, true),
          ),
        )
        .limit(1);
      if (!recipe) {
        res.status(404).json({ error: { message: "المنتج غير موجود" } });
        return;
      }

      // Phase 5 canonicalization rule reused: a carton-entered quantity is
      // converted to pieces server-side, never trusting a client-computed
      // piece count. Same lookup shape as POST /portal/orders.
      let requestedQty = data.qty;
      if (data.orderUnit === "carton") {
        if (!recipe.foundationItemId) {
          res.status(400).json({
            error: { message: "المنتج ده مش متاح للطلب بالكرتونة — اطلبه بالقطعة" },
          });
          return;
        }
        const [foundationItem] = await db
          .select()
          .from(foundationItemsTable)
          .where(eq(foundationItemsTable.id, recipe.foundationItemId))
          .limit(1);
        const [conversion] = await db
          .select()
          .from(foundationUnitConversionsTable)
          .where(
            and(
              eq(foundationUnitConversionsTable.itemId, recipe.foundationItemId),
              eq(foundationUnitConversionsTable.toUnit, foundationItem?.baseUnit ?? ""),
            ),
          )
          .limit(1);
        const factor = conversion ? Number(conversion.factor) : 0;
        if (!conversion || !Number.isInteger(factor) || factor <= 1) {
          res.status(400).json({
            error: { message: "المنتج ده مش متاح للطلب بالكرتونة — اطلبه بالقطعة" },
          });
          return;
        }
        requestedQty = String(Number(data.qty) * factor);
      }

      const [created] = await db
        .insert(portalPriceInquiriesTable)
        .values({
          portalCustomerId,
          bomRecipeId: recipe.id,
          productName: recipe.productName,
          customerName: customer.companyName
            ? `${customer.fullName} — ${customer.companyName}`
            : customer.fullName,
          customerCompany: customer.companyName,
          customerPhone: customer.phone,
          requestedQty,
          requestedUnit: "piece",
          suggestedPrice: recipe.referencePrice,
          status: "pending",
        })
        .returning();

      // موظفو المبيعات بيتنبهوا بطلب سعر جديد، بنفس آلية الإشعارات
      // الموجودة أصلًا — مفيش أي polling جديد اتضاف عشان الميزة دي.
      await notifyRoles([...PERMISSIONS.sales.write], {
        type: "portal_price_inquiry_new",
        title: "طلب سعر جديد من عميل",
        body: `العميل "${created.customerName}" طالب سعر لـ "${created.productName}" بكمية ${created.requestedQty} قطعة.`,
        referenceType: "portal_price_inquiry",
        referenceId: created.id,
      });

      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   GET /portal/price-inquiries — طلبات السعر بتاعت العميل نفسه بس
============================================================ */
router.get(
  "/portal/price-inquiries",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const portalCustomerId = getAuthenticatedPortalCustomerId(req);
      const inquiries = await db
        .select()
        .from(portalPriceInquiriesTable)
        .where(eq(portalPriceInquiriesTable.portalCustomerId, portalCustomerId))
        .orderBy(desc(portalPriceInquiriesTable.createdAt))
        .limit(50);
      res.json(inquiries);
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   GET /price-inquiries/pending — قايمة طلبات الأسعار المستنية ردّ (للمبيعات)
============================================================ */
router.get(
  "/price-inquiries/pending",
  requireAuth,
  requireRole(...PERMISSIONS.sales.view),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      // ✅ أداء: كل بيانات الصف (اسم العميل/المنتج) متخزنة في نفس الجدول
      // (denormalized وقت الطلب) فمحتجناش أي join هنا خالص.
      const inquiries = await db
        .select()
        .from(portalPriceInquiriesTable)
        .where(eq(portalPriceInquiriesTable.status, "pending"))
        .orderBy(desc(portalPriceInquiriesTable.createdAt))
        .limit(100);

      // Phase 7: اسم مسؤول المبيعات لكل عميل — استعلام إضافي واحد بس،
      // بنفس الطريقة المستخدمة في GET /portal-orders/pending.
      const assignedByCustomer = await getAssignedSalesByCustomerId(
        inquiries.map((i) => i.portalCustomerId),
      );
      const withAssignment = inquiries.map((i) => ({
        ...i,
        assignedSales: assignedByCustomer.get(i.portalCustomerId) ?? null,
      }));
      res.json(withAssignment);
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   POST /price-inquiries/:id/answer — المبيعات بترد بسعر (مقترح أو معدّل)
============================================================ */
router.post(
  "/price-inquiries/:id/answer",
  requireAuth,
  requireRole(...PERMISSIONS.sales.write),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!id) {
        res.status(400).json({ error: { message: "رقم الطلب غير صحيح" } });
        return;
      }
      const data = answerPriceInquirySchema.parse(req.body);

      const [inquiry] = await db
        .select()
        .from(portalPriceInquiriesTable)
        .where(eq(portalPriceInquiriesTable.id, id))
        .limit(1);
      if (!inquiry) {
        res.status(404).json({ error: { message: "طلب السعر غير موجود" } });
        return;
      }
      if (inquiry.status !== "pending") {
        res.status(409).json({ error: { message: "طلب السعر ده اتردّ عليه بالفعل" } });
        return;
      }

      const finalPrice = resolveFinalPrice(
        inquiry.suggestedPrice,
        data.finalPrice,
      );
      if (finalPrice === null) {
        res.status(400).json({
          error: {
            message: "مفيش سعر مقترح لهذا المنتج — لازم تكتب سعر بنفسك",
          },
        });
        return;
      }

      const [updated] = await db
        .update(portalPriceInquiriesTable)
        .set({
          finalPrice,
          status: "answered",
          answeredByUserId: req.user!.userId,
          answeredByName: req.user!.username,
          answeredAt: new Date(),
        })
        .where(eq(portalPriceInquiriesTable.id, id))
        .returning();

      // ردّ بصيغة سؤال/جواب واضحة للعميل، بدل ما يوصله رقم من غير سياق.
      await notifyPortalCustomer(inquiry.portalCustomerId, {
        type: "portal_price_inquiry_answered",
        title: "ردّ على طلب السعر بتاعك",
        body: `سألت عن سعر "${inquiry.productName}" بكمية ${inquiry.requestedQty} قطعة — السعر: ${finalPrice} جنيه للقطعة.`,
        referenceType: "portal_price_inquiry",
        referenceId: inquiry.id,
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
