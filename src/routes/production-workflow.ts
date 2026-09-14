/** @format */
/**
 * Production Workflow Routes — نظام دورة الإنتاج المتكاملة
 *
 * الإصلاحات المطبّقة:
 *  ✅ جميع الـ handlers مغلّفة بـ try/catch + next(err)
 *  ✅ generateWorkflowOrderNumber داخل transaction مع advisory lock (انتهت race condition)
 *  ✅ warehouse-action: تحديث الحالة داخل نفس transaction الخصم من المخزون
 *  ✅ deliver: تحديث الحالة داخل نفس transaction إضافة المخزون
 */

import { Router, Request, Response, NextFunction } from "express";
import { eq, desc, sql, and } from "drizzle-orm";
import { db } from "../db";
import {
  productionWorkflowOrdersTable,
  createWorkflowOrderSchema,
  receiveOrderSchema,
  changeNeededBySchema,
  warehouseWorkflowActionSchema,
  qualityDoneSchema,
  deliverProductSchema,
  stockMovementsTable,
  operationTransfersTable,
} from "../db/schema";
import { nextPhase0Number } from "../lib/phase0";
import {
  requireAuth,
  requireRole,
  requirePermission,
} from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { notifyRole, notifyUser, notifyRoles } from "../lib/notifications";
import { notifyPortalCustomer } from "../lib/portalNotifications";
import { sendCustomerAlert } from "../lib/otpDelivery";
import { logger } from "../lib/logger";
import { applyStockMovement } from "../lib/stock";
import { computeRequiredMaterialsForOrder } from "../lib/materials";
import { PERMISSIONS } from "../lib/permissions";
import { assertProductionTransition } from "../domain/production-status";
import { writeAuditEvent } from "../lib/governance";
import { maskProductionWorkflowPayload } from "../lib/fieldMasking";
import {
  notificationsTable,
  qualityRecordsTable,
  systemUsersTable,
  bomRecipesTable,
} from "../db/schema";

const router = Router();

// Apply the PII boundary at serialization time for every endpoint in this
// router, including dashboard/detail responses and mutation responses.
router.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) =>
    originalJson(maskProductionWorkflowPayload(body, req.user?.role ?? ""))) as typeof res.json;
  next();
});

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Phase 0: business numbering is serialized by a locked database sequence row.
export async function generateWorkflowOrderNumber(
  tx: Transaction,
): Promise<string> {
  return nextPhase0Number(tx, "production_order");
}

async function lockWorkflowOrder(tx: Transaction, id: number) {
  const [order] = await tx
    .select()
    .from(productionWorkflowOrdersTable)
    .where(eq(productionWorkflowOrdersTable.id, id))
    .for("update")
    .limit(1);
  return order;
}

async function auditWorkflowTransition(
  tx: Transaction,
  user: { userId: number; username: string },
  before: typeof productionWorkflowOrdersTable.$inferSelect,
  after: typeof productionWorkflowOrdersTable.$inferSelect,
  actionKey: string,
  reason?: string | null,
) {
  if (before.workflowStatus === after.workflowStatus) return;
  await writeAuditEvent({
    executor: tx,
    actorUserId: user.userId,
    actorName: user.username,
    actionKey,
    resourceType: "production_workflow_order",
    resourceId: after.id,
    beforeData: {
      workflowStatus: before.workflowStatus,
      orderNumber: before.orderNumber,
    },
    afterData: {
      workflowStatus: after.workflowStatus,
      orderNumber: after.orderNumber,
    },
    reason: reason ?? null,
  });
}

function workflowStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    new: "جديد",
    awaiting_operations_claim: "في انتظار استلام مدير التشغيل",
    claimed: "تم استلامه من مدير التشغيل",
    pending_supervisor: "في انتظار مشرف الإنتاج",
    materials_requested: "تم طلب المواد الخام",
    materials_approved: "المواد موافق عليها",
    materials_partial: "موافقة جزئية على المواد",
    materials_rejected: "المواد مرفوضة",
    in_production: "قيد التنفيذ",
    quality_check: "فحص الجودة",
    completed: "مكتمل",
    delivery_pending_customer: "بانتظار تأكيد الاتش آر للتسليم للعميل",
    delivery_pending_warehouse: "بانتظار استلام المخزن",
    delivered_customer: "تم التسليم للعميل",
    delivered_warehouse: "تم التسليم للمخزن",
    cancelled: "ملغي",
  };
  return labels[status] ?? status;
}

function priorityLabel(p: string): string {
  return (
    (
      {
        urgent: "⚡ عاجل جداً",
        high: "🔴 مرتفع",
        normal: "🟡 عادي",
        low: "🟢 منخفض",
      } as Record<string, string>
    )[p] ?? p
  );
}

async function notifyPortalWorkflowStatus(
  order: typeof productionWorkflowOrdersTable.$inferSelect,
  payload: {
    type: string;
    title: string;
    body: string;
  },
) {
  if (!order.portalCustomerId) return;
  await notifyPortalCustomer(order.portalCustomerId, {
    ...payload,
    referenceType: "production_workflow",
    referenceId: order.id,
  });
}

function sendPortalCriticalAlert(
  order: typeof productionWorkflowOrdersTable.$inferSelect,
  message: string,
  event: string,
) {
  if (!order.portalCustomerId || !order.customerPhone) return;
  void sendCustomerAlert({
    channel: "phone",
    destination: order.customerPhone,
    message,
    event,
  }).catch((error) => {
    logger.error("Failed to send portal workflow alert", {
      error: error instanceof Error ? error.message : String(error),
      workflowOrderId: order.id,
      event,
    });
  });
}

// ✅ إخفاء بيانات العميل عن الأدوار اللي مفروض تشوف بيانات المنتج بس (مدير الإنتاج، المشرف،
// مدير المخازن، مراقب الجودة) — الاتش آر والمدير الكامل/مدير عام بس يشوفوا بيانات العميل
const CUSTOMER_INFO_ALLOWED_ROLES = new Set([
  "hr",
  "hr_manager",
  "executive_manager",
  "operations_manager",
  "sales_manager",
  "online_seller",
  "offline_seller",
  "chairman",
]);
function stripCustomerInfoIfNotAllowed<T extends Record<string, any>>(
  order: T,
  role: string,
): T {
  if (CUSTOMER_INFO_ALLOWED_ROLES.has(role)) return order;
  const { customerName, customerPhone, customerEmail, ...rest } = order;
  return rest as T;
}

// GET /production-workflow/dashboard
router.get(
  "/production-workflow/dashboard",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      let orders: (typeof productionWorkflowOrdersTable.$inferSelect)[];

      if (user.role === "supervisor") {
        orders = await db
          .select()
          .from(productionWorkflowOrdersTable)
          .where(eq(productionWorkflowOrdersTable.supervisorId, user.userId))
          .orderBy(desc(productionWorkflowOrdersTable.createdAt));
      } else {
        orders = await db
          .select()
          .from(productionWorkflowOrdersTable)
          .orderBy(desc(productionWorkflowOrdersTable.createdAt));
      }

      const stats = {
        total: orders.length,
        new: orders.filter((o) => o.workflowStatus === "new").length,
        awaiting_operations_claim: orders.filter(
          (o) => o.workflowStatus === "awaiting_operations_claim",
        ).length,
        claimed: orders.filter((o) => o.workflowStatus === "claimed").length,
        pending_supervisor: orders.filter(
          (o) => o.workflowStatus === "pending_supervisor",
        ).length,
        materials_requested: orders.filter(
          (o) => o.workflowStatus === "materials_requested",
        ).length,
        materials_approved: orders.filter((o) =>
          ["materials_approved", "materials_partial"].includes(
            o.workflowStatus,
          ),
        ).length,
        materials_rejected: orders.filter(
          (o) => o.workflowStatus === "materials_rejected",
        ).length,
        in_production: orders.filter(
          (o) => o.workflowStatus === "in_production",
        ).length,
        quality_check: orders.filter(
          (o) => o.workflowStatus === "quality_check",
        ).length,
        completed: orders.filter((o) => o.workflowStatus === "completed")
          .length,
        delivered: orders.filter((o) =>
          ["delivered_customer", "delivered_warehouse"].includes(
            o.workflowStatus,
          ),
        ).length,
        cancelled: orders.filter((o) => o.workflowStatus === "cancelled")
          .length,
      };

      let roleSpecific: Record<string, number> = {};
      if (user.role === "supervisor") {
        roleSpecific.awaiting_acceptance = orders.filter(
          (o) =>
            o.workflowStatus === "pending_supervisor" &&
            o.supervisorId === user.userId,
        ).length;
        roleSpecific.need_materials_request = orders.filter(
          (o) =>
            ["materials_approved", "materials_partial"].includes(
              o.workflowStatus,
            ) && o.supervisorId === user.userId,
        ).length;
      } else if (user.role === "warehouse_manager") {
        roleSpecific.awaiting_warehouse_decision = orders.filter(
          (o) => o.workflowStatus === "materials_requested",
        ).length;
        roleSpecific.awaiting_delivery = orders.filter(
          (o) => o.workflowStatus === "completed",
        ).length;
      }

      res.json({ stats, roleSpecific, recentOrders: orders.slice(0, 10) });
    } catch (err) {
      next(err);
    }
  },
);

