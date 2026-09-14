/** @format */
/**
 * Portal Order Reviews (Staff-side) — مراجعة طلبات بوابة العملاء
 *
 * أي موظف عنده صلاحية المبيعات (hr/manager/admin/chairman) يقدر:
 *  - يشوف كل الطلبات الجديدة اللي جاية من البوابة ولسه ما اتراجعتش
 *  - يأكدها (بعد ما يحدد سعر كل صنف) → يتولّد أمر بيع (فاتورة) تلقائيًا
 *    مربوط بالعميل الحقيقي، وأوامر الإنتاج بتتربط بيه
 *  - يرفضها بسبب إجباري
 *  - في الحالتين، يقدر يكتب رد يشوفه العميل في صفحة "طلباتي"
 */
import { Router, Request, Response, NextFunction } from "express";
import { eq, and, sql, desc, isNotNull } from "drizzle-orm";
import { db } from "../db";
import {
  productionWorkflowOrdersTable,
  portalOrderReviewsTable,
  confirmPortalBatchSchema,
  rejectPortalBatchSchema,
  portalCustomersTable,
  salesOrdersTable,
  salesOrderItemsTable,
  bomRecipesTable,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { notifyRole, notifyRoles } from "../lib/notifications";
import { notifyPortalCustomer } from "../lib/portalNotifications";
import { sendCustomerAlert } from "../lib/otpDelivery";
import { logger } from "../lib/logger";
import { assertCancellable } from "../lib/cancellation";
import { writeAuditEvent } from "../lib/governance";
import { z } from "zod";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const router = Router();

export function isBatchReviewUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; constraint?: string };
  return (
    candidate?.code === "23505" &&
    candidate.constraint === "portal_order_reviews_batch_ref_unique"
  );
}

const batchReviewConflictMessage =
  "الإرسالية دي اتراجعت بالفعل من موظف تاني في نفس اللحظة";

