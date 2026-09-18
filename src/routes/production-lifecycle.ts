import { Router } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  operationsCaseLinesTable,
  operationsCasesTable,
  productionLegacyOrderMappingsTable,
  productionLifecycleAdjustmentsTable,
  productionTransitionEventsTable,
  productionWorkflowOrdersTable,
  systemUsersTable,
} from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import {
  CANONICAL_PRODUCTION_STATUSES,
  CANONICAL_PRODUCTION_TRANSITIONS,
  buildProductionOrderSnapshot,
  findProductionConformanceIssues,
  hashProductionSnapshot,
  lifecycleGates,
  type CanonicalProductionStatus,
} from "../domain/production-lifecycle";
import { transitionCanonicalProductionOrder } from "../lib/production-lifecycle-transition";
import { recordProductionTransitionEvent } from "../lib/production-lifecycle";
import { generateWorkflowOrderNumber } from "./production-workflow";
import {
  addDecimalQuantities,
  compareDecimalQuantities,
  isPositiveDecimalQuantity,
  subtractDecimalQuantities,
} from "../lib/decimal-quantity";

const router = Router();
const lifecycleRoles = [
  "chairman",
  "executive_manager",
  "operations_manager",
  "production_manager",
  "production_controller",
  "supervisor",
  "production_quality_controller",
  "warehouse_manager",
] as const;

