/** @format */

import { Router, Request, Response, NextFunction } from "express";
import { eq, desc, sql, and } from "drizzle-orm";
import { db } from "../db";
import {
  productionRequestsTable,
  productionWorkflowOrdersTable,
  bomRecipesTable,
  createProductionRequestSchema,
  warehouseActionSchema,
  directorActionSchema,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { notifyRole, notifyUser, notifyRoles } from "../lib/notifications";
import { generateWorkflowOrderNumber } from "./production-workflow";
import { writeAuditEvent } from "../lib/governance";

const router = Router();

// ✅ إصلاح race condition: advisory lock يمنع توليد رقمين متعارضين في وقت واحد
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function generateRequestNumber(tx: Transaction): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `PR-${yy}${mm}`;

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`prod_request_${yy}${mm}`}))`,
  );

  const [row] = await tx
    .select({ num: productionRequestsTable.requestNumber })
    .from(productionRequestsTable)
    .where(sql`${productionRequestsTable.requestNumber} LIKE ${prefix + "-%"}`)
    .orderBy(desc(productionRequestsTable.createdAt))
    .limit(1);

  const seq =
    row ? (parseInt(row.num.split("-").pop() ?? "0", 10) || 0) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

// POST /api/v1/production-requests
router.post(
  "/production-requests",
  requireAuth,
  requireRole("supervisor", "production_manager", "chairman"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createProductionRequestSchema.parse(req.body);
      const user = req.user!;
      const [recipe] = await db
        .select({ id: bomRecipesTable.id, productName: bomRecipesTable.productName, isActive: bomRecipesTable.isActive })
        .from(bomRecipesTable)
        .where(eq(bomRecipesTable.id, data.bomRecipeId))
        .limit(1);
      if (!recipe || !recipe.isActive) {
        res.status(400).json({ error: { message: "وصفة التصنيع غير موجودة أو متوقفة" } });
        return;
      }

      // ✅ الإنشاء داخل transaction واحدة — الرقم + الصف atomic
      const request = await db.transaction(async (tx) => {
        const requestNumber = await generateRequestNumber(tx);
        const [inserted] = await tx
          .insert(productionRequestsTable)
          .values({
            requestNumber,
            requestedById: user.userId,
            requestedByName: user.username,
            productName: recipe.productName,
            bomRecipeId: recipe.id,
            requestedQty: data.requestedQty,
            unit: data.unit,
            neededBy: data.neededBy ?? null,
            reason: data.reason ?? null,
            priority: data.priority,
            status: "pending_warehouse",
            warehouseStatus: "pending",
            directorStatus: "pending",
          })
          .returning();
        return inserted;
      });

      const priorityLabel =
        data.priority === "urgent" ? "⚡ عاجل جداً"
        : data.priority === "high" ? "🔴 مرتفع"
        : data.priority === "normal" ? "🟡 عادي"
        : "🟢 منخفض";

      await notifyRole("production_manager", {
        type: "production_request_new",
        title: `طلب إنتاج جديد — ${priorityLabel}`,
        body: `المستخدم "${user.username}" طلب إنتاج "${recipe.productName}" بكمية ${data.requestedQty} ${data.unit}. الطلب رقم ${request.requestNumber} ينتظر موافقتك.`,
        referenceType: "production_request",
        referenceId: request.id,
      });

      await notifyRole("chairman", {
        type: "production_request_new",
        title: `طلب إنتاج للمراجعة — ${priorityLabel}`,
        body: `طلب إنتاج جديد رقم ${request.requestNumber}: "${recipe.productName}" كمية ${data.requestedQty} ${data.unit} من المستخدم "${user.username}".`,
        referenceType: "production_request",
        referenceId: request.id,
      });

      res.status(201).json({
        message: `تم إرسال طلب الإنتاج رقم ${request.requestNumber} بنجاح. في انتظار موافقة مدير المخازن.`,
        data: request,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/production-requests/recipes
router.get(
  "/production-requests/recipes",
  requireAuth,
  requireRole("chairman", "supervisor", "production_manager", "warehouse_manager", "storekeeper"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const recipes = await db
        .select({
          id: bomRecipesTable.id,
          productName: bomRecipesTable.productName,
          productCode: bomRecipesTable.productCode,
          outputQty: bomRecipesTable.outputQty,
        })
        .from(bomRecipesTable)
        .where(eq(bomRecipesTable.isActive, true))
        .orderBy(bomRecipesTable.productName);
      res.json({ data: recipes });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/production-requests
router.get(
  "/production-requests",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      let rows;

      if (user.role === "supervisor") {
        const result = await db
          .select({
            request: productionRequestsTable,
            workflowOrderNumber: productionWorkflowOrdersTable.orderNumber,
          })
          .from(productionRequestsTable)
          .leftJoin(
            productionWorkflowOrdersTable,
            eq(productionRequestsTable.workflowOrderId, productionWorkflowOrdersTable.id),
          )
          .where(eq(productionRequestsTable.requestedById, user.userId))
          .orderBy(desc(productionRequestsTable.createdAt));
        rows = result.map(({ request, workflowOrderNumber }) => ({
          ...request,
          workflowOrderNumber,
        }));
      } else {
        const result = await db
          .select({
            request: productionRequestsTable,
            workflowOrderNumber: productionWorkflowOrdersTable.orderNumber,
          })
          .from(productionRequestsTable)
          .leftJoin(
            productionWorkflowOrdersTable,
            eq(productionRequestsTable.workflowOrderId, productionWorkflowOrdersTable.id),
          )
          .orderBy(desc(productionRequestsTable.createdAt));
        rows = result.map(({ request, workflowOrderNumber }) => ({
          ...request,
          workflowOrderNumber,
        }));
      }

      const stats = {
        total: rows.length,
        pending_warehouse: rows.filter((r) => r.status === "pending_warehouse")
          .length,
        pending_director: rows.filter((r) => r.status === "pending_director")
          .length,
        approved: rows.filter((r) => r.status === "approved").length,
        partial_approved: rows.filter((r) => r.status === "partial_approved")
          .length,
        rejected: rows.filter((r) => r.status === "rejected").length,
      };

      res.json({ data: rows, stats });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/production-requests/:id
router.get(
  "/production-requests/:id",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;

      const [request] = await db
        .select()
        .from(productionRequestsTable)
        .where(eq(productionRequestsTable.id, id))
        .limit(1);

      if (!request) {
        res.status(404).json({ error: { message: "الطلب غير موجود" } });
        return;
      }

      if (user.role === "supervisor" && request.requestedById !== user.userId) {
        res
          .status(403)
          .json({ error: { message: "ليس لديك صلاحية لرؤية هذا الطلب" } });
        return;
      }

      res.json({ data: request });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/production-requests/:id/warehouse-action
router.patch(
  "/production-requests/:id/warehouse-action",
  requireAuth,
  requireRole("chairman", "warehouse_manager", "storekeeper"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const user = req.user!;
      const { action, approvedQty, comment } = warehouseActionSchema.parse(
        req.body,
      );

      const [existing] = await db
        .select()
        .from(productionRequestsTable)
        .where(eq(productionRequestsTable.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: { message: "الطلب غير موجود" } });
        return;
      }

      if (existing.status !== "pending_warehouse") {
        res
          .status(400)
          .json({
            error: {
              message: `لا يمكن اتخاذ إجراء — حالته: "${statusLabel(existing.status)}"`,
            },
          });
        return;
      }

      if (action === "partial" && Number(approvedQty) > Number(existing.requestedQty)) {
        res.status(400).json({ error: { message: "الكمية المعتمدة لا يمكن أن تتجاوز الكمية المطلوبة" } });
        return;
      }

      if (action === "partial" && !approvedQty) {
        res
          .status(400)
          .json({
            error: {
              message: "يجب تحديد الكمية المعتمدة عند الموافقة الجزئية",
            },
          });
        return;
      }
      if (action === "partial" && (!Number.isFinite(Number(approvedQty)) || Number(approvedQty) <= 0)) {
        res.status(400).json({ error: { message: "يجب أن تكون الكمية المعتمدة أكبر من صفر" } });
        return;
      }

      const newWarehouseStatus =
        action === "approve" ? "approved"
        : action === "partial" ? "partial"
        : "rejected";
      const newStatus = action === "reject" ? "rejected" : "pending_director";
      const finalQtyValue =
        action === "approve" ? existing.requestedQty
        : action === "partial" ? approvedQty!
        : "0";

      const [updated] = await db
        .update(productionRequestsTable)
        .set({
          warehouseStatus: newWarehouseStatus,
          warehouseComment: comment ?? null,
          warehouseActionById: user.userId,
          warehouseActionByName: user.username,
          warehouseActionAt: new Date(),
          approvedQty:
            action === "partial" ? approvedQty!
            : action === "approve" ? existing.requestedQty
            : "0",
          status: newStatus,
          finalQty: finalQtyValue,
          updatedAt: new Date(),
        })
        .where(eq(productionRequestsTable.id, id))
        .returning();

      const actionText =
        action === "approve" ?
          `✅ وافق على الكمية كاملة (${existing.requestedQty} ${existing.unit})`
        : action === "partial" ?
          `⚠️ وافق جزئياً — المعتمدة: ${approvedQty} من أصل ${existing.requestedQty} ${existing.unit}`
        : `❌ رفض الطلب`;

      await notifyUser(existing.requestedById, {
        type: "warehouse_action",
        title: `قرار مدير المخازن على طلبك ${existing.requestNumber}`,
        body: `مدير المخازن "${user.username}" ${actionText}${comment ? ` — ملاحظة: ${comment}` : ""}`,
        referenceType: "production_request",
        referenceId: id,
      });

      await notifyRole("production_manager", {
        type: "warehouse_action",
        title:
          action !== "reject" ?
            `طلب إنتاج ${existing.requestNumber} — ينتظر مراجعتك`
          : `طلب إنتاج ${existing.requestNumber} — مرفوض`,
        body: `مدير المخازن "${user.username}" ${actionText} على طلب "${existing.productName}"${comment ? ` — السبب: ${comment}` : ""}.`,
        referenceType: "production_request",
        referenceId: id,
      });

      res.json({ message: "تم تسجيل قرار مدير المخازن بنجاح", data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/production-requests/:id/director-action
router.patch(
  "/production-requests/:id/director-action",
  requireAuth,
  requireRole("chairman", "production_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const user = req.user!;
      const { action, overrideQty, comment } = directorActionSchema.parse(
        req.body,
      );

      const [existing] = await db
        .select()
        .from(productionRequestsTable)
        .where(eq(productionRequestsTable.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: { message: "الطلب غير موجود" } });
        return;
      }
      if (existing.status === "cancelled") {
        res
          .status(400)
          .json({ error: { message: "لا يمكن التعديل على طلب ملغي" } });
        return;
      }
      if (existing.status !== "pending_director") {
        res.status(409).json({
          error: { message: `لا يمكن اتخاذ قرار الإدارة — حالة الطلب: "${statusLabel(existing.status)}"` },
        });
        return;
      }
      if (action !== "noted" && !existing.bomRecipeId) {
        res.status(409).json({
          error: { message: "لا يمكن تحويل الطلب إلى دورة الإنتاج بدون وصفة تصنيع" },
        });
        return;
      }

      let newStatus = existing.status;
      let newFinalQty = existing.finalQty;

      if (action === "approve") {
        newStatus = "approved";
        newFinalQty = existing.approvedQty ?? existing.requestedQty;
      } else if (action === "override") {
        if (!overrideQty) {
          res
            .status(400)
            .json({ error: { message: "يجب تحديد الكمية عند التدخل" } });
          return;
        }
        if (!Number.isFinite(Number(overrideQty)) || Number(overrideQty) <= 0) {
          res.status(400).json({ error: { message: "يجب أن تكون الكمية المعتمدة أكبر من صفر" } });
          return;
        }
        newStatus =
          parseFloat(overrideQty) >= parseFloat(existing.requestedQty) ?
            "approved"
          : "partial_approved";
        newFinalQty = overrideQty;
      } else if (action === "reject") {
        newStatus = "rejected";
        newFinalQty = "0";
      } else {
        newStatus =
          existing.status === "pending_director" ?
            existing.warehouseStatus === "approved" ?
              "approved"
            : "partial_approved"
          : existing.status;
      }

      const result = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(productionRequestsTable)
          .where(and(
            eq(productionRequestsTable.id, id),
            eq(productionRequestsTable.status, "pending_director"),
          ))
          .for("update")
          .limit(1);
        if (!locked) {
          throw Object.assign(new Error("تم اتخاذ قرار الإدارة من جلسة أخرى"), { status: 409 });
        }

        if (action === "noted") {
          const [noted] = await tx
            .update(productionRequestsTable)
            .set({
              directorStatus: action,
              directorComment: comment ?? null,
              directorActionById: user.userId,
              directorActionByName: user.username,
              directorActionAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(productionRequestsTable.id, id))
            .returning();
          return { request: noted, workflowOrder: null };
        }

        const [updatedRequest] = await tx
          .update(productionRequestsTable)
          .set({
            directorStatus: action,
            directorComment: comment ?? null,
            directorActionById: user.userId,
            directorActionByName: user.username,
            directorActionAt: new Date(),
            directorOverrideQty: overrideQty ?? null,
            status: newStatus,
            finalQty: newFinalQty,
            updatedAt: new Date(),
          })
          .where(eq(productionRequestsTable.id, id))
          .returning();

        if (newStatus === "rejected") {
          return { request: updatedRequest, workflowOrder: null };
        }

        const [workflowOrder] = await tx
          .insert(productionWorkflowOrdersTable)
          .values({
            orderNumber: await generateWorkflowOrderNumber(tx),
            workflowStatus: "awaiting_operations_claim",
            productName: locked.productName,
            qty: newFinalQty ?? locked.requestedQty,
            unit: locked.unit,
            bomRecipeId: locked.bomRecipeId!,
            materialRequestId: locked.id,
            orderSource: "direct",
            orderDetails: locked.reason ?? null,
            customerName: "طلب إنتاج داخلي",
            priority: locked.priority,
            neededBy: locked.neededBy ?? new Date().toISOString().slice(0, 10),
            notes: comment ?? null,
            createdById: user.userId,
            createdByName: user.username,
          })
          .returning();

        const [linkedRequest] = await tx
          .update(productionRequestsTable)
          .set({ workflowOrderId: workflowOrder.id, updatedAt: new Date() })
          .where(eq(productionRequestsTable.id, id))
          .returning();

        await writeAuditEvent({
          executor: tx,
          actorUserId: user.userId,
          actorName: user.username,
          actionKey: "production_request.convert",
          resourceType: "production_request",
          resourceId: id,
          afterData: {
            requestStatus: linkedRequest.status,
            workflowOrderId: workflowOrder.id,
            workflowOrderNumber: workflowOrder.orderNumber,
          },
          reason: comment ?? null,
        });
        return { request: linkedRequest, workflowOrder };
      });

      const actionText =
        action === "approve" ? `✅ اعتمد الطلب`
        : action === "override" ?
          `🔄 عدّل الكمية إلى ${overrideQty} ${existing.unit}`
        : action === "reject" ? `❌ رفض الطلب`
        : `👁️ اطّلع على الطلب`;

      await notifyUser(existing.requestedById, {
        type: "director_action",
        title: `قرار الإدارة على طلبك ${existing.requestNumber}`,
        body: `المدير "${user.username}" ${actionText}${comment ? ` — ملاحظة: ${comment}` : ""}.`,
        referenceType: "production_request",
        referenceId: id,
      });
      if (result.workflowOrder) {
        await notifyRole("operations_manager", {
          type: "operations_line_awaiting_claim",
          title: `سطر إنتاج جديد ينتظر استلام مدير التشغيل — ${existing.requestNumber}`,
          body: `تم تحويل طلب "${existing.productName}" إلى أمر الإنتاج ${result.workflowOrder.orderNumber}، وهو ينتظر استلام مدير التشغيل.`,
          referenceType: "production_workflow",
          referenceId: result.workflowOrder.id,
        });
        await notifyRole("chairman", {
          type: "workflow_new_order",
          title: `بدء دورة الإنتاج — ${result.workflowOrder.orderNumber}`,
          body: `تم اعتماد طلب "${existing.productName}" وتحويله إلى دورة الإنتاج.`,
          referenceType: "production_workflow",
          referenceId: result.workflowOrder.id,
        });
      }

      res.json({
        message: result.workflowOrder
          ? `تم اعتماد الطلب وإنشاء أمر الإنتاج ${result.workflowOrder.orderNumber} وبدء الدورة.`
          : "تم تسجيل إحاطة الإدارة، وما زال الطلب بانتظار القرار النهائي.",
        data: result.request,
        workflowOrder: result.workflowOrder,
      });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/production-requests/:id/cancel
router.patch(
  "/production-requests/:id/cancel",
  requireAuth,
  requireRole("chairman", "production_manager", "supervisor"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const user = req.user!;

      const [existing] = await db
        .select()
        .from(productionRequestsTable)
        .where(eq(productionRequestsTable.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: { message: "الطلب غير موجود" } });
        return;
      }

      if (
        user.role === "supervisor" &&
        existing.requestedById !== user.userId
      ) {
        res.status(403).json({ error: { message: "يمكنك إلغاء طلباتك فقط" } });
        return;
      }

      if (
        ["approved", "partial_approved", "rejected", "cancelled"].includes(
          existing.status,
        )
      ) {
        res
          .status(400)
          .json({
            error: {
              message: `لا يمكن إلغاء الطلب — حالته: "${statusLabel(existing.status)}"`,
            },
          });
        return;
      }

      const [updated] = await db
        .update(productionRequestsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(productionRequestsTable.id, id))
        .returning();

      await notifyRoles(["production_manager", "warehouse_manager"], {
        type: "request_cancelled",
        title: `إلغاء طلب إنتاج ${existing.requestNumber}`,
        body: `المشرف "${user.username}" ألغى طلب "${existing.productName}" رقم ${existing.requestNumber}.`,
        referenceType: "production_request",
        referenceId: id,
      });

      res.json({ message: "تم إلغاء الطلب بنجاح", data: updated });
    } catch (err) {
      next(err);
    }
  },
);

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending_warehouse: "ينتظر مدير المخازن",
    pending_director: "ينتظر المدير",
    approved: "معتمد",
    partial_approved: "معتمد جزئياً",
    rejected: "مرفوض",
    cancelled: "ملغي",
  };
  return map[status] ?? status;
}

export default router;
