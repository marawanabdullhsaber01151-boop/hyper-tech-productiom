import { Router } from "express";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  ilike,
  lte,
  not,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  operationsCaseLinesTable,
  operationsCaseRevisionsTable,
  operationsCasesTable,
  salesOrdersTable,
  systemUsersTable,
} from "../db/schema";
import { requireAuth, requirePermission } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { OPERATIONS_MANAGER_PERMISSIONS } from "../lib/permissions";
import { OPERATIONS_CONTROL_ROLES } from "../lib/operations-control-policy";
import {
  isNonNegativeDecimalQuantity,
  isPositiveDecimalQuantity,
} from "../lib/decimal-quantity";
import {
  operationsIntakeRequestSchema,
  parseSalesOrderRevision,
  receiveSalesOrderIntoOperations,
} from "../lib/operations-intake";
import { writeAuditEvent } from "../lib/governance";

const router = Router();

const clarificationSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});

const casesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum([
      "received",
      "under_validation",
      "needs_sales_clarification",
      "analysis_ready",
      "cancelled",
      "completed",
      "closed",
    ])
    .optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  dueDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  overdue: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  search: z.string().trim().max(100).optional(),
});

const receiveSalesOrderByNumberSchema = z.object({
  orderNumber: z.string().trim().min(1).max(100),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

const activeCaseCondition = sql`${operationsCasesTable.status} NOT IN ('cancelled', 'completed', 'closed')`;
const cairoToday = sql`(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date`;
const overdueCondition = sql<boolean>`${operationsCasesTable.dueDate} IS NOT NULL
  AND ${operationsCasesTable.dueDate} < ${cairoToday}
  AND ${activeCaseCondition}`;
const riskLevelExpression = sql<string>`
  CASE
    WHEN ${overdueCondition} THEN 'high'
    WHEN ${operationsCasesTable.dueDate} IS NOT NULL
      AND ${operationsCasesTable.dueDate} <= ${cairoToday} + 2
      AND ${activeCaseCondition} THEN 'medium'
    ELSE 'low'
  END
`;

function listFilters(input: z.infer<typeof casesListQuerySchema>) {
  const filters = [];
  if (input.status) filters.push(eq(operationsCasesTable.status, input.status));
  if (input.priority) filters.push(eq(operationsCasesTable.priority, input.priority));
  if (input.dueDateFrom) filters.push(gte(operationsCasesTable.dueDate, input.dueDateFrom));
  if (input.dueDateTo) filters.push(lte(operationsCasesTable.dueDate, input.dueDateTo));
  if (input.assignedTo) filters.push(eq(operationsCasesTable.assignedTo, input.assignedTo));
  if (input.overdue !== undefined) {
    filters.push(input.overdue ? overdueCondition : not(overdueCondition));
  }
  if (input.riskLevel) filters.push(eq(riskLevelExpression, input.riskLevel));
  if (input.search) {
    const search = `%${input.search}%`;
    filters.push(
      sql`(
        ${ilike(operationsCasesTable.caseNumber, search)}
        OR ${ilike(salesOrdersTable.orderNumber, search)}
        OR ${ilike(operationsCasesTable.customerDisplayName, search)}
      )`,
    );
  }
  return filters;
}

const priorityRankExpression = sql<number>`
  CASE ${operationsCasesTable.priority}
    WHEN 'urgent' THEN 1
    WHEN 'high' THEN 2
    WHEN 'normal' THEN 3
    WHEN 'low' THEN 4
    ELSE 5
  END
`;

function validateCaseLines(lines: Array<{
  productNameSnapshot: string;
  orderedQty: string;
  baseUnit: string;
  packagingQty: string;
  packagingUnit: string;
  conversionFactor: string;
}>) {
  if (!lines.length) {
    throw Object.assign(new Error("لا يمكن اعتماد حالة بلا سطور"), { status: 422 });
  }

  for (const line of lines) {
    if (!line.productNameSnapshot.trim()) {
      throw Object.assign(new Error("اسم الصنف مطلوب لكل سطر"), { status: 422 });
    }
    if (!isPositiveDecimalQuantity(line.orderedQty)) {
      throw Object.assign(new Error("كمية الطلب يجب أن تكون أكبر من صفر"), { status: 422 });
    }
    if (!line.baseUnit.trim() || !line.packagingUnit.trim()) {
      throw Object.assign(new Error("وحدتا الأساس والتعبئة مطلوبتان"), { status: 422 });
    }
    if (!isNonNegativeDecimalQuantity(line.packagingQty)) {
      throw Object.assign(new Error("كمية التعبئة لا يمكن أن تكون سالبة"), { status: 422 });
    }
    if (!isPositiveDecimalQuantity(line.conversionFactor)) {
      throw Object.assign(new Error("معامل التحويل يجب أن يكون أكبر من صفر"), { status: 422 });
    }
  }
}

async function recordCaseTransition(
  tx: { insert: (...args: any[]) => any },
  before: typeof operationsCasesTable.$inferSelect,
  after: typeof operationsCasesTable.$inferSelect,
  changeReason: string,
  changedBy: number,
) {
  await tx.insert(operationsCaseRevisionsTable).values({
    caseId: after.id,
    revision: after.currentRevision,
    snapshot: after.sourceSnapshot,
    changeReason,
    changedBy,
  });
}

router.get(
  "/operations-manager/cases",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseView),
  async (req, res, next) => {
    try {
      const query = casesListQuerySchema.parse(req.query);
      if (query.dueDateFrom && query.dueDateTo && query.dueDateFrom > query.dueDateTo) {
        res.status(400).json({ error: { message: "نطاق التاريخ غير صالح" } });
        return;
      }

      const offset = (query.page - 1) * query.pageSize;
      const filters = listFilters(query);
      const where = filters.length ? and(...filters) : undefined;

      const [totalResult, items] = await Promise.all([
        db
          .select({ count: count(operationsCasesTable.id) })
          .from(operationsCasesTable)
          .innerJoin(
            salesOrdersTable,
            eq(salesOrdersTable.id, operationsCasesTable.salesOrderId),
          )
          .where(where),
        db
          .select({
            id: operationsCasesTable.id,
            caseNumber: operationsCasesTable.caseNumber,
            salesOrderId: operationsCasesTable.salesOrderId,
            salesOrderNumber: salesOrdersTable.orderNumber,
            status: operationsCasesTable.status,
            priority: operationsCasesTable.priority,
            dueDate: operationsCasesTable.dueDate,
            assignedTo: operationsCasesTable.assignedTo,
            customerDisplayName: operationsCasesTable.customerDisplayName,
            salesOrderRevision: operationsCasesTable.salesOrderRevision,
            lineCount: sql<number>`(
              SELECT COUNT(*)::int
              FROM operations_case_lines AS ocl
              WHERE ocl.case_id = ${operationsCasesTable.id}
            )`,
            orderedQtyTotal: sql<string>`(
              SELECT COALESCE(SUM(ocl.ordered_qty), 0)::text
              FROM operations_case_lines AS ocl
              WHERE ocl.case_id = ${operationsCasesTable.id}
            )`,
            updatedAt: operationsCasesTable.updatedAt,
            riskLevel: riskLevelExpression,
            overdue: overdueCondition,
          })
          .from(operationsCasesTable)
          .innerJoin(
            salesOrdersTable,
            eq(salesOrdersTable.id, operationsCasesTable.salesOrderId),
          )
          .where(where)
          .orderBy(
            sql`CASE WHEN ${operationsCasesTable.dueDate} IS NULL THEN 1 ELSE 0 END`,
            asc(operationsCasesTable.dueDate),
            asc(priorityRankExpression),
            asc(operationsCasesTable.createdAt),
            asc(operationsCasesTable.id),
          )
          .limit(query.pageSize)
          .offset(offset),
      ]);

      const total = Number(totalResult[0]?.count ?? 0);
      res.json({
        items,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/operations-manager/staff",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseView),
  async (_req, res, next) => {
    try {
      const staff = await db
        .select({
          id: systemUsersTable.id,
          name: systemUsersTable.fullName,
        })
        .from(systemUsersTable)
        .where(
          and(
            eq(systemUsersTable.status, "active"),
            inArray(systemUsersTable.role, [...OPERATIONS_CONTROL_ROLES.planEdit]),
          ),
        )
        .orderBy(asc(systemUsersTable.fullName), asc(systemUsersTable.id));
      res.json(staff);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/operations-manager/cases/from-sales-order-number",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseEdit),
  async (req, res, next) => {
    try {
      const body = receiveSalesOrderByNumberSchema.parse(req.body ?? {});
      const [salesOrder] = await db
        .select({ id: salesOrdersTable.id })
        .from(salesOrdersTable)
        .where(eq(salesOrdersTable.orderNumber, body.orderNumber))
        .limit(1);

      if (!salesOrder) {
        res.status(404).json({
          error: { message: `أمر البيع ${body.orderNumber} غير موجود` },
        });
        return;
      }

      const result = await db.transaction((tx) =>
        receiveSalesOrderIntoOperations(tx, {
          salesOrderId: salesOrder.id,
          priority: body.priority,
          createdBy: req.user!.userId,
          actorName: req.user!.username,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        }),
      );

      res.status(result.created ? 201 : 200).json({
        case: result.case,
        lines: result.lines,
        idempotentReplay: !result.created,
      });
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        const typedError = err as Error & { status?: number; code?: string; details?: unknown };
        res.status(Number(typedError.status) || 422).json({
          error: {
            code: typedError.code,
            message: typedError.message,
            details: typedError.details,
          },
        });
        return;
      }
      next(err);
    }
  },
);

router.post(
  "/operations-manager/cases/from-sales-order/:salesOrderId",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseEdit),
  async (req, res, next) => {
    try {
      const salesOrderId = parseIdParam(req.params.salesOrderId, res);
      if (salesOrderId === null) return;

      const body = operationsIntakeRequestSchema.parse(req.body ?? {});
      const headerRevision = req.get("x-sales-order-revision");
      const requestedRevision =
        body.salesOrderRevision ??
        (headerRevision === null ? undefined : Number(headerRevision));
      const salesOrderRevision =
        requestedRevision === undefined
          ? undefined
          : parseSalesOrderRevision(requestedRevision);

      const result = await db.transaction((tx) =>
        receiveSalesOrderIntoOperations(tx, {
          salesOrderId,
          salesOrderRevision,
          priority: body.priority,
          createdBy: req.user!.userId,
          actorName: req.user!.username,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        }),
      );

      res.status(result.created ? 201 : 200).json({
        case: result.case,
        lines: result.lines,
        idempotentReplay: !result.created,
      });
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        const typedError = err as Error & {
          status?: number;
          code?: string;
          details?: unknown;
        };
        res
          .status(Number(typedError.status) || 422)
          .json({
            error: {
              code: typedError.code,
              message: typedError.message,
              details: typedError.details,
            },
          });
        return;
      }
      next(err);
    }
  },
);

router.get(
  "/operations-manager/cases/:id",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseView),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;

      const [caseRecord] = await db
        .select()
        .from(operationsCasesTable)
        .where(eq(operationsCasesTable.id, id))
        .limit(1);
      if (!caseRecord) {
        res.status(404).json({ error: { message: "حالة التشغيل غير موجودة" } });
        return;
      }
      const lines = await db
        .select()
        .from(operationsCaseLinesTable)
        .where(eq(operationsCaseLinesTable.caseId, id))
        .orderBy(asc(operationsCaseLinesTable.id));
      await writeAuditEvent({
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: "operations.case.viewed",
        resourceType: "operations_case",
        resourceId: id,
        afterData: { caseId: id, revision: caseRecord.currentRevision },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json({ case: caseRecord, lines });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/operations-manager/cases/:id/revisions",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseView),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;

      const [caseRecord] = await db
        .select({ id: operationsCasesTable.id })
        .from(operationsCasesTable)
        .where(eq(operationsCasesTable.id, id))
        .limit(1);
      if (!caseRecord) {
        res.status(404).json({ error: { message: "حالة التشغيل غير موجودة" } });
        return;
      }
      res.json(
        await db
          .select()
          .from(operationsCaseRevisionsTable)
          .where(eq(operationsCaseRevisionsTable.caseId, id))
          .orderBy(asc(operationsCaseRevisionsTable.revision)),
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/operations-manager/cases/:id/start-validation",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseEdit),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;

      const result = await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(operationsCasesTable)
          .where(eq(operationsCasesTable.id, id))
          .limit(1)
          .for("update");
        if (!before) {
          throw Object.assign(new Error("حالة التشغيل غير موجودة"), {
            status: 404,
          });
        }
        const lines = await tx
          .select({
            productNameSnapshot: operationsCaseLinesTable.productNameSnapshot,
            orderedQty: operationsCaseLinesTable.orderedQty,
            baseUnit: operationsCaseLinesTable.baseUnit,
            packagingQty: operationsCaseLinesTable.packagingQty,
            packagingUnit: operationsCaseLinesTable.packagingUnit,
            conversionFactor: operationsCaseLinesTable.conversionFactor,
          })
          .from(operationsCaseLinesTable)
          .where(eq(operationsCaseLinesTable.caseId, id));
        if (!lines.length) {
          throw Object.assign(new Error("لا يمكن بدء التحقق لحالة بلا سطور"), {
            status: 422,
          });
        }
        if (before.status === "under_validation") {
          return { case: before, changed: false };
        }
        if (before.status !== "received") {
          throw Object.assign(
            new Error("لا يمكن بدء التحقق من الحالة الحالية"),
            { status: 409 },
          );
        }

        const [updated] = await tx
          .update(operationsCasesTable)
          .set({
            status: "under_validation",
            currentRevision: before.currentRevision + 1,
            version: sql`${operationsCasesTable.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(operationsCasesTable.id, id),
              eq(operationsCasesTable.version, before.version),
            ),
          )
          .returning();
        if (!updated) {
          throw Object.assign(new Error("تم تعديل الحالة بالتوازي"), {
            status: 409,
          });
        }

        await recordCaseTransition(
          tx,
          before,
          updated,
          "validation_started",
          req.user!.userId,
        );
        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "operations.case.validationStarted",
          resourceType: "operations_case",
          resourceId: id,
          beforeData: { status: before.status, version: before.version },
          afterData: { status: updated.status, version: updated.version },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        return { case: updated, changed: true };
      });

      res.json({ case: result.case, idempotentReplay: !result.changed });
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        res
          .status(Number((err as Error & { status?: number }).status) || 422)
          .json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  },
);

router.post(
  "/operations-manager/cases/:id/complete-validation",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseEdit),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;

      const result = await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(operationsCasesTable)
          .where(eq(operationsCasesTable.id, id))
          .limit(1)
          .for("update");
        if (!before) {
          throw Object.assign(new Error("حالة التشغيل غير موجودة"), {
            status: 404,
          });
        }
        if (before.status === "analysis_ready") {
          return { case: before, changed: false };
        }
        if (before.status !== "under_validation") {
          throw Object.assign(
            new Error("لا يمكن إكمال التحقق من الحالة الحالية"),
            { status: 409 },
          );
        }

        const lines = await tx
          .select({
            productNameSnapshot: operationsCaseLinesTable.productNameSnapshot,
            orderedQty: operationsCaseLinesTable.orderedQty,
            baseUnit: operationsCaseLinesTable.baseUnit,
            packagingQty: operationsCaseLinesTable.packagingQty,
            packagingUnit: operationsCaseLinesTable.packagingUnit,
            conversionFactor: operationsCaseLinesTable.conversionFactor,
          })
          .from(operationsCaseLinesTable)
          .where(eq(operationsCaseLinesTable.caseId, id));
        validateCaseLines(lines);

        const [updated] = await tx
          .update(operationsCasesTable)
          .set({
            status: "analysis_ready",
            currentRevision: before.currentRevision + 1,
            version: sql`${operationsCasesTable.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(operationsCasesTable.id, id),
              eq(operationsCasesTable.version, before.version),
            ),
          )
          .returning();
        if (!updated) {
          throw Object.assign(new Error("تم تعديل الحالة بالتوازي"), {
            status: 409,
          });
        }

        await recordCaseTransition(
          tx,
          before,
          updated,
          "validation_completed",
          req.user!.userId,
        );
        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "operations.case.validationCompleted",
          resourceType: "operations_case",
          resourceId: id,
          beforeData: { status: before.status, version: before.version },
          afterData: { status: updated.status, version: updated.version },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        return { case: updated, changed: true };
      });

      res.json({ case: result.case, idempotentReplay: !result.changed });
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        res
          .status(Number((err as Error & { status?: number }).status) || 422)
          .json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  },
);

router.post(
  "/operations-manager/cases/:id/request-sales-clarification",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseEdit),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const { reason } = clarificationSchema.parse(req.body ?? {});

      const result = await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(operationsCasesTable)
          .where(eq(operationsCasesTable.id, id))
          .limit(1)
          .for("update");
        if (!before) {
          throw Object.assign(new Error("حالة التشغيل غير موجودة"), {
            status: 404,
          });
        }

        // Retrying the same clarification is safe and does not emit duplicate
        // audit events or increment the optimistic-lock version again.
        if (before.status === "needs_sales_clarification") {
          return { case: before, changed: false };
        }
        if (!["received", "under_validation"].includes(before.status)) {
          throw Object.assign(
            new Error("لا يمكن طلب توضيح من المبيعات في الحالة الحالية"),
            { status: 409 },
          );
        }

        const [updated] = await tx
          .update(operationsCasesTable)
          .set({
            status: "needs_sales_clarification",
            currentRevision: before.currentRevision + 1,
            version: sql`${operationsCasesTable.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(operationsCasesTable.id, id),
              eq(operationsCasesTable.version, before.version),
            ),
          )
          .returning();
        if (!updated) {
          throw Object.assign(new Error("تم تعديل الحالة بالتوازي"), {
            status: 409,
          });
        }

        await recordCaseTransition(
          tx,
          before,
          updated,
          "sales_clarification_requested",
          req.user!.userId,
        );
        await writeAuditEvent({
          executor: tx,
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "operations.case.salesClarificationRequested",
          resourceType: "operations_case",
          resourceId: id,
          beforeData: { status: before.status, version: before.version },
          afterData: {
            status: updated.status,
            version: updated.version,
          },
          reason,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        return { case: updated, changed: true };
      });

      res.json({
        case: result.case,
        idempotentReplay: !result.changed,
        salesOrderMutated: false,
      });
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        res
          .status(Number((err as Error & { status?: number }).status) || 422)
          .json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  },
);

export default router;