const transitionSchema = z.object({
  targetStatus: z.enum(CANONICAL_PRODUCTION_STATUSES),
  reason: z.string().max(1000).optional().nullable(),
  evidence: z.unknown().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

const adjustmentSchema = z.object({
  quantity: z.string().optional(),
  reason: z.string().min(3, "سبب الإجراء مطلوب"),
  evidence: z.unknown().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

function assertLifecycleRole(role: string, target: CanonicalProductionStatus) {
  const allowed =
    target === "cancelled"
      ? ["chairman", "executive_manager", "production_manager", "supervisor"]
      : target === "closed"
        ? ["chairman", "executive_manager", "production_manager"]
        : target === "corrected"
          ? ["chairman", "executive_manager", "production_manager", "quality_engineer"]
          : lifecycleRoles;
  if (!(allowed as readonly string[]).includes(role)) {
    throw Object.assign(new Error("ليس لديك صلاحية لهذا الانتقال"), {
      status: 403,
      code: "LIFECYCLE_TRANSITION_FORBIDDEN",
    });
  }
}

function statusView(status: string) {
  const labels: Record<string, string> = {
    new: "جديد",
    awaiting_operations_claim: "في انتظار استلام مدير التشغيل",
    claimed: "تم استلامه من مدير التشغيل",
    pending_supervisor: "في انتظار مشرف الإنتاج",
    materials_requested: "بانتظار قرار المواد",
    materials_approved: "المواد معتمدة",
    materials_partial: "اعتماد جزئي للمواد",
    materials_rejected: "المواد مرفوضة",
    in_production: "قيد التنفيذ",
    held: "معلّق",
    rework: "إعادة تشغيل",
    quality_check: "فحص الجودة",
    partially_completed: "مكتمل جزئياً",
    completed: "مكتمل",
    delivery_pending_customer: "بانتظار تسليم العميل",
    delivery_pending_warehouse: "بانتظار استلام المخزن",
    delivered_customer: "تم التسليم للعميل",
    delivered_warehouse: "تم التسليم للمخزن",
    cancelled: "ملغي",
    corrected: "يحتاج تصحيحاً",
    closed: "مغلق",
  };
  return { key: status, label: labels[status] ?? status };
}

async function loadOrder(id: number) {
  const [order] = await db
    .select()
    .from(productionWorkflowOrdersTable)
    .where(eq(productionWorkflowOrdersTable.id, id))
    .limit(1);
  return order;
}

// Detailed operator view: kind, current state, blocked gates, frozen source,
// adjustment records, and the transition timeline are returned together so
// the UI does not make a request per card or timeline row.
router.get(
  "/production-workflow/:id/lifecycle",
  requireAuth,
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const order = await loadOrder(id);
      if (!order) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "أمر الإنتاج غير موجود" } });
        return;
      }
      const [events, adjustments, children] = await Promise.all([
        db
          .select()
          .from(productionTransitionEventsTable)
          .where(eq(productionTransitionEventsTable.workflowOrderId, id))
          .orderBy(asc(productionTransitionEventsTable.revision)),
        db
          .select()
          .from(productionLifecycleAdjustmentsTable)
          .where(eq(productionLifecycleAdjustmentsTable.workflowOrderId, id))
          .orderBy(desc(productionLifecycleAdjustmentsTable.createdAt)),
        db
          .select()
          .from(productionWorkflowOrdersTable)
          .where(eq(productionWorkflowOrdersTable.parentWorkflowOrderId, id))
          .orderBy(asc(productionWorkflowOrdersTable.splitSequence)),
      ]);
      const issues = findProductionConformanceIssues(order, events.map((event) => event.revision));
      res.json({
        viewKind: "canonical_workflow_order",
        recordType: "order",
        data: {
          order,
          state: statusView(order.workflowStatus),
          allowedStatuses: CANONICAL_PRODUCTION_TRANSITIONS[
            order.workflowStatus as keyof typeof CANONICAL_PRODUCTION_TRANSITIONS
          ] ?? [],
          blockedGates: lifecycleGates(order),
          conformance: { ok: issues.length === 0, issues },
          sourceSnapshot: {
            sourceType: order.canonicalSourceType,
            sourceId: order.canonicalSourceId,
            sourceRevision: order.canonicalSourceRevision,
            reference: order.sourceReference,
            product: order.productSnapshot,
            bom: order.bomSnapshot,
            routing: order.routingSnapshot,
            customerRequirement: order.customerRequirementSnapshot,
            quantity: order.quantitySnapshot,
            dueDate: order.dueDateSnapshot,
            priority: order.prioritySnapshot,
            hash: order.snapshotHash,
          },
          children,
          adjustments,
          timeline: events.map((event) => ({
            ...event,
            from: event.fromStatus ? statusView(event.fromStatus) : null,
            to: statusView(event.toStatus),
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/production-workflow/:id/transition",
  requireAuth,
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const input = transitionSchema.parse(req.body);
      // Phase 02 (delivery 3): cancellation is deliberately excluded from
      // this generic command endpoint. PATCH /production-workflow/:id/cancel
      // is the one authoritative cancellation path because it also reverses
      // any stock already deducted for the order inside the same database
      // transaction (see production-workflow.ts). This generic transition
      // command has no stock-reversal step, so allowing "cancelled" here
      // would silently leave issued material deducted from inventory for any
      // order cancelled past the materials_approved/materials_partial gate —
      // a parallel-source-of-truth bug, not a stylistic one. Every other
      // target status in CANONICAL_PRODUCTION_TRANSITIONS is unaffected.
      if (input.targetStatus === "cancelled") {
        throw Object.assign(
          new Error(
            "استخدم PATCH /production-workflow/:id/cancel لإلغاء الأمر — هذا المسار العام لا يعكس حركات المخزون المخصومة",
          ),
          { status: 409, code: "USE_DEDICATED_CANCEL_ENDPOINT" },
        );
      }
      assertLifecycleRole(req.user!.role, input.targetStatus);
      const updated = await db.transaction((tx) =>
        transitionCanonicalProductionOrder(tx, {
          orderId: id,
          targetStatus: input.targetStatus,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          reason: input.reason,
          evidence: input.evidence,
          expectedRevision: input.expectedRevision,
          adjustmentType:
            input.targetStatus === "cancelled"
              ? "cancellation"
              : input.targetStatus === "corrected"
                ? "correction"
                : input.targetStatus === "closed"
                  ? "closure"
                  : undefined,
          actionKey: `production.lifecycle.${input.targetStatus}`,
        }),
      );
      res.json({
        data: updated,
        meta: { lifecycleRevision: updated.lifecycleRevision, apiVersion: "1.1" },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/production-workflow/:id/partial-completion",
  requireAuth,
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const input = adjustmentSchema.parse(req.body);
      if (!input.quantity || !isPositiveDecimalQuantity(input.quantity)) {
        res.status(400).json({ error: { code: "INVALID_QUANTITY", message: "الكمية الجزئية غير صالحة" } });
        return;
      }
      assertLifecycleRole(req.user!.role, "partially_completed");
      const updated = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(productionWorkflowOrdersTable)
          .where(eq(productionWorkflowOrdersTable.id, id))
          .for("update")
          .limit(1);
        if (!current) throw Object.assign(new Error("أمر الإنتاج غير موجود"), { status: 404 });
        if (compareDecimalQuantities(input.quantity!, current.qty) >= 0) {
          throw Object.assign(new Error("الكمية الجزئية يجب أن تكون أقل من كمية الأمر"), { status: 400 });
        }
        const updated = await transitionCanonicalProductionOrder(tx, {
          orderId: id,
          targetStatus: "partially_completed",
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          reason: input.reason,
          evidence: input.evidence,
          expectedRevision: input.expectedRevision,
          adjustmentType: "partial_completion",
          quantity: input.quantity,
          actionKey: "production.lifecycle.partial_completion",
        });
        return updated;
      });
      res.json({ data: updated, meta: { apiVersion: "1.1" } });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/production-workflow/:id/split",
  requireAuth,
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const input = adjustmentSchema.parse(req.body);
      if (!input.quantity || !isPositiveDecimalQuantity(input.quantity)) {
        res.status(400).json({ error: { code: "INVALID_QUANTITY", message: "كمية التقسيم غير صالحة" } });
        return;
      }
      assertLifecycleRole(req.user!.role, "partially_completed");
      const result = await db.transaction(async (tx) => {
        const [parent] = await tx
          .select()
          .from(productionWorkflowOrdersTable)
          .where(eq(productionWorkflowOrdersTable.id, id))
          .for("update")
          .limit(1);
        if (!parent) throw Object.assign(new Error("أمر الإنتاج غير موجود"), { status: 404 });
        if (
          input.expectedRevision !== undefined &&
          parent.lifecycleRevision !== input.expectedRevision
        ) {
          throw Object.assign(new Error("تغير الأمر من جلسة أخرى؛ أعد تحميل التفاصيل"), {
            status: 409,
            code: "LIFECYCLE_REVISION_CONFLICT",
          });
        }
        if (compareDecimalQuantities(input.quantity!, parent.qty) >= 0) {
          throw Object.assign(new Error("كمية التقسيم يجب أن تكون أقل من كمية الأمر"), { status: 400 });
        }
        const remaining = subtractDecimalQuantities(parent.qty, input.quantity!);
        const [sequence] = await tx
          .select({ value: productionWorkflowOrdersTable.splitSequence })
          .from(productionWorkflowOrdersTable)
          .where(eq(productionWorkflowOrdersTable.rootWorkflowOrderId, parent.rootWorkflowOrderId ?? parent.id))
          .orderBy(desc(productionWorkflowOrdersTable.splitSequence))
          .limit(1);
        const splitSequence = (sequence?.value ?? 0) + 1;
        const snapshot = buildProductionOrderSnapshot({
          productName: parent.productName,
          bomRecipeId: parent.bomRecipeId,
          qty: input.quantity!,
          unit: parent.unit,
          neededBy: parent.neededBy,
          priority: parent.priority,
          customerRequirement: parent.customerRequirementSnapshot,
          bom: parent.bomSnapshot,
          routing: parent.routingSnapshot,
        });
        const [child] = await tx
          .insert(productionWorkflowOrdersTable)
          .values({
            orderNumber: await generateWorkflowOrderNumber(tx),
            workflowStatus: "awaiting_operations_claim",
            canonicalSourceType: "split_order",
            canonicalSourceId: parent.id,
            canonicalSourceRevision: splitSequence,
            sourceReference: `${parent.orderNumber}/S${splitSequence}`,
            productSnapshot: snapshot.product,
            bomSnapshot: snapshot.product.bom,
            routingSnapshot: snapshot.product.routing,
            customerRequirementSnapshot: snapshot.customerRequirement,
            quantitySnapshot: snapshot.quantity,
            dueDateSnapshot: snapshot.dueDate,
            prioritySnapshot: snapshot.priority,
            snapshotHash: hashProductionSnapshot(snapshot),
            rootWorkflowOrderId: parent.rootWorkflowOrderId ?? parent.id,
            parentWorkflowOrderId: parent.id,
            splitSequence,
            productName: parent.productName,
            qty: input.quantity!,
            unit: parent.unit,
            bomRecipeId: parent.bomRecipeId,
            salesOrderId: parent.salesOrderId,
            rootSalesOrderId: parent.rootSalesOrderId,
            salesOrderRef: parent.salesOrderRef,
            customerName: parent.customerName,
            customerPhone: parent.customerPhone,
            customerEmail: parent.customerEmail,
            orderSource: parent.orderSource,
            orderDetails: parent.orderDetails,
            portalCustomerId: parent.portalCustomerId,
            priority: parent.priority,
            neededBy: parent.neededBy,
            notes: parent.notes,
            createdById: req.user!.userId,
            createdByName: req.user!.username,
          })
          .returning();
        await recordProductionTransitionEvent(tx, {
          workflowOrderId: child.id,
          revision: child.lifecycleRevision,
          fromStatus: null,
          toStatus: child.workflowStatus,
          actionKey: "production.lifecycle.split.create",
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          reason: input.reason,
          metadata: { parentWorkflowOrderId: parent.id, quantity: input.quantity },
        });
        await tx.insert(productionLifecycleAdjustmentsTable).values({
          workflowOrderId: parent.id,
          relatedWorkflowOrderId: child.id,
          adjustmentType: "split",
          fromStatus: parent.workflowStatus,
          toStatus: parent.workflowStatus,
          quantity: input.quantity,
          reason: input.reason,
          evidence: { ...((input.evidence as object) ?? {}), remainingQty: remaining },
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
        });
        await tx
          .update(productionWorkflowOrdersTable)
          .set({ qty: remaining, updatedAt: new Date() })
          .where(eq(productionWorkflowOrdersTable.id, parent.id));
        return { parent, child, remainingQty: remaining };
      });
      res.status(201).json({ data: result, meta: { apiVersion: "1.1" } });
    } catch (err) {
      next(err);
    }
  },
);

// Operations cases are source records. Conversion is idempotent and keeps the
// case linked to the root canonical order; multi-line cases are represented by
// child split orders so every production line remains independently traceable.
router.post(
  "/operations/cases/:id/convert",
  requireAuth,
  async (req, res, next) => {
    try {
      const caseId = parseIdParam(req.params.id, res);
      if (caseId === null) return;
      assertLifecycleRole(req.user!.role, "awaiting_operations_claim");
      const result = await db.transaction(async (tx) => {
        const [source] = await tx
          .select()
          .from(operationsCasesTable)
          .where(eq(operationsCasesTable.id, caseId))
          .for("update")
          .limit(1);
        if (!source) throw Object.assign(new Error("حالة التشغيل غير موجودة"), { status: 404 });
        if (source.workflowOrderId) {
          const [existing] = await tx
            .select()
            .from(productionWorkflowOrdersTable)
            .where(eq(productionWorkflowOrdersTable.id, source.workflowOrderId))
            .limit(1);
          return { order: existing, alreadyConverted: true };
        }
        const lines = await tx
          .select()
          .from(operationsCaseLinesTable)
          .where(eq(operationsCaseLinesTable.caseId, caseId))
          .orderBy(asc(operationsCaseLinesTable.id));
        if (!lines.length) throw Object.assign(new Error("حالة التشغيل بلا بنود"), { status: 409 });
        const line = lines[0];
        const snapshot = buildProductionOrderSnapshot({
          productName: line.productNameSnapshot,
          bomRecipeId: null,
          qty: line.orderedQty,
          unit: line.baseUnit,
          neededBy: line.dueDate ?? source.dueDate,
          priority: source.priority,
          customerRequirement: { source: "operations_case", caseId, lineId: line.id, snapshot: source.sourceSnapshot },
        });
        const [order] = await tx
          .insert(productionWorkflowOrdersTable)
          .values({
            orderNumber: await generateWorkflowOrderNumber(tx),
            workflowStatus: "awaiting_operations_claim",
            canonicalSourceType: "operations_case",
            canonicalSourceId: caseId,
            canonicalSourceRevision: source.currentRevision,
            sourceReference: source.caseNumber,
            productSnapshot: snapshot.product,
            bomSnapshot: snapshot.product.bom,
            routingSnapshot: snapshot.product.routing,
            customerRequirementSnapshot: snapshot.customerRequirement,
            quantitySnapshot: snapshot.quantity,
            dueDateSnapshot: snapshot.dueDate,
            prioritySnapshot: snapshot.priority,
            snapshotHash: hashProductionSnapshot(snapshot),
            rootWorkflowOrderId: undefined,
            productName: line.productNameSnapshot,
            qty: line.orderedQty,
            unit: line.baseUnit,
            priority: source.priority,
            neededBy: line.dueDate ?? source.dueDate,
            customerName: source.customerDisplayName ?? "عميل أمر البيع",
            salesOrderId: source.salesOrderId,
            createdById: req.user!.userId,
            createdByName: req.user!.username,
          })
          .returning();
        const rootId = order.id;
        await tx
          .update(productionWorkflowOrdersTable)
          .set({ rootWorkflowOrderId: rootId })
          .where(eq(productionWorkflowOrdersTable.id, rootId));
        await recordProductionTransitionEvent(tx, {
          workflowOrderId: rootId,
          revision: order.lifecycleRevision,
          fromStatus: null,
          toStatus: order.workflowStatus,
          actionKey: "production.operations_case.convert",
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          metadata: { sourceType: "operations_case", sourceId: caseId },
        });
        for (const [index, extraLine] of lines.slice(1).entries()) {
          const splitSequence = index + 1;
          const extraSnapshot = buildProductionOrderSnapshot({
            productName: extraLine.productNameSnapshot,
            bomRecipeId: null,
            qty: extraLine.orderedQty,
            unit: extraLine.baseUnit,
            neededBy: extraLine.dueDate ?? source.dueDate,
            priority: source.priority,
            customerRequirement: {
              source: "operations_case",
              caseId,
              lineId: extraLine.id,
              snapshot: source.sourceSnapshot,
            },
          });
          const [child] = await tx
            .insert(productionWorkflowOrdersTable)
            .values({
              orderNumber: await generateWorkflowOrderNumber(tx),
              workflowStatus: "awaiting_operations_claim",
              canonicalSourceType: "split_order",
              canonicalSourceId: rootId,
              canonicalSourceRevision: splitSequence,
              sourceReference: `${source.caseNumber}/S${splitSequence}`,
              productSnapshot: extraSnapshot.product,
              bomSnapshot: extraSnapshot.product.bom,
              routingSnapshot: extraSnapshot.product.routing,
              customerRequirementSnapshot: extraSnapshot.customerRequirement,
              quantitySnapshot: extraSnapshot.quantity,
              dueDateSnapshot: extraSnapshot.dueDate,
              prioritySnapshot: extraSnapshot.priority,
              snapshotHash: hashProductionSnapshot(extraSnapshot),
              rootWorkflowOrderId: rootId,
              parentWorkflowOrderId: rootId,
              splitSequence,
              productName: extraLine.productNameSnapshot,
              qty: extraLine.orderedQty,
              unit: extraLine.baseUnit,
              priority: source.priority,
              neededBy: extraLine.dueDate ?? source.dueDate,
              customerName: source.customerDisplayName ?? "عميل أمر البيع",
              salesOrderId: source.salesOrderId,
              createdById: req.user!.userId,
              createdByName: req.user!.username,
            })
            .returning();
          await recordProductionTransitionEvent(tx, {
            workflowOrderId: child.id,
            revision: child.lifecycleRevision,
            fromStatus: null,
            toStatus: child.workflowStatus,
            actionKey: "production.operations_case.split.create",
            actorUserId: req.user!.userId,
            actorName: req.user!.username,
            reason: "تحويل بند إضافي من حالة التشغيل",
            metadata: { rootWorkflowOrderId: rootId, lineId: extraLine.id },
          });
        }
        await tx
          .update(operationsCasesTable)
          .set({ workflowOrderId: rootId, updatedAt: new Date() })
          .where(eq(operationsCasesTable.id, caseId));
        return { order: { ...order, rootWorkflowOrderId: rootId }, alreadyConverted: false };
      });
      res.status(result.alreadyConverted ? 200 : 201).json({ data: result, meta: { idempotent: result.alreadyConverted, apiVersion: "1.1" } });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/production-lifecycle/conformance",
  requireAuth,
  async (req, res, next) => {
    try {
      if (!lifecycleRoles.includes(req.user!.role as (typeof lifecycleRoles)[number])) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "ليس لديك صلاحية لفحص دورة الإنتاج" } });
        return;
      }
      const orders = await db.select().from(productionWorkflowOrdersTable).orderBy(desc(productionWorkflowOrdersTable.updatedAt));
      const events = orders.length
        ? await db
            .select({
              workflowOrderId: productionTransitionEventsTable.workflowOrderId,
              revision: productionTransitionEventsTable.revision,
            })
            .from(productionTransitionEventsTable)
            .where(
              inArray(
                productionTransitionEventsTable.workflowOrderId,
                orders.map((order) => order.id),
              ),
            )
        : [];
      const revisionsByOrder = new Map<number, number[]>();
      for (const event of events) {
        const revisions = revisionsByOrder.get(event.workflowOrderId) ?? [];
        revisions.push(event.revision);
        revisionsByOrder.set(event.workflowOrderId, revisions);
      }
      const reports = orders.map((order) => {
        const issues = findProductionConformanceIssues(
          order,
          revisionsByOrder.get(order.id) ?? [],
        );
        return {
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: order.workflowStatus,
          issues,
        };
      });
      res.json({ data: reports, summary: { checked: reports.length, nonConformant: reports.filter((report) => report.issues.length).length } });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/production-lifecycle/legacy-audit",
  requireAuth,
  async (req, res, next) => {
    try {
      if (!["chairman", "executive_manager", "operations_manager"].includes(req.user!.role)) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "تقرير legacy متاح للإدارة المخولة فقط" } });
        return;
      }
      const rows = await db
        .select()
        .from(productionLegacyOrderMappingsTable)
        .orderBy(desc(productionLegacyOrderMappingsTable.createdAt));
      res.json({
        data: rows,
        summary: {
          total: rows.length,
          quarantined: rows.filter((row) => row.mappingStatus === "quarantined").length,
          mapped: rows.filter((row) => row.mappingStatus === "mapped").length,
          needsReview: rows.filter((row) => row.mappingStatus === "needs_review").length,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;