// GET /production-workflow
router.get(
  "/production-workflow",
  requireAuth,
  requireRole(
    "chairman",
    "executive_manager",
    "operations_manager",
    "hr",
    "hr_manager",
    "production_manager",
    "production_controller",
    "warehouse_manager",
    "supervisor",
    "production_quality_controller",
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const { status } = req.query as { status?: string };
      let orders: (typeof productionWorkflowOrdersTable.$inferSelect)[];

      if (user.role === "supervisor") {
        const all = await db
          .select()
          .from(productionWorkflowOrdersTable)
          .orderBy(desc(productionWorkflowOrdersTable.createdAt));
        orders = all.filter(
          (o) =>
            o.supervisorId === user.userId ||
            o.workflowStatus === "pending_supervisor",
        );
      } else {
        orders = await db
          .select()
          .from(productionWorkflowOrdersTable)
          .orderBy(desc(productionWorkflowOrdersTable.createdAt));
      }

      if (status) orders = orders.filter((o) => o.workflowStatus === status);

      res.json({
        data: orders.map((o) => stripCustomerInfoIfNotAllowed(o, user.role)),
        stats: {
          total: orders.length,
          byStatus: Object.fromEntries(
            [
              "new",
              "awaiting_operations_claim",
              "claimed",
              "pending_supervisor",
              "materials_requested",
              "materials_approved",
              "materials_partial",
              "materials_rejected",
              "in_production",
              "quality_check",
              "completed",
              "delivered_customer",
              "delivered_warehouse",
              "cancelled",
            ].map((s) => [
              s,
              orders.filter((o) => o.workflowStatus === s).length,
            ]),
          ),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /production-workflow/team-options — قوائم المشرفين ومراقبي الجودة الحقيقيين (بأسمائهم من حساباتهم)
// + عدد الأوامر الجارية عند كل واحد فيهم، عشان مدير الإنتاج يوزّع الشغل بتوازن
// ✅ إصلاح: لازم يتسجل قبل "/production-workflow/:id" — وإلا Express كان بيفسّر
// "team-options" على إنها قيمة لـ :id ويدخل على الـ handler الغلط (بيرفضها كـ id مش صحيح)
// فمكانش بيوصل لهنا خالص، ومكانت بترجع قوائم فاضية حتى مع وجود مشرفين/مراقبي جودة فعليين.
router.get(
  "/production-workflow/team-options",
  requireAuth,
  requireRole(
    "production_manager",
    "operations_manager",
    "executive_manager",
    "chairman",
  ),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const ACTIVE_STATUSES = [
        "materials_requested",
        "materials_approved",
        "materials_partial",
        "in_production",
        "quality_check",
      ];

      const [supervisors, qualityControllers, allOrders] = await Promise.all([
        db
          .select({
            id: systemUsersTable.id,
            fullName: systemUsersTable.fullName,
          })
          .from(systemUsersTable)
          .where(eq(systemUsersTable.role, "supervisor")),
        db
          .select({
            id: systemUsersTable.id,
            fullName: systemUsersTable.fullName,
          })
          .from(systemUsersTable)
          .where(eq(systemUsersTable.role, "production_quality_controller")),
        db
          .select({
            supervisorId: productionWorkflowOrdersTable.supervisorId,
            qualityControllerUserId:
              productionWorkflowOrdersTable.qualityControllerUserId,
            workflowStatus: productionWorkflowOrdersTable.workflowStatus,
          })
          .from(productionWorkflowOrdersTable),
      ]);

      const activeOrders = allOrders.filter((o) =>
        ACTIVE_STATUSES.includes(o.workflowStatus),
      );
      const countFor = (
        userId: number,
        field: "supervisorId" | "qualityControllerUserId",
      ) => activeOrders.filter((o) => o[field] === userId).length;

      res.json({
        supervisors: supervisors.map((s) => ({
          ...s,
          activeCount: countFor(s.id, "supervisorId"),
        })),
        qualityControllers: qualityControllers.map((q) => ({
          ...q,
          activeCount: countFor(q.id, "qualityControllerUserId"),
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /production-workflow/quality-records
// ✅ إضافة: كانت بيانات الفحص (عينة، عيوب، قائمة فحص، تقييم أداء) بتتسجل في كل
// مرة مراقب جودة يخلّص فحص، لكن مفيش أي endpoint كان بيقرأها تاني — بيانات
// "اكتب بس" من غير ما تتعرض في أي تقرير أو صفحة خالص.
// ✅ لازم تتسجل هنا (قبل "/production-workflow/:id") وإلا Express هيفسّرها كـ :id غلط.
router.get(
  "/production-workflow/quality-records",
  requireAuth,
  requireRole(...PERMISSIONS.quality.view),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await db
        .select()
        .from(qualityRecordsTable)
        .orderBy(desc(qualityRecordsTable.createdAt));
      res.json({ data: records });
    } catch (err) {
      next(err);
    }
  },
);

// GET /production-workflow/:id
router.get(
  "/production-workflow/:id",
  requireAuth,
  requireRole(
    "chairman",
    "executive_manager",
    "operations_manager",
    "hr",
    "hr_manager",
    "production_manager",
    "warehouse_manager",
    "supervisor",
    "production_quality_controller",
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [order] = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(eq(productionWorkflowOrdersTable.id, id))
        .limit(1);
      if (!order) {
        res.status(404).json({ error: { message: "أمر الإنتاج غير موجود" } });
        return;
      }
      const children = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(eq(productionWorkflowOrdersTable.parentWorkflowOrderId, id));
      res.json({
        data: stripCustomerInfoIfNotAllowed(order, req.user!.role),
        children: children.map((child) =>
          stripCustomerInfoIfNotAllowed(child, req.user!.role),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /production-workflow
// ✅ نقطة الدخول الوحيدة للنظام: الاتش آر فقط (أو المدير الكامل كنسخة احتياطية)
router.post(
  "/production-workflow",
  requireAuth,
  requireRole(
    "hr",
    "hr_manager",
    "sales_manager",
    "executive_manager",
    "chairman",
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createWorkflowOrderSchema.parse(req.body);
      const user = req.user!;

      // ✅ لازم يكون مربوط بوصفة تصنيع حقيقية — واسم المنتج يُشتق منها دايمًا، مش من إدخال المستخدم
      if (!data.bomRecipeId) {
        res.status(400).json({
          error: {
            code: "RECIPE_REQUIRED",
            message: "لازم تختار منتج له وصفة تصنيع محفوظة",
          },
        });
        return;
      }
      const [recipe] = await db
        .select()
        .from(bomRecipesTable)
        .where(eq(bomRecipesTable.id, data.bomRecipeId))
        .limit(1);
      if (!recipe) {
        res.status(400).json({
          error: {
            code: "RECIPE_NOT_FOUND",
            message: "وصفة التصنيع المختارة غير موجودة",
          },
        });
        return;
      }

      // ✅ إنشاء الرقم + الصف في transaction واحدة مع advisory lock
      const order = await db.transaction(async (tx) => {
        const orderNumber = await generateWorkflowOrderNumber(tx);
        const [inserted] = await tx
          .insert(productionWorkflowOrdersTable)
          .values({
            orderNumber,
            workflowStatus: "awaiting_operations_claim",
            productName: recipe.productName,
            qty: data.qty,
            unit: data.unit,
            bomRecipeId: data.bomRecipeId,
            salesOrderId: data.salesOrderId ?? null,
            salesOrderRef: data.salesOrderRef ?? null,
            customerName: data.customerName,
            customerPhone: data.customerPhone ?? null,
            customerEmail: data.customerEmail || null,
            orderSource: data.orderSource,
            orderDetails: data.orderDetails ?? null,
            priority: data.priority,
            neededBy: data.neededBy,
            notes: data.notes ?? null,
            createdById: user.userId,
            createdByName: user.username,
          })
          .returning();
        await writeAuditEvent({
          executor: tx,
          actorUserId: user.userId,
          actorName: user.username,
          actionKey: "production_workflow.create",
          resourceType: "production_workflow_order",
          resourceId: inserted.id,
          beforeData: null,
          afterData: {
            workflowStatus: inserted.workflowStatus,
            orderNumber: inserted.orderNumber,
          },
        });
        return inserted;
      });

      const pLabel = priorityLabel(data.priority);

       // Phase 4: the first handoff is the Operations Manager gate. The
       // production manager is notified only after the claim and receive step.
       await notifyRole("operations_manager", {
         type: "operations_line_awaiting_claim",
         title: `أمر إنتاج جديد ينتظر استلام مدير التشغيل — ${pLabel}`,
         body: `أمر إنتاج جديد "${recipe.productName}" (${data.qty} ${data.unit}) — رقم ${order.orderNumber}. في انتظار استلام مدير التشغيل.`,
        referenceType: "production_workflow",
        referenceId: order.id,
      });

      await notifyRole("chairman", {
        type: "workflow_new_order",
        title: `أمر إنتاج جديد — ${pLabel}`,
        body: `تم إنشاء أمر إنتاج "${recipe.productName}" رقم ${order.orderNumber} بواسطة "${user.username}".`,
        referenceType: "production_workflow",
        referenceId: order.id,
      });

      res.status(201).json({
        message: `تم إنشاء أمر الإنتاج رقم ${order.orderNumber} بنجاح.`,
        data: order,
      });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /production-workflow/:id/needed-by — تعديل تاريخ التسليم (لصاحبه فقط، وينبّه كل من مرّ على الطلب)
router.patch(
  "/production-workflow/:id/needed-by",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const data = changeNeededBySchema.parse(req.body);
      const user = req.user!;

      const [existing] = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(eq(productionWorkflowOrdersTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "أمر الإنتاج غير موجود" } });
        return;
      }
      // ✅ محدش يعدّل تاريخ التسليم غير نفس اللي كتبه أول مرة
      if (existing.createdById !== user.userId) {
        res.status(403).json({
          error: {
            code: "NEEDED_BY_LOCKED",
            message: "تاريخ التسليم لا يمكن تعديله إلا بواسطة من أنشأ الطلب",
          },
        });
        return;
      }

      const oldDate = existing.neededBy;
      const [updated] = await db
        .update(productionWorkflowOrdersTable)
        .set({ neededBy: data.neededBy, updatedAt: new Date() })
        .where(eq(productionWorkflowOrdersTable.id, id))
        .returning();

      // ✅ إشعار كل من مرّ على الطلب لحد لحظة التعديل (كل مين استلم إشعار عنه قبل كده)
      const touchedUserIds = await db
        .selectDistinct({ userId: notificationsTable.userId })
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.referenceType, "production_workflow"),
            eq(notificationsTable.referenceId, id),
          ),
        );

      const body =
        `تم تعديل تاريخ التسليم لأمر الإنتاج رقم ${existing.orderNumber} من ${oldDate || "—"} إلى ${data.neededBy}` +
        (data.reason ? ` — السبب: ${data.reason}` : "") +
        ` (بواسطة ${user.username})`;

      for (const { userId } of touchedUserIds) {
        if (userId === user.userId) continue; // مفيش داعي ينبّه نفسه
        await notifyUser(userId, {
          type: "workflow_needed_by_changed",
          title: "تعديل تاريخ التسليم",
          body,
          referenceType: "production_workflow",
          referenceId: id,
        });
      }

      res.json({
        message: "تم تعديل تاريخ التسليم وتنبيه كل من مرّ على الطلب",
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /production-workflow/:id/receive — استلام مدير الإنتاج: يعيّن الفريق ويرسل تلقائيًا لمدير المخازن
router.patch(
  "/production-workflow/:id/receive",
  requireAuth,
  requireRole(
    "production_manager",
    "operations_manager",
    "executive_manager",
    "chairman",
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const data = receiveOrderSchema.parse(req.body);
      const user = req.user!;

      const [existing] = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(eq(productionWorkflowOrdersTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "الأمر غير موجود" } });
        return;
      }
       if (existing.workflowStatus !== "claimed") {
        res.status(409).json({
          error: {
            message: `لا يمكن استلام الأمر — حالته: "${workflowStatusLabel(existing.workflowStatus)}"`,
          },
        });
        return;
      }
      if (!existing.bomRecipeId) {
        res.status(400).json({
          error: {
            message:
              "الأمر غير مرتبط بوصفة تصنيع — لا يمكن حساب المواد المطلوبة تلقائيًا",
          },
        });
        return;
      }

      // ✅ التحقق من إن المشرف ومراقب الجودة حسابات حقيقية موجودة فعلاً وبالدور الصحيح
      const [supervisor] = await db
        .select()
        .from(systemUsersTable)
        .where(eq(systemUsersTable.id, data.supervisorId))
        .limit(1);
      if (!supervisor || supervisor.role !== "supervisor") {
        res
          .status(400)
          .json({ error: { message: "الحساب المختار كمشرف غير صالح" } });
        return;
      }
      const [qc] = await db
        .select()
        .from(systemUsersTable)
        .where(eq(systemUsersTable.id, data.qualityControllerUserId))
        .limit(1);
      if (!qc || qc.role !== "production_quality_controller") {
        res
          .status(400)
          .json({ error: { message: "الحساب المختار كمراقب جودة غير صالح" } });
        return;
      }

      // ✅ حساب المواد المطلوبة تلقائيًا بالكامل من الوصفة — مفيش أي إدخال يدوي هنا
      const requiredMaterials = await computeRequiredMaterialsForOrder(
        existing.bomRecipeId,
        Number(existing.qty),
      );

      const updated = await db.transaction(async (tx) => {
        const locked = await lockWorkflowOrder(tx, id);
        if (!locked)
          throw Object.assign(new Error("الأمر غير موجود"), { status: 404 });
         if (locked.workflowStatus !== "claimed") {
          throw Object.assign(
            new Error(
              `لا يمكن استلام الأمر — الأمر في حالة: "${workflowStatusLabel(locked.workflowStatus)}"`,
            ),
            { status: 409 },
          );
        }
        assertProductionTransition(
           locked.workflowStatus,
           "materials_requested",
        );
        const [up] = await tx
          .update(productionWorkflowOrdersTable)
          .set({
            workflowStatus: "materials_requested",
            supervisorId: supervisor.id,
            supervisorName: supervisor.fullName,
            qualityControllerUserId: qc.id,
            qualityControllerName: qc.fullName,
            productionLine: data.productionLine,
            startDate: data.startDate,
            endDate: locked.neededBy,
            operationalStatus: data.operationalStatus,
            pendingReason:
              data.operationalStatus === "pending" ?
                (data.pendingReason ?? null)
              : null,
            receivedByUserId: user.userId,
            receivedByName: user.username,
            receivedAt: new Date(),
            requestedMaterials: requiredMaterials,
            materialsRequestedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(productionWorkflowOrdersTable.id, id),
               eq(productionWorkflowOrdersTable.workflowStatus, "claimed"),
            ),
          )
          .returning();
        if (!up)
          throw Object.assign(new Error("تم تحديث الأمر من جلسة أخرى"), {
            status: 409,
          });
        await auditWorkflowTransition(
          tx,
          user,
          locked,
          up,
          "production_workflow.receive",
        );
        return up;
      });

      await notifyUser(existing.createdById, {
        type: "workflow_received",
        title: `تم استلام أمر الإنتاج ${existing.orderNumber}`,
        body: `مدير الإنتاج "${user.username}" استلم أمر الإنتاج "${existing.productName}" رقم ${existing.orderNumber}.`,
        referenceType: "production_workflow",
        referenceId: id,
      });

      await notifyUser(supervisor.id, {
        type: "workflow_assigned_pending_materials",
        title: `تم تعيينك على أمر إنتاج ${existing.orderNumber}`,
        body: `أمر "${existing.productName}" اتعيّنت عليه مشرفًا — لسه في انتظار اعتماد المواد من المخازن.`,
        referenceType: "production_workflow",
        referenceId: id,
      });

      await notifyRole("warehouse_manager", {
        type: "workflow_materials_requested",
        title: `طلب فحص مخزون — أمر ${existing.orderNumber}`,
        body: `أمر إنتاج "${existing.productName}" رقم ${existing.orderNumber} جاهز لفحص المواد الخام المطلوبة.`,
        referenceType: "production_workflow",
        referenceId: id,
      });

      res.json({
        message: "تم استلام الأمر وإرساله تلقائيًا لمدير المخازن لفحص المواد.",
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /production-workflow/:id/materials-check — فحص تلقائي حي: وصفة المنتج مقابل المتاح بالمخزون الآن
router.get(
  "/production-workflow/:id/materials-check",
  requireAuth,
  requireRole(
    "warehouse_manager",
    "storekeeper",
    "operations_manager",
    "production_manager",
    "executive_manager",
    "chairman",
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const user = req.user!;
      const [existing] = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(eq(productionWorkflowOrdersTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "الأمر غير موجود" } });
        return;
      }
      if (!existing.bomRecipeId) {
        res
          .status(400)
          .json({ error: { message: "الأمر غير مرتبط بوصفة تصنيع" } });
        return;
      }

      const materials = await computeRequiredMaterialsForOrder(
        existing.bomRecipeId,
        Number(existing.qty),
      );
      const allSufficient = materials.every((m) => m.sufficient);
      res.json({ materials, allSufficient });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /production-workflow/:id/warehouse-action
// ✅ إصلاح: تحديث الحالة داخل نفس transaction الخصم من المخزون
router.patch(
  "/production-workflow/:id/warehouse-action",
  requireAuth,
  requirePermission("productionWorkflow.warehouseAction"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const data = warehouseWorkflowActionSchema.parse(req.body);
      const user = req.user!;

      const [existing] = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(eq(productionWorkflowOrdersTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "الأمر غير موجود" } });
        return;
      }
      if (existing.workflowStatus !== "materials_requested") {
        res.status(409).json({
          error: {
            message: `لا يمكن اتخاذ قرار — الأمر في حالة: "${workflowStatusLabel(existing.workflowStatus)}"`,
          },
        });
        return;
      }
      if (
        user.role === "operations_manager" ||
        user.role === "executive_manager" ||
        user.role === "chairman"
      ) {
        const [unfinishedChild] = await db
          .select({ id: productionWorkflowOrdersTable.id })
          .from(productionWorkflowOrdersTable)
          .where(
            and(
              eq(productionWorkflowOrdersTable.parentWorkflowOrderId, id),
              sql`${productionWorkflowOrdersTable.workflowStatus} not in ('completed', 'delivered_customer', 'delivered_warehouse', 'cancelled')`,
            ),
          )
          .limit(1);
        if (unfinishedChild) {
          res.status(409).json({
            error: {
              message:
                "لا يمكن بدء الأمر الرئيسي قبل اكتمال أوامر المنتجات الأولية التابعة.",
            },
          });
          return;
        }
      }

      if (data.action === "approve" || data.action === "partial") {
        // مدير المخازن يجهّز ويسلّم لمدير التشغيل فقط؛ لا يخصم المخزون من هذا المسار.
        if (user.role === "warehouse_manager") {
          assertProductionTransition(
            existing.workflowStatus,
            data.action === "partial" ?
              "materials_partial"
            : "materials_approved",
          );
          const transfers = await db.transaction(async (tx) => {
            const locked = await lockWorkflowOrder(tx, id);
            if (!locked)
              throw Object.assign(new Error("الأمر غير موجود"), {
                status: 404,
              });
            if (locked.workflowStatus !== "materials_requested") {
              throw Object.assign(
                new Error("تم اتخاذ قرار المواد من جلسة أخرى"),
                { status: 409 },
              );
            }
            const materials = (locked.requestedMaterials as any[]) || [];
            const createdTransfers = [];
            for (const item of materials) {
              if (!item.inventoryItemId) continue;
              const qty =
                data.action === "partial" ?
                  (data.materialDecisions?.find(
                    (d) => d.inventoryItemId === item.inventoryItemId,
                  )?.approvedQty ?? "0")
                : item.requestedQty;
              if (Number(qty) <= 0) continue;
              const [transfer] = await tx
                .insert(operationTransfersTable)
                .values({
                  workflowOrderId: id,
                  direction: "warehouse_to_operations",
                  inventoryItemId: item.inventoryItemId,
                  quantity: String(qty),
                  idempotencyKey: `warehouse-${id}-${item.inventoryItemId}`,
                  preparedBy: user.userId,
                  notes: data.comment ?? null,
                })
                .returning();
              createdTransfers.push(transfer);
            }
            const [updated] = await tx
              .update(productionWorkflowOrdersTable)
              .set({
                workflowStatus:
                  data.action === "partial" ?
                    "materials_partial"
                  : "materials_approved",
                warehouseManagerId: user.userId,
                warehouseManagerName: user.username,
                warehouseDecision: data.action,
                warehouseApprovedQty: data.approvedQty ?? null,
                warehouseComment: data.comment ?? null,
                warehouseDecidedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(productionWorkflowOrdersTable.id, id),
                  eq(
                    productionWorkflowOrdersTable.workflowStatus,
                    "materials_requested",
                  ),
                ),
              )
              .returning();
            if (!updated)
              throw Object.assign(
                new Error("تم اتخاذ قرار المواد من جلسة أخرى"),
                { status: 409 },
              );
            await auditWorkflowTransition(
              tx,
              user,
              locked,
              updated,
              "production_workflow.warehouse_action",
              data.comment,
            );
            return { updated, createdTransfers };
          });
          res.json({
            message: "تم تجهيز المواد وتسليمها لمدير التشغيل دون خصم مباشر.",
            data: transfers,
          });
          return;
        }
        const newStatus =
          data.action === "approve" ?
            "materials_approved"
          : "materials_partial";
        assertProductionTransition(existing.workflowStatus, newStatus);
        const deductionResults: string[] = [];

        const updated = await db.transaction(async (tx) => {
          const locked = await lockWorkflowOrder(tx, id);
          if (!locked)
            throw Object.assign(new Error("الأمر غير موجود"), { status: 404 });
          if (locked.workflowStatus !== "materials_requested") {
            throw Object.assign(
              new Error("تم اتخاذ قرار المواد من جلسة أخرى"),
              { status: 409 },
            );
          }
          const materials = (locked.requestedMaterials as any[]) || [];
          const itemsToDeduct =
            data.action === "partial" && data.materialDecisions ?
              data.materialDecisions
            : materials.filter((m: any) => m.inventoryItemId);

          for (const item of itemsToDeduct) {
            const inventoryId =
              "inventoryItemId" in item ? item.inventoryItemId : null;
            if (!inventoryId) continue;
            const qty =
              "approvedQty" in item ? item.approvedQty
              : "requestedQty" in item ? item.requestedQty
              : "0";
            if (data.action === "partial") {
              // ✅ الموافقة الجزئية بطبيعتها بتسمح إن بعض الأصناف تتعذر —
              // ده مقصود ومتوقع، فبنسجله كتحذير ونكمل باقي الأصناف.
              try {
                await applyStockMovement(tx, {
                  inventoryItemId: inventoryId,
                  movementType: "out",
                  qty: String(qty),
                  referenceType: "production",
                  referenceId: id,
                  notes: `خصم لأمر إنتاج ${locked.orderNumber}`,
                });
                deductionResults.push(
                  `✓ تم خصم ${qty} من "${(item as any).materialName ?? `صنف #${inventoryId}`}"`,
                );
              } catch (err: any) {
                deductionResults.push(
                  `⚠ تعذّر خصم "${(item as any).materialName}": ${err.message}`,
                );
              }
            } else {
              // ✅ إصلاح حرج: "approve" تعني موافقة كاملة على كل المواد — لو
              // أي صنف فشل خصمه (كمية غير كافية مثلاً)، الأمر بالكامل لازم
              // يفشل ويترجع للمخزن error واضح، مش يتسجل "موافقة كاملة" وهو
              // ناقص فعليًا. الخطأ هنا بيتسيب يطلع لبره الـ transaction
              // عشان drizzle يعمل rollback لأي خصم سابق نجح في نفس الطلب.
              await applyStockMovement(tx, {
                inventoryItemId: inventoryId,
                movementType: "out",
                qty: String(qty),
                referenceType: "production",
                referenceId: id,
                notes: `خصم لأمر إنتاج ${locked.orderNumber}`,
              });
              deductionResults.push(
                `✓ تم خصم ${qty} من "${(item as any).materialName ?? `صنف #${inventoryId}`}"`,
              );
            }
          }

          const [up] = await tx
            .update(productionWorkflowOrdersTable)
            .set({
              workflowStatus: newStatus,
              warehouseManagerId: user.userId,
              warehouseManagerName: user.username,
              warehouseDecision: data.action,
              warehouseApprovedQty: data.approvedQty ?? null,
              warehouseComment: data.comment ?? null,
              warehouseDecidedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(productionWorkflowOrdersTable.id, id),
                eq(
                  productionWorkflowOrdersTable.workflowStatus,
                  "materials_requested",
                ),
              ),
            )
            .returning();
          if (!up)
            throw Object.assign(
              new Error("تم اتخاذ قرار المواد من جلسة أخرى"),
              { status: 409 },
            );
          await auditWorkflowTransition(
            tx,
            user,
            locked,
            up,
            "production_workflow.warehouse_action",
            data.comment,
          );
          return up;
        });

        const notifTitle = `موافقة على مواد أمر ${existing.orderNumber}${data.action === "partial" ? " (جزئية)" : ""}`;
        const notifBody =
          `مدير المخازن "${user.username}" وافق ${data.action === "partial" ? "جزئياً" : "كلياً"} على مواد "${existing.productName}".` +
          (data.comment ? `\nملاحظة: ${data.comment}` : "") +
          (deductionResults.length ? `\n${deductionResults.join("\n")}` : "");

        if (existing.supervisorId)
          await notifyUser(existing.supervisorId, {
            type: "workflow_materials_approved",
            title: notifTitle,
            body: notifBody,
            referenceType: "production_workflow",
            referenceId: id,
          });
        if (existing.receivedByUserId)
          await notifyUser(existing.receivedByUserId, {
            type: "workflow_materials_approved",
            title: `تم منح إذن أمر الإنتاج ${existing.orderNumber}`,
            body: notifBody,
            referenceType: "production_workflow",
            referenceId: id,
          });
        await notifyRole("chairman", {
          type: "workflow_materials_approved",
          title: notifTitle,
          body: notifBody,
          referenceType: "production_workflow",
          referenceId: id,
        });

        res.json({
          message: `تمت الموافقة ${data.action === "partial" ? "الجزئية" : "الكاملة"} وخصم المواد من المخزون.`,
          data: updated,
        });
      } else {
        assertProductionTransition(
          existing.workflowStatus,
          "materials_rejected",
        );
        const updated = await db.transaction(async (tx) => {
          const locked = await lockWorkflowOrder(tx, id);
          if (!locked)
            throw Object.assign(new Error("الأمر غير موجود"), { status: 404 });
          if (locked.workflowStatus !== "materials_requested") {
            throw Object.assign(
              new Error("تم اتخاذ قرار المواد من جلسة أخرى"),
              { status: 409 },
            );
          }
          const [up] = await tx
            .update(productionWorkflowOrdersTable)
            .set({
              workflowStatus: "materials_rejected",
              warehouseManagerId: user.userId,
              warehouseManagerName: user.username,
              warehouseDecision: "reject",
              warehouseComment: data.comment ?? null,
              warehouseDecidedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(productionWorkflowOrdersTable.id, id),
                eq(
                  productionWorkflowOrdersTable.workflowStatus,
                  "materials_requested",
                ),
              ),
            )
            .returning();
          if (!up)
            throw Object.assign(
              new Error("تم اتخاذ قرار المواد من جلسة أخرى"),
              { status: 409 },
            );
          await auditWorkflowTransition(
            tx,
            user,
            locked,
            up,
            "production_workflow.warehouse_action",
            data.comment,
          );
          return up;
        });

        const notifTitle = `رفض مواد أمر ${existing.orderNumber}`;
        const notifBody = `مدير المخازن "${user.username}" رفض طلب المواد لأمر "${existing.productName}".${data.comment ? `\nسبب الرفض: ${data.comment}` : ""}`;
        if (existing.supervisorId)
          await notifyUser(existing.supervisorId, {
            type: "workflow_materials_rejected",
            title: notifTitle,
            body: notifBody,
            referenceType: "production_workflow",
            referenceId: id,
          });
        if (existing.receivedByUserId)
          await notifyUser(existing.receivedByUserId, {
            type: "workflow_materials_rejected",
            title: notifTitle,
            body: notifBody,
            referenceType: "production_workflow",
            referenceId: id,
          });
        await notifyRole("chairman", {
          type: "workflow_materials_rejected",
          title: notifTitle,
          body: notifBody,
          referenceType: "production_workflow",
          referenceId: id,
        });

        res.json({
          message: "تم رفض طلب المواد. تم إشعار مشرف الإنتاج.",
          data: updated,
        });
      }
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /production-workflow/:id/dispatch — مدير الإنتاج يرسل الأمر المعتمد للمشرف ومراقب الجودة
// (تعيينهم تم بالفعل في خطوة الاستلام /receive — هنا مجرد إرسال/تفعيل، بدون أي بيانات جديدة)
router.patch(
  "/production-workflow/:id/dispatch",
  requireAuth,
  requireRole(
    "production_manager",
    "production_controller",
    "operations_manager",
    "executive_manager",
    "chairman",
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const user = req.user!;

      const [existing] = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(eq(productionWorkflowOrdersTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "الأمر غير موجود" } });
        return;
      }
      if (
        !["materials_approved", "materials_partial"].includes(
          existing.workflowStatus,
        )
      ) {
        res.status(409).json({
          error: {
            message: `لا يمكن إرسال الأمر — الأمر في حالة: "${workflowStatusLabel(existing.workflowStatus)}"`,
          },
        });
        return;
      }

      assertProductionTransition(existing.workflowStatus, "in_production");
      const updated = await db.transaction(async (tx) => {
        const locked = await lockWorkflowOrder(tx, id);
        if (!locked)
          throw Object.assign(new Error("الأمر غير موجود"), { status: 404 });
        if (
          !["materials_approved", "materials_partial"].includes(
            locked.workflowStatus,
          )
        ) {
          throw Object.assign(new Error("تم إرسال الأمر من جلسة أخرى"), {
            status: 409,
          });
        }
        assertProductionTransition(locked.workflowStatus, "in_production");
        const [up] = await tx
          .update(productionWorkflowOrdersTable)
          .set({
            workflowStatus: "in_production",
            teamAssignedAt: new Date(),
            qualityStatus: "pending",
            currentStage: "line_setup",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(productionWorkflowOrdersTable.id, id),
              sql`${productionWorkflowOrdersTable.workflowStatus} in ('materials_approved', 'materials_partial')`,
            ),
          )
          .returning();
        if (!up)
          throw Object.assign(new Error("تم إرسال الأمر من جلسة أخرى"), {
            status: 409,
          });
        await auditWorkflowTransition(
          tx,
          user,
          locked,
          up,
          "production_workflow.dispatch",
        );
        return up;
      });

      if (existing.supervisorId) {
        await notifyUser(existing.supervisorId, {
          type: "workflow_dispatched",
          title: `أمر إنتاج جاهز للتنفيذ ${existing.orderNumber}`,
          body: `تم اعتماد المواد — ابدأ تنفيذ "${existing.productName}" (${existing.qty} ${existing.unit}) رقم ${existing.orderNumber}.`,
          referenceType: "production_workflow",
          referenceId: id,
        });
      }
      if (existing.qualityControllerUserId) {
        await notifyUser(existing.qualityControllerUserId, {
          type: "workflow_quality_assigned",
          title: `تكليف بمتابعة أمر الإنتاج ${existing.orderNumber}`,
          body: `تم تكليفك بمتابعة جودة "${existing.productName}" — رقم ${existing.orderNumber}.`,
          referenceType: "production_workflow",
          referenceId: id,
        });
      }
      await notifyRole("chairman", {
        type: "workflow_in_production",
        title: `بدء تنفيذ أمر الإنتاج ${existing.orderNumber}`,
        body: `بدأ تنفيذ "${existing.productName}" — المشرف: ${existing.supervisorName}، مراقب الجودة: ${existing.qualityControllerName}.`,
        referenceType: "production_workflow",
        referenceId: id,
      });
      await notifyPortalWorkflowStatus(existing, {
        type: "workflow_in_production",
        title: `بدأ تصنيع طلبك — ${existing.orderNumber}`,
        body: `بدأ تصنيع "${existing.productName}" لطلبك رقم ${existing.orderNumber}.`,
      });

      res.json({
        message: "تم إرسال أمر الإنتاج للمشرف ومراقب الجودة.",
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ✅ مراحل الإنتاج الفرعية — يعلّم عليها المشرف بالترتيب، وآخر مرحلة تنقل الحالة تلقائيًا لفحص الجودة
const PRODUCTION_STAGES = [
  "line_setup",
  "manufacturing",
  "assembly_packing",
  "ready_for_quality",
] as const;
const STAGE_LABELS: Record<string, string> = {
  line_setup: "تجهيز الخط",
  manufacturing: "تصنيع فعلي",
  assembly_packing: "تجميع/تغليف",
  ready_for_quality: "جاهز لفحص الجودة",
};

router.patch(
  "/production-workflow/:id/advance-stage",
  requireAuth,
  requireRole(
    "supervisor",
    "production_manager",
    "operations_manager",
    "executive_manager",
    "chairman",
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const user = req.user!;
      const [existing] = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(eq(productionWorkflowOrdersTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "الأمر غير موجود" } });
        return;
      }
      if (existing.workflowStatus !== "in_production") {
        res.status(409).json({
          error: {
            message: `لا يمكن تحديث المرحلة — الأمر في حالة: "${workflowStatusLabel(existing.workflowStatus)}"`,
          },
        });
        return;
      }

      const currentIdx = PRODUCTION_STAGES.indexOf(
        (existing.currentStage as any) || "line_setup",
      );
      const nextIdx = currentIdx + 1;
      if (nextIdx >= PRODUCTION_STAGES.length) {
        res
          .status(400)
          .json({ error: { message: "الأمر وصل بالفعل لآخر مرحلة" } });
        return;
      }
      const nextStage = PRODUCTION_STAGES[nextIdx];
      const isLast = nextStage === "ready_for_quality";

      const updated = await db.transaction(async (tx) => {
        const locked = await lockWorkflowOrder(tx, id);
        if (!locked)
          throw Object.assign(new Error("الأمر غير موجود"), { status: 404 });
        if (locked.workflowStatus !== "in_production") {
          throw Object.assign(new Error("تم تحديث المرحلة من جلسة أخرى"), {
            status: 409,
          });
        }
        const lockedCurrentIdx = PRODUCTION_STAGES.indexOf(
          (locked.currentStage as any) || "line_setup",
        );
        const lockedNextStage = PRODUCTION_STAGES[lockedCurrentIdx + 1];
        if (!lockedNextStage)
          throw Object.assign(new Error("الأمر وصل بالفعل لآخر مرحلة"), {
            status: 409,
          });
        const [up] = await tx
          .update(productionWorkflowOrdersTable)
          .set({
            currentStage: lockedNextStage,
            workflowStatus:
              lockedNextStage === "ready_for_quality" ? "quality_check" : (
                locked.workflowStatus
              ),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(productionWorkflowOrdersTable.id, id),
              eq(productionWorkflowOrdersTable.workflowStatus, "in_production"),
              eq(
                productionWorkflowOrdersTable.currentStage,
                locked.currentStage ?? "line_setup",
              ),
            ),
          )
          .returning();
        if (!up)
          throw Object.assign(new Error("تم تحديث المرحلة من جلسة أخرى"), {
            status: 409,
          });
        await auditWorkflowTransition(
          tx,
          user,
          locked,
          up,
          "production_workflow.advance_stage",
        );
        return up;
      });

      if (isLast && existing.qualityControllerUserId) {
        await notifyUser(existing.qualityControllerUserId, {
          type: "workflow_ready_for_quality",
          title: `جاهز لفحص الجودة — أمر ${existing.orderNumber}`,
          body: `أمر الإنتاج "${existing.productName}" رقم ${existing.orderNumber} جاهز لفحص الجودة الآن.`,
          referenceType: "production_workflow",
          referenceId: id,
        });
      }

      res.json({
        message: `تم الانتقال لمرحلة: ${STAGE_LABELS[nextStage]}`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /production-workflow/:id/quality-done
router.patch(
  "/production-workflow/:id/quality-done",
  requireAuth,
  requireRole(
    "quality_controller",
    "production_quality_controller",
    "quality_engineer",
    "supervisor",
    "operations_manager",
    "executive_manager",
    "chairman",
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const data = qualityDoneSchema.parse(req.body);
      const user = req.user!;

      const [existing] = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(eq(productionWorkflowOrdersTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "الأمر غير موجود" } });
        return;
      }
      if (
        !["in_production", "quality_check"].includes(existing.workflowStatus)
      ) {
        res.status(409).json({
          error: {
            message: `لا يمكن تحديث الجودة — الأمر في حالة: "${workflowStatusLabel(existing.workflowStatus)}"`,
          },
        });
        return;
      }

      const newStatus =
        data.qualityStatus === "passed" ? "completed" : "quality_check";
      assertProductionTransition(existing.workflowStatus, newStatus);
      const updated = await db.transaction(async (tx) => {
        const locked = await lockWorkflowOrder(tx, id);
        if (!locked)
          throw Object.assign(new Error("الأمر غير موجود"), { status: 404 });
        if (
          !["in_production", "quality_check"].includes(locked.workflowStatus)
        ) {
          throw Object.assign(new Error("تم تسجيل قرار الجودة من جلسة أخرى"), {
            status: 409,
          });
        }
        const lockedNewStatus =
          data.qualityStatus === "passed" ? "completed" : "quality_check";
        assertProductionTransition(locked.workflowStatus, lockedNewStatus);
        const [up] = await tx
          .update(productionWorkflowOrdersTable)
          .set({
            workflowStatus: lockedNewStatus,
            qualityStatus: data.qualityStatus,
            qualityNotes: data.qualityNotes ?? null,
            qualityDoneAt: new Date(),
            qualityReportedById: user.userId,
            qualityReportedByName: user.username,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(productionWorkflowOrdersTable.id, id),
              eq(
                productionWorkflowOrdersTable.workflowStatus,
                locked.workflowStatus,
              ),
            ),
          )
          .returning();
        if (!up)
          throw Object.assign(new Error("تم تسجيل قرار الجودة من جلسة أخرى"), {
            status: 409,
          });
        await tx.insert(qualityRecordsTable).values({
          workflowOrderId: id,
          orderNumber: locked.orderNumber,
          productionLine: locked.productionLine,
          supervisorId: locked.supervisorId,
          supervisorName: locked.supervisorName,
          qualityStatus: data.qualityStatus,
          qualityNotes: data.qualityNotes ?? null,
          performanceRating: data.performanceRating ?? null,
          sampleSize: data.sampleSize ?? null,
          samplePassedCount: data.samplePassedCount ?? null,
          sampleFailedCount: data.sampleFailedCount ?? null,
          defectTags: data.defectTags ?? [],
          checklist: data.checklist ?? [],
          recordedById: user.userId,
          recordedByName: user.username,
        });
        await auditWorkflowTransition(
          tx,
          user,
          locked,
          up,
          "production_workflow.quality_done",
          data.qualityNotes,
        );
        return up;
      });

      if (data.qualityStatus === "passed") {
        // ✅ اكتمال الأمر: إشعار للمشرف ومراقب الجودة بالانتهاء، وإشعاران لمدير الإنتاج
        if (existing.supervisorId) {
          await notifyUser(existing.supervisorId, {
            type: "workflow_completed",
            title: `اكتمال أمر الإنتاج ${existing.orderNumber}`,
            body: `تم اكتمال إنتاج "${existing.productName}" رقم ${existing.orderNumber} بنجاح.`,
            referenceType: "production_workflow",
            referenceId: id,
          });
        }
        if (existing.qualityControllerUserId) {
          await notifyUser(existing.qualityControllerUserId, {
            type: "workflow_completed",
            title: `اكتمال أمر الإنتاج ${existing.orderNumber}`,
            body: `تم تسجيل اكتمال "${existing.productName}" رقم ${existing.orderNumber}.`,
            referenceType: "production_workflow",
            referenceId: id,
          });
        }
        if (existing.receivedByUserId) {
          await notifyUser(existing.receivedByUserId, {
            type: "workflow_completed",
            title: `اكتمال أمر الإنتاج ${existing.orderNumber}`,
            body: `مراقب الجودة "${user.username}" أبلغ باكتمال إنتاج "${existing.productName}" (${existing.qty} ${existing.unit}). يرجى اتخاذ قرار التسليم.`,
            referenceType: "production_workflow",
            referenceId: id,
          });
        }
        await notifyRole("warehouse_manager", {
          type: "workflow_completed",
          title: `اكتمال أمر الإنتاج ${existing.orderNumber}`,
          body: `مراقب الجودة "${user.username}" أبلغ باكتمال إنتاج "${existing.productName}" (${existing.qty} ${existing.unit}). يرجى اتخاذ قرار التسليم.`,
          referenceType: "production_workflow",
          referenceId: id,
        });
        await notifyRole("chairman", {
          type: "workflow_completed",
          title: `اكتمال أمر الإنتاج ${existing.orderNumber}`,
          body: `تم اكتمال إنتاج "${existing.productName}" وجاهز للتسليم.`,
          referenceType: "production_workflow",
          referenceId: id,
        });
        await notifyPortalWorkflowStatus(existing, {
          type: "workflow_quality_passed",
          title: `اجتاز طلبك فحص الجودة — ${existing.orderNumber}`,
          body: `اكتمل تصنيع "${existing.productName}" واجتاز فحص الجودة، وأصبح جاهزًا للتسليم.`,
        });
        sendPortalCriticalAlert(
          existing,
          `طلبك في Hyper-Tech جاهز للتسليم: ${existing.productName} (${existing.orderNumber}). تابع التفاصيل من بوابة العملاء.`,
          "portal_order_ready_for_delivery",
        );
      } else if (existing.supervisorId) {
        await notifyUser(existing.supervisorId, {
          type: "workflow_quality_failed",
          title: `فشل فحص الجودة — أمر ${existing.orderNumber}`,
          body: `مراقب الجودة "${user.username}" أبلغ عن مشكلة في جودة "${existing.productName}".\nملاحظات: ${data.qualityNotes ?? "—"}`,
          referenceType: "production_workflow",
          referenceId: id,
        });
      }
      if (data.qualityStatus !== "passed") {
        await notifyPortalWorkflowStatus(existing, {
          type: "workflow_quality_failed",
          title: `مراجعة جودة مطلوبة — ${existing.orderNumber}`,
          body: `تحتاج جودة "${existing.productName}" إلى مراجعة قبل استكمال طلبك.`,
        });
      }

      res.json({
        message:
          data.qualityStatus === "passed" ?
            "تم إبلاغ مدير الإنتاج باكتمال أمر الإنتاج."
          : "تم تسجيل ملاحظات الجودة.",
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /production-workflow/:id/deliver
// ✅ تعديل: التسليم بقى بخطوتين — هنا بس بيحدّد نية التسليم (لعميل/لمخزن) ويبعتها
// لصاحب القرار الفعلي (الاتش آر أو مدير المخازن) عشان يأكّد الاستلام هو نفسه.
// الحالة النهائية delivered_* والتأثير الفعلي على المخزون بيحصلوا بس عند التأكيد
// (endpoint /confirm-delivery تحت)، مش هنا.
router.patch(
  "/production-workflow/:id/deliver",
  requireAuth,
  requireRole(
    "production_manager",
    "operations_manager",
    "executive_manager",
    "chairman",
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const data = deliverProductSchema.parse(req.body);
      const user = req.user!;

      const [existing] = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(eq(productionWorkflowOrdersTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "الأمر غير موجود" } });
        return;
      }
      if (existing.workflowStatus !== "completed") {
        res.status(409).json({
          error: {
            message: `لا يمكن التسليم — الأمر في حالة: "${workflowStatusLabel(existing.workflowStatus)}"`,
          },
        });
        return;
      }

      const newStatus =
        data.deliveryType === "customer" ?
          "delivery_pending_customer"
        : "delivery_pending_warehouse";
      assertProductionTransition(existing.workflowStatus, newStatus);

      const updated = await db.transaction(async (tx) => {
        const locked = await lockWorkflowOrder(tx, id);
        if (!locked)
          throw Object.assign(new Error("الأمر غير موجود"), { status: 404 });
        if (locked.workflowStatus !== "completed") {
          throw Object.assign(new Error("تم بدء التسليم من جلسة أخرى"), {
            status: 409,
          });
        }
        const [up] = await tx
          .update(productionWorkflowOrdersTable)
          .set({
            workflowStatus: newStatus,
            deliveryType: data.deliveryType,
            deliveryNotes: data.deliveryNotes ?? null,
            pendingDeliveryInventoryItemId:
              data.deliveryType === "warehouse" ?
                (data.inventoryItemId ?? null)
              : null,
            pendingDeliveryAddToInventory:
              data.deliveryType === "warehouse" ? !!data.addToInventory : false,
            deliveryInitiatedById: user.userId,
            deliveryInitiatedByName: user.username,
            deliveryInitiatedAt: new Date(),
            endDate: data.endDate ?? locked.endDate,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(productionWorkflowOrdersTable.id, id),
              eq(productionWorkflowOrdersTable.workflowStatus, "completed"),
            ),
          )
          .returning();
        if (!up)
          throw Object.assign(new Error("تم بدء التسليم من جلسة أخرى"), {
            status: 409,
          });
        await auditWorkflowTransition(
          tx,
          user,
          locked,
          up,
          "production_workflow.deliver",
        );
        return up;
      });

      if (data.deliveryType === "customer") {
        await notifyRole("hr", {
          type: "workflow_delivery_pending",
          title: `طلب تسليم للعميل — أمر ${existing.orderNumber}`,
          body: `أمر الإنتاج "${existing.productName}" (${existing.qty} ${existing.unit}) جاهز للتسليم للعميل "${existing.customerName ?? "—"}". يرجى تأكيد التسليم.`,
          referenceType: "production_workflow",
          referenceId: id,
        });
      } else {
        await notifyRole("warehouse_manager", {
          type: "workflow_delivery_pending",
          title: `طلب استلام مخزن — أمر ${existing.orderNumber}`,
          body: `أمر الإنتاج "${existing.productName}" (${existing.qty} ${existing.unit}) جاهز للاستلام في المخزن. يرجى تأكيد الاستلام.`,
          referenceType: "production_workflow",
          referenceId: id,
        });
      }
      await notifyRole("chairman", {
        type: "workflow_delivery_pending",
        title: `تسليم قيد التأكيد — أمر ${existing.orderNumber}`,
        body: `${user.username} بدأ إجراء ${data.deliveryType === "customer" ? "التسليم للعميل" : "التسليم للمخزن"} لأمر "${existing.productName}" — بانتظار تأكيد ${data.deliveryType === "customer" ? "الاتش آر" : "مدير المخازن"}.`,
        referenceType: "production_workflow",
        referenceId: id,
      });
      await notifyPortalWorkflowStatus(existing, {
        type: "workflow_delivery_pending",
        title: `طلبك جاهز للتسليم — ${existing.orderNumber}`,
        body: `اكتمل تجهيز "${existing.productName}"، ويجري الآن ترتيب التسليم.`,
      });

      res.json({
        message: `تم إرسال طلب ${data.deliveryType === "customer" ? "التسليم للعميل إلى الاتش آر" : "الاستلام إلى مدير المخازن"} لتأكيده.`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /production-workflow/:id/confirm-delivery
// ✅ خطوة التأكيد الفعلية: الاتش آر يأكّد التسليم للعميل، أو مدير المخازن يأكّد الاستلام
// (وهنا بس بيتضاف للمخزون فعليًا لو مطلوب، مش وقت بدء الطلب)
router.patch(
  "/production-workflow/:id/confirm-delivery",
  requireAuth,
  requireRole(
    "hr",
    "hr_manager",
    "warehouse_manager",
    "storekeeper",
    "operations_manager",
    "executive_manager",
    "chairman",
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const user = req.user!;

      const [existing] = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(eq(productionWorkflowOrdersTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "الأمر غير موجود" } });
        return;
      }

      if (
        existing.workflowStatus === "delivery_pending_customer" &&
        !["hr", "hr_manager", "executive_manager", "chairman"].includes(
          user.role,
        )
      ) {
        res.status(403).json({
          error: { message: "تأكيد التسليم للعميل من صلاحية الاتش آر فقط" },
        });
        return;
      }
      if (
        existing.workflowStatus === "delivery_pending_warehouse" &&
        ![
          "warehouse_manager",
          "storekeeper",
          "operations_manager",
          "executive_manager",
          "chairman",
        ].includes(user.role)
      ) {
        res.status(403).json({
          error: { message: "تأكيد الاستلام من صلاحية مدير المخازن فقط" },
        });
        return;
      }
      if (
        !["delivery_pending_customer", "delivery_pending_warehouse"].includes(
          existing.workflowStatus,
        )
      ) {
        res.status(409).json({
          error: {
            message: `لا يوجد تسليم بانتظار التأكيد — الأمر في حالة: "${workflowStatusLabel(existing.workflowStatus)}"`,
          },
        });
        return;
      }

      const newStatus =
        existing.workflowStatus === "delivery_pending_customer" ?
          "delivered_customer"
        : "delivered_warehouse";
      assertProductionTransition(existing.workflowStatus, newStatus);

      const updated = await db.transaction(async (tx) => {
        const locked = await lockWorkflowOrder(tx, id);
        if (!locked)
          throw Object.assign(new Error("الأمر غير موجود"), { status: 404 });
        if (
          !["delivery_pending_customer", "delivery_pending_warehouse"].includes(
            locked.workflowStatus,
          )
        ) {
          throw Object.assign(new Error("تم تأكيد التسليم من جلسة أخرى"), {
            status: 409,
          });
        }
        const lockedNewStatus =
          locked.workflowStatus === "delivery_pending_customer" ?
            "delivered_customer"
          : "delivered_warehouse";
        if (
          locked.workflowStatus === "delivery_pending_warehouse" &&
          locked.pendingDeliveryAddToInventory &&
          locked.pendingDeliveryInventoryItemId
        ) {
          await applyStockMovement(tx, {
            inventoryItemId: locked.pendingDeliveryInventoryItemId,
            movementType: "in",
            qty: locked.qty,
            referenceType: "production",
            referenceId: id,
            notes: `إضافة من أمر إنتاج ${locked.orderNumber} (تأكيد استلام المخزن)`,
          });
        }
        const [up] = await tx
          .update(productionWorkflowOrdersTable)
          .set({
            workflowStatus: lockedNewStatus,
            deliveredAt: new Date(),
            deliveredById: user.userId,
            deliveredByName: user.username,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(productionWorkflowOrdersTable.id, id),
              eq(
                productionWorkflowOrdersTable.workflowStatus,
                locked.workflowStatus,
              ),
            ),
          )
          .returning();
        if (!up)
          throw Object.assign(new Error("تم تأكيد التسليم من جلسة أخرى"), {
            status: 409,
          });
        await auditWorkflowTransition(
          tx,
          user,
          locked,
          up,
          "production_workflow.confirm_delivery",
        );
        return up;
      });

      const deliveryDesc =
        newStatus === "delivered_customer" ?
          `تسليم للعميل "${existing.customerName ?? "غير محدد"}"`
        : "تسليم للمخزن";

      await notifyRole("chairman", {
        type: "workflow_delivered",
        title: `اكتمال دورة الإنتاج — أمر ${existing.orderNumber}`,
        body: `✅ اكتملت دورة الإنتاج لأمر "${existing.productName}" (${existing.qty} ${existing.unit}) — تم تأكيد ${deliveryDesc}.\nأكّده: ${user.username}`,
        referenceType: "production_workflow",
        referenceId: id,
      });
      if (existing.deliveryInitiatedById) {
        await notifyUser(existing.deliveryInitiatedById, {
          type: "workflow_delivered",
          title: `تم تأكيد التسليم — أمر ${existing.orderNumber}`,
          body: `تم تأكيد ${deliveryDesc} لأمر الإنتاج "${existing.productName}" بواسطة "${user.username}".`,
          referenceType: "production_workflow",
          referenceId: id,
        });
      }
      if (existing.supervisorId) {
        await notifyUser(existing.supervisorId, {
          type: "workflow_delivered",
          title: `تسليم أمر الإنتاج ${existing.orderNumber}`,
          body: `تم تأكيد ${deliveryDesc} لأمر الإنتاج "${existing.productName}" الذي أشرفت عليه.`,
          referenceType: "production_workflow",
          referenceId: id,
        });
      }
      await notifyPortalWorkflowStatus(existing, {
        type:
          newStatus === "delivered_customer" ? "workflow_delivered" : (
            "workflow_delivered_warehouse"
          ),
        title:
          newStatus === "delivered_customer" ?
            `تم تسليم طلبك — ${existing.orderNumber}`
          : `تم تحديث طلبك — ${existing.orderNumber}`,
        body:
          newStatus === "delivered_customer" ?
            `تم تأكيد تسليم "${existing.productName}" للعميل.`
          : `تم تأكيد استلام "${existing.productName}" في المخزن.`,
      });

      res.json({
        message: `تم تأكيد ${deliveryDesc} بنجاح. اكتملت دورة الإنتاج.`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /production-workflow/:id/cancel
router.patch(
  "/production-workflow/:id/cancel",
  requireAuth,
  requirePermission("productionWorkflow.cancel"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const user = req.user!;

      const [existing] = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .where(eq(productionWorkflowOrdersTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "الأمر غير موجود" } });
        return;
      }
      if (
        ["delivered_customer", "delivered_warehouse", "cancelled"].includes(
          existing.workflowStatus,
        )
      ) {
        res.status(409).json({
          error: {
            message: `لا يمكن إلغاء الأمر — حالته: "${workflowStatusLabel(existing.workflowStatus)}"`,
          },
        });
        return;
      }

      // ✅ إصلاح حرج: لو الأمر كان وصل لمرحلة خصم مواد فعلي من المخزون
      // (materials_approved / materials_partial أو أي مرحلة بعدها)، الإلغاء
      // كان بيوقف الأمر من غير ما يرجّع أي كمية للمخزون — يعني المخزون
      // يفضل ناقص فعليًا من غير أي أثر إنه اتلغى. الحل: نرجع لسجل حركات
      // المخزون الحقيقي المرتبط بالأمر ده (referenceType="production")
      // ونعكس كل حركة "خصم" لسه ماترجعتش، جوه نفس الـ transaction.
      const updated = await db.transaction(async (tx) => {
        const locked = await lockWorkflowOrder(tx, id);
        if (!locked)
          throw Object.assign(new Error("الأمر غير موجود"), { status: 404 });
        if (
          ["delivered_customer", "delivered_warehouse", "cancelled"].includes(
            locked.workflowStatus,
          )
        ) {
          throw Object.assign(
            new Error("تم إلغاء الأمر أو إغلاقه من جلسة أخرى"),
            { status: 409 },
          );
        }
        assertProductionTransition(locked.workflowStatus, "cancelled");
        const priorDeductions = await tx
          .select()
          .from(stockMovementsTable)
          .where(
            and(
              eq(stockMovementsTable.referenceType, "production"),
              eq(stockMovementsTable.referenceId, id),
              eq(stockMovementsTable.movementType, "out"),
            ),
          );

        for (const mv of priorDeductions) {
          await applyStockMovement(tx, {
            inventoryItemId: mv.inventoryItemId,
            movementType: "in",
            qty: mv.qty,
            referenceType: "production",
            referenceId: id,
            notes: `إرجاع مخزون بسبب إلغاء أمر إنتاج ${locked.orderNumber}`,
          });
        }

        const [up] = await tx
          .update(productionWorkflowOrdersTable)
          .set({ workflowStatus: "cancelled", updatedAt: new Date() })
          .where(
            and(
              eq(productionWorkflowOrdersTable.id, id),
              eq(
                productionWorkflowOrdersTable.workflowStatus,
                locked.workflowStatus,
              ),
            ),
          )
          .returning();
        if (!up)
          throw Object.assign(new Error("تم إلغاء الأمر من جلسة أخرى"), {
            status: 409,
          });
        await auditWorkflowTransition(
          tx,
          user,
          locked,
          up,
          "production_workflow.cancel",
        );
        return up;
      });

      await notifyRoles(
        ["chairman", "production_manager", "warehouse_manager", "supervisor"],
        {
          type: "workflow_cancelled",
          title: `إلغاء أمر الإنتاج ${existing.orderNumber}`,
          body: `تم إلغاء أمر الإنتاج "${existing.productName}" رقم ${existing.orderNumber} بواسطة "${user.username}".`,
          referenceType: "production_workflow",
          referenceId: id,
        },
      );
      await notifyPortalWorkflowStatus(existing, {
        type: "workflow_cancelled",
        title: `تم إلغاء طلبك — ${existing.orderNumber}`,
        body: `تم إلغاء طلب "${existing.productName}". تواصل مع خدمة العملاء لمعرفة التفاصيل.`,
      });

      res.json({
        message:
          "تم إلغاء أمر الإنتاج وإرجاع أي مواد كانت اتخصمت له إلى المخزون.",
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