async function generateSalesOrderNumber(tx: Transaction): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `SO-${yy}${mm}`;

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`sales_order_${yy}${mm}`}))`,
  );

  const [row] = await tx
    .select({ num: salesOrdersTable.orderNumber })
    .from(salesOrdersTable)
    .where(sql`${salesOrdersTable.orderNumber} LIKE ${prefix + "-%"}`)
    .orderBy(desc(salesOrdersTable.createdAt))
    .limit(1);

  const seq =
    row ? (parseInt(row.num.split("-").pop() ?? "0", 10) || 0) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/* ============================================================
   GET /portal-orders/pending — كل الإرساليات الجاية من البوابة ولسه محتاجة مراجعة
============================================================ */
router.get(
  "/portal-orders/pending",
  requireAuth,
  requireRole(...PERMISSIONS.sales.write),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestedPage = Number(req.query.page ?? 1);
      const requestedLimit = Number(req.query.limit ?? 20);
      const page =
        Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      const limit =
        Number.isInteger(requestedLimit) && requestedLimit > 0
          ? Math.min(requestedLimit, 50)
          : 20;
      const offset = (page - 1) * limit;
      const orders = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(isNotNull(productionWorkflowOrdersTable.portalCustomerId))
        .orderBy(desc(productionWorkflowOrdersTable.createdAt))
        .limit(limit * 10)
        .offset(offset);

      const reviewedBatchRefs = new Set(
        (
          await db
            .select({ batchRef: portalOrderReviewsTable.batchRef })
            .from(portalOrderReviewsTable)
        ).map((r) => r.batchRef),
      );

      // تجميع بصري حسب الإرسالية (batchRef) — كل إرسالية ممكن فيها أكتر من صنف
      const batches = new Map<string, typeof orders>();
      for (const order of orders) {
        const ref = order.salesOrderRef || `SINGLE-${order.id}`;
        if (reviewedBatchRefs.has(ref)) continue; // اتراجعت بالفعل
        if (!batches.has(ref)) batches.set(ref, []);
        batches.get(ref)!.push(order);
      }

      const data = Array.from(batches.entries()).map(([batchRef, items]) => ({
          batchRef,
          customerName: items[0].customerName,
          customerPhone: items[0].customerPhone,
          priority: items[0].priority,
          neededBy: items[0].neededBy,
          notes: items[0].notes,
          submittedAt: items[0].createdAt,
          items: items.map((i) => ({
            id: i.id,
            productName: i.productName,
            qty: i.qty,
            unit: i.unit,
            bomRecipeId: i.bomRecipeId,
            // Phase 3: بيانات مساعدة للمراجعة — الموظف يقدر يشوفها ويقرر
            // يسيبها زي ما هي أو يعدّلها (dueDateOverride/deliveryMethodOverride
            // في POST /portal-orders/:batchRef/confirm).
            neededBy: i.neededBy,
            suggestedDueDate: i.suggestedDueDate,
            referenceUnitPrice: i.referenceUnitPrice,
            referenceLineTotal: i.referenceLineTotal,
            suggestedDeliveryMethod: i.suggestedDeliveryMethod,
          })),
        }));
      res.json(data);
    } catch (err) {
      next(err);
    }
  },
);

/* ============================================================
   POST /portal-orders/:batchRef/confirm — تأكيد الإرسالية + توليد فاتورة تلقائية
============================================================ */
router.post(
  "/portal-orders/:batchRef/confirm",
  requireAuth,
  requireRole(...PERMISSIONS.sales.write),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const batchRef = String(req.params.batchRef);
      const data = confirmPortalBatchSchema.parse(req.body);

      const result = await db.transaction(async (tx: Transaction) => {
        // Lock the stable workflow rows for this batch before checking the
        // review. This serializes two staff decisions for the same batch while
        // keeping the unique constraint as a final database safety net.
        const orders = await tx
          .select()
          .from(productionWorkflowOrdersTable)
          .where(
            and(
              eq(productionWorkflowOrdersTable.salesOrderRef, batchRef),
              isNotNull(productionWorkflowOrdersTable.portalCustomerId),
            ),
          )
          .for("update");

        if (orders.length === 0) {
          throw Object.assign(new Error("الإرسالية غير موجودة"), {
            status: 404,
          });
        }

        // كل صنف في الطلب لازم يكون له سعر محدد من الموظف
        const priceMap = new Map(
          data.items.map((i) => [i.workflowOrderId, i.unitPrice]),
        );
        for (const order of orders) {
          if (!priceMap.has(order.id)) {
            throw Object.assign(
              new Error(
                `محتاج تحدد سعر لكل صنف — ناقص سعر لـ "${order.productName}"`,
              ),
              { status: 400 },
            );
          }
        }

        const [existingReview] = await tx
          .select()
          .from(portalOrderReviewsTable)
          .where(eq(portalOrderReviewsTable.batchRef, batchRef))
          .limit(1);
        if (existingReview) {
          throw Object.assign(new Error(batchReviewConflictMessage), {
            status: 409,
          });
        }

        // ✅ لازم نلاقي جهة الاتصال الحقيقية بتاعة العميل (اتعملت تلقائيًا وقت التسجيل)
        const [portalCustomer] = await tx
          .select()
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.id, orders[0].portalCustomerId!))
          .limit(1);

        const orderNumber = await generateSalesOrderNumber(tx);
        const subtotal = orders.reduce(
          (sum, o) => sum + Number(o.qty) * Number(priceMap.get(o.id)),
          0,
        );

        // ✅ الفاتورة التلقائية — أمر بيع حقيقي بحالة "draft"، عشان الموظف يراجعها
        // ويحوّلها لـ"مؤكد" وقت التسليم الفعلي من صفحة المبيعات العادية (مش بيتأثر
        // على المخزون أو رصيد العميل إلا وقت ما تتفعّل رسميًا من هناك)
        const [salesOrder] = await tx
          .insert(salesOrdersTable)
          .values({
            orderNumber,
            contactId: portalCustomer?.contactId ?? null,
            date: new Date().toISOString().slice(0, 10),
            dueDate: data.expectedDelivery ?? null,
            status: "draft",
            notes: `تم إنشاؤها تلقائيًا من طلب بوابة العملاء (${batchRef})`,
            subtotal: subtotal.toFixed(2),
            total: subtotal.toFixed(2),
          })
          .returning();

        for (const order of orders) {
          const unitPrice = priceMap.get(order.id)!;
          await tx.insert(salesOrderItemsTable).values({
            orderId: salesOrder.id,
            description: order.productName,
            qty: order.qty,
            unitPrice,
            total: (Number(order.qty) * Number(unitPrice)).toFixed(2),
          });

          // ✅ الربط الفعلي بين أمر الإنتاج والفاتورة
          const overrideInput = data.items.find(
            (i) => i.workflowOrderId === order.id,
          );
          const updateValues: Record<string, unknown> = {
            salesOrderId: salesOrder.id,
          };
          // Phase 3: تطبيق تعديل مبيعات البوابة على تاريخ/طريقة التسليم لو
          // اتبعتوا مع الطلب. لو مفيش تعديل، الاقتراح التلقائي الأصلي يفضل
          // كما هو (neededBy/suggestedDeliveryMethod اتحطوا وقت الإرسال).
          if (overrideInput?.dueDateOverride) {
            updateValues.neededBy = overrideInput.dueDateOverride;
            updateValues.dueDateOverriddenById = req.user!.userId;
            updateValues.dueDateOverriddenByName = req.user!.username;
            updateValues.dueDateOverrideReason =
              overrideInput.overrideReason ?? null;
            updateValues.dueDateOverriddenAt = new Date();
          }
          if (overrideInput?.deliveryMethodOverride) {
            updateValues.suggestedDeliveryMethod =
              overrideInput.deliveryMethodOverride;
            updateValues.deliveryMethodOverriddenById = req.user!.userId;
            updateValues.deliveryMethodOverriddenByName = req.user!.username;
            updateValues.deliveryMethodOverrideReason =
              overrideInput.overrideReason ?? null;
            updateValues.deliveryMethodOverriddenAt = new Date();
          }
          await tx
            .update(productionWorkflowOrdersTable)
            .set(updateValues)
            .where(eq(productionWorkflowOrdersTable.id, order.id));

          if (overrideInput?.dueDateOverride || overrideInput?.deliveryMethodOverride) {
            await writeAuditEvent({
              executor: tx,
              actorUserId: req.user!.userId,
              actorName: req.user!.username,
              actionKey: "portal_orders.override",
              resourceType: "production_workflow",
              resourceId: order.id,
              beforeData: {
                neededBy: order.neededBy,
                suggestedDeliveryMethod: order.suggestedDeliveryMethod,
              },
              afterData: {
                neededBy: updateValues.neededBy ?? order.neededBy,
                suggestedDeliveryMethod:
                  updateValues.suggestedDeliveryMethod ??
                  order.suggestedDeliveryMethod,
              },
              reason: overrideInput?.overrideReason ?? "تعديل يدوي وقت مراجعة طلب البوابة",
              ipAddress: req.ip,
              userAgent: req.get("user-agent"),
            });
          }
        }

        const [review] = await tx
          .insert(portalOrderReviewsTable)
          .values({
            batchRef,
            status: "confirmed",
            replyMessage: data.replyMessage ?? null,
            expectedDelivery: data.expectedDelivery ?? null,
            salesOrderId: salesOrder.id,
            reviewedById: req.user!.userId,
            reviewedByName: req.user!.username,
          })
          .returning();

        return { salesOrder, review, orders };
      });

      const { orders, ...reviewResult } = result;
      const customerName = orders[0].customerName || "عميل البوابة";
      await notifyRole("production_manager", {
        type: "portal_order_confirmed",
        title: "طلب بوابة مؤكد — جاهز للإنتاج",
        body: `تم تأكيد إرسالية "${batchRef}" وربطها بأمر بيع ${result.salesOrder.orderNumber}. العميل: ${customerName}. جاهزة للاستلام.`,
        referenceType: "production_workflow",
        referenceId: orders[0].id,
      });
      await notifyRoles(["hr_manager", "chairman"], {
        type: "portal_order_confirmed",
        title: "تأكيد طلب بوابة العملاء",
        body: `تم تأكيد طلب العميل "${customerName}" وإنشاء أمر البيع ${result.salesOrder.orderNumber}.`,
        referenceType: "production_workflow",
        referenceId: orders[0].id,
      });
      if (orders[0].portalCustomerId) {
        await notifyPortalCustomer(orders[0].portalCustomerId, {
          type: "portal_order_priced",
          title: "تم تحديد سعر طلبك",
          body: `تمت مراجعة إرسالية "${batchRef}" وتحديد السعر. ${data.replyMessage || "يمكنك متابعة التفاصيل من صفحة طلباتي."}`,
          referenceType: "production_workflow",
          referenceId: orders[0].id,
        });
        if (orders[0].customerPhone) {
          void sendCustomerAlert({
            channel: "phone",
            destination: orders[0].customerPhone,
            message: `تم تحديد سعر طلبك في Hyper-Tech للإرسالية ${batchRef}. ${data.replyMessage || "تابع التفاصيل من بوابة العملاء."}`,
            event: "portal_order_priced",
          }).catch((error) => {
            logger.error("Failed to send portal price alert", {
              error: error instanceof Error ? error.message : String(error),
              workflowOrderId: orders[0].id,
            });
          });
        }
      }

      res.json({ message: "تم تأكيد الطلب وإنشاء الفاتورة", ...reviewResult });
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        res.status(Number((err as Error & { status?: number }).status) || 422).json({
          error: { message: err.message },
        });
        return;
      }
      if (isBatchReviewUniqueViolation(err)) {
        res
          .status(409)
          .json({ error: { message: batchReviewConflictMessage } });
        return;
      }
      next(err);
    }
  },
);

/* ============================================================
   POST /portal-orders/:batchRef/reject — رفض الإرسالية بسبب إجباري
============================================================ */
router.post(
  "/portal-orders/:batchRef/reject",
  requireAuth,
  requireRole(...PERMISSIONS.sales.write),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const batchRef = String(req.params.batchRef);
      const data = rejectPortalBatchSchema.parse(req.body);

      const result = await db.transaction(async (tx: Transaction) => {
        // Use the same row lock as the confirmation path so a reject and a
        // confirm cannot both pass the review check for the same batch.
        const orders = await tx
          .select()
          .from(productionWorkflowOrdersTable)
          .where(
            and(
              eq(productionWorkflowOrdersTable.salesOrderRef, batchRef),
              isNotNull(productionWorkflowOrdersTable.portalCustomerId),
            ),
          )
          .for("update");

        if (orders.length === 0) {
          throw Object.assign(new Error("الإرسالية غير موجودة"), {
            status: 404,
          });
        }

        const [existingReview] = await tx
          .select()
          .from(portalOrderReviewsTable)
          .where(eq(portalOrderReviewsTable.batchRef, batchRef))
          .limit(1);
        if (existingReview) {
          throw Object.assign(new Error(batchReviewConflictMessage), {
            status: 409,
          });
        }

        await tx
          .update(productionWorkflowOrdersTable)
          .set({ workflowStatus: "cancelled" })
          .where(
            and(
              eq(productionWorkflowOrdersTable.salesOrderRef, batchRef),
              isNotNull(productionWorkflowOrdersTable.portalCustomerId),
            ),
          );

        await tx.insert(portalOrderReviewsTable).values({
          batchRef,
          status: "rejected",
          rejectReason: data.reason,
          replyMessage: data.replyMessage ?? null,
          expectedDelivery: data.expectedDelivery ?? null,
          reviewedById: req.user!.userId,
          reviewedByName: req.user!.username,
        });

        return { orders };
      });

      const orders = result.orders;
      const customerName = orders[0]?.customerName || "عميل البوابة";
      await notifyRoles(["hr_manager", "chairman"], {
        type: "portal_order_rejected",
        title: "رفض طلب بوابة العملاء",
        body: `تم رفض طلب العميل "${customerName}" للإرسالية "${batchRef}". السبب: ${data.reason}`,
        referenceType: "production_workflow",
        referenceId: orders[0]?.id,
      });
      if (orders[0]?.portalCustomerId) {
        await notifyPortalCustomer(orders[0].portalCustomerId, {
          type: "portal_order_rejected",
          title: "تعذّر قبول طلبك",
          body: `تعذّر قبول إرسالية "${batchRef}". ${data.replyMessage || data.reason}`,
          referenceType: "production_workflow",
          referenceId: orders[0].id,
        });
      }

      res.json({ message: "تم رفض الطلب" });
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        res.status(Number((err as Error & { status?: number }).status) || 422).json({
          error: { message: err.message },
        });
        return;
      }
      if (isBatchReviewUniqueViolation(err)) {
        res
          .status(409)
          .json({ error: { message: batchReviewConflictMessage } });
        return;
      }
      next(err);
    }
  },
);

/* ============================================================
   POST /portal-orders/:id/cancel — إلغاء صنف واحد من طرف مبيعات البوابة
   (Phase 3) — نفس حدود الإلغاء اللي عند العميل بالظبط (src/lib/cancellation.ts)،
   ومنفصل عمدًا عن إندپوينت الإلغاء الداخلي العام للإنتاج.
============================================================ */
const cancelPortalOrderItemSchema = z.object({
  reason: z.string().min(1, "سبب الإلغاء مطلوب").max(500),
});

router.post(
  "/portal-orders/:id/cancel",
  requireAuth,
  requireRole(...PERMISSIONS.sales.write),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: { message: "معرّف غير صحيح" } });
        return;
      }
      const data = cancelPortalOrderItemSchema.parse(req.body);

      const updated = await db.transaction(async (tx: Transaction) => {
        const [order] = await tx
          .select()
          .from(productionWorkflowOrdersTable)
          .where(
            and(
              eq(productionWorkflowOrdersTable.id, id),
              isNotNull(productionWorkflowOrdersTable.portalCustomerId),
            ),
          )
          .for("update");
        if (!order) {
          throw Object.assign(new Error("الصنف غير موجود"), { status: 404 });
        }
        assertCancellable(order.workflowStatus);

        const [result] = await tx
          .update(productionWorkflowOrdersTable)
          .set({
            workflowStatus: "cancelled",
            cancelledById: req.user!.userId,
            cancelledByName: req.user!.username,
            cancelledByRole: req.user!.role,
            cancelReason: data.reason,
            cancelledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(productionWorkflowOrdersTable.id, id))
          .returning();
        return result;
      });

      if (updated.portalCustomerId) {
        await notifyPortalCustomer(updated.portalCustomerId, {
          type: "portal_order_cancelled_by_staff",
          title: "تم إلغاء صنف من طلبك",
          body: `تم إلغاء "${updated.productName}" (${updated.orderNumber}). السبب: ${data.reason}`,
          referenceType: "production_workflow",
          referenceId: updated.id,
        });
      }

      res.json({ message: "تم إلغاء الصنف", order: updated });
    } catch (err: any) {
      if (err?.status) {
        res.status(err.status).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  },
);

export default router;
