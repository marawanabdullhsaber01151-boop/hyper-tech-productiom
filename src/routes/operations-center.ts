import { Router } from "express";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  operationsCaseLinesTable,
  operationsCaseRevisionsTable,
  operationsCasePromisesTable,
  operationsCasesTable,
  productionExceptionsTable,
  productionWorkflowOrdersTable,
  purchaseRequisitionsTable,
  operationTransfersTable,
  salesOrdersTable,
  systemUsersTable,
} from "../db/schema";
import { requireAuth, requirePermission } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { OPERATIONS_MANAGER_PERMISSIONS } from "../lib/permissions";
import { OPERATIONS_CONTROL_ROLES } from "../lib/operations-control-policy";
import {
  ACTIVE_CASE_STATUSES,
  caseRisk,
  nextActionFor,
  type RiskLevel,
  type RiskReason,
} from "../lib/operationsCenterCore";
import { escalateOperationsSla } from "../lib/operationsSla";
import { loadCapacityForecast } from "../lib/operationsCapacity";
import { loadCenterCapacity } from "../lib/capacityCenters";
import { computeCasePromise } from "../lib/casePromise";
import { CLOSED_CASE_STATUSES, commitIssue, isClosedCase, standing, summarize } from "../lib/promiseCommitCore";
import { writeAuditEvent } from "../lib/governance";

const router = Router();

const ORDER_DONE = ["delivered_customer", "delivered_warehouse", "cancelled", "closed", "corrected"];
const RISK_RANK: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

/**
 * مركز قيادة التشغيل: كل المؤشرات والطوابير في طلب واحد.
 * بيشغّل التصعيد التلقائي (مرة كل 10 دقايق على الأكتر) عشان التنبيه يحصل حتى لو محدش فتح الشاشة.
 */
router.get(
  "/operations-center/overview",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseView),
  async (_req, res, next) => {
    try {
      const now = new Date();
      await escalateOperationsSla(now).catch(() => undefined);

      const [cases, awaitingClaim, awaitingClaimTotal, pipelineRows, reqRows, transferRows, exceptionRows, overdueOrders, team] =
        await Promise.all([
          db
            .select({
              id: operationsCasesTable.id,
              caseNumber: operationsCasesTable.caseNumber,
              status: operationsCasesTable.status,
              priority: operationsCasesTable.priority,
              dueDate: operationsCasesTable.dueDate,
              assignedTo: operationsCasesTable.assignedTo,
              customerDisplayName: operationsCasesTable.customerDisplayName,
              workflowOrderId: operationsCasesTable.workflowOrderId,
              createdAt: operationsCasesTable.createdAt,
              updatedAt: operationsCasesTable.updatedAt,
            })
            .from(operationsCasesTable)
            .where(inArray(operationsCasesTable.status, [...ACTIVE_CASE_STATUSES])),
          db
            .select({
              id: productionWorkflowOrdersTable.id,
              orderNumber: productionWorkflowOrdersTable.orderNumber,
              productName: productionWorkflowOrdersTable.productName,
              qty: productionWorkflowOrdersTable.qty,
              unit: productionWorkflowOrdersTable.unit,
              priority: productionWorkflowOrdersTable.priority,
              neededBy: productionWorkflowOrdersTable.neededBy,
              customerName: productionWorkflowOrdersTable.customerName,
              createdAt: productionWorkflowOrdersTable.createdAt,
            })
            .from(productionWorkflowOrdersTable)
            .where(eq(productionWorkflowOrdersTable.workflowStatus, "awaiting_operations_claim"))
            .orderBy(asc(productionWorkflowOrdersTable.createdAt))
            .limit(10),
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(productionWorkflowOrdersTable)
            .where(eq(productionWorkflowOrdersTable.workflowStatus, "awaiting_operations_claim")),
          db
            .select({
              status: productionWorkflowOrdersTable.workflowStatus,
              n: sql<number>`count(*)::int`,
            })
            .from(productionWorkflowOrdersTable)
            .groupBy(productionWorkflowOrdersTable.workflowStatus),
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(purchaseRequisitionsTable)
            .where(eq(purchaseRequisitionsTable.status, "pending_operations")),
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(operationTransfersTable)
            .where(eq(operationTransfersTable.status, "pending")),
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(productionExceptionsTable)
            .where(eq(productionExceptionsTable.status, "open")),
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(productionWorkflowOrdersTable)
            .where(
              sql`${productionWorkflowOrdersTable.neededBy} IS NOT NULL
                AND ${productionWorkflowOrdersTable.neededBy} < (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date
                AND ${productionWorkflowOrdersTable.workflowStatus} NOT IN (${sql.join(ORDER_DONE.map((s) => sql`${s}`), sql`, `)})`,
            ),
          db
            .select({ id: systemUsersTable.id, name: systemUsersTable.fullName, role: systemUsersTable.role })
            .from(systemUsersTable)
            .where(
              and(
                eq(systemUsersTable.status, "active"),
                inArray(systemUsersTable.role, [...OPERATIONS_CONTROL_ROLES.planEdit]),
              ),
            )
            .orderBy(asc(systemUsersTable.fullName)),
        ]);

      const scored = cases.map((c) => ({ ...c, ...caseRisk(c, now) }));
      const byStatus: Record<string, number> = {};
      for (const c of cases) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      const reasonCount = (r: RiskReason) => scored.filter((c) => c.reasons.includes(r)).length;

      const atRisk = scored
        .filter((c) => c.level !== "low")
        .sort(
          (a, b) =>
            RISK_RANK[a.level] - RISK_RANK[b.level] ||
            (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") ||
            a.id - b.id,
        )
        .slice(0, 8)
        .map((c) => ({
          id: c.id,
          caseNumber: c.caseNumber,
          status: c.status,
          priority: c.priority,
          dueDate: c.dueDate,
          customerDisplayName: c.customerDisplayName,
          level: c.level,
          reasons: c.reasons,
          slaHours: c.sla?.hours ?? null,
          slaLimit: c.sla?.limit ?? null,
        }));

      const load = new Map<number, number>();
      for (const c of cases) if (c.assignedTo) load.set(c.assignedTo, (load.get(c.assignedTo) ?? 0) + 1);

      const pipeline: Record<string, number> = {};
      for (const row of pipelineRows) pipeline[row.status] = row.n;

      res.json({
        generatedAt: now.toISOString(),
        kpis: {
          activeCases: cases.length,
          atRisk: scored.filter((c) => c.level === "high").length,
          slaBreached: reasonCount("sla_breached") + reasonCount("waiting_sales"),
          waitingSales: byStatus.needs_sales_clarification ?? 0,
          unassigned: cases.filter((c) => !c.assignedTo).length,
          readyToConvert: cases.filter((c) => c.status === "analysis_ready" && !c.workflowOrderId).length,
          awaitingClaim: awaitingClaimTotal[0]?.n ?? 0,
          requisitionsPending: reqRows[0]?.n ?? 0,
          transfersPending: transferRows[0]?.n ?? 0,
          exceptionsOpen: exceptionRows[0]?.n ?? 0,
          overdueOrders: overdueOrders[0]?.n ?? 0,
        },
        byStatus,
        pipeline,
        atRisk,
        claimQueue: awaitingClaim,
        team: team.map((m) => ({ ...m, activeCases: load.get(m.id) ?? 0 })),
      });
    } catch (err) {
      next(err);
    }
  },
);

/** مساحة عمل الحالة: كل اللي يخص الحالة في طلب واحد (بنود، نسخ، أوامر مرتبطة، احتياجات، مخاطر). */
router.get(
  "/operations-center/cases/:id/workspace",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseView),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [record] = await db.select().from(operationsCasesTable).where(eq(operationsCasesTable.id, id)).limit(1);
      if (!record) {
        res.status(404).json({ error: { message: "حالة التشغيل غير موجودة" } });
        return;
      }

      const [lines, revisions, orderRows] = await Promise.all([
        db
          .select()
          .from(operationsCaseLinesTable)
          .where(eq(operationsCaseLinesTable.caseId, id))
          .orderBy(asc(operationsCaseLinesTable.id)),
        db
          .select({
            revision: operationsCaseRevisionsTable.revision,
            changeReason: operationsCaseRevisionsTable.changeReason,
            changedBy: operationsCaseRevisionsTable.changedBy,
            changedByName: systemUsersTable.fullName,
            createdAt: operationsCaseRevisionsTable.createdAt,
          })
          .from(operationsCaseRevisionsTable)
          .leftJoin(systemUsersTable, eq(systemUsersTable.id, operationsCaseRevisionsTable.changedBy))
          .where(eq(operationsCaseRevisionsTable.caseId, id))
          .orderBy(desc(operationsCaseRevisionsTable.revision)),
        db
          .select({
            orderNumber: salesOrdersTable.orderNumber,
            status: salesOrdersTable.status,
            date: salesOrdersTable.date,
            dueDate: salesOrdersTable.dueDate,
            revision: salesOrdersTable.revision,
            notes: salesOrdersTable.notes,
            channel: salesOrdersTable.channel,
          })
          .from(salesOrdersTable)
          .where(eq(salesOrdersTable.id, record.salesOrderId))
          .limit(1),
      ]);

      const linkedOrders = record.workflowOrderId
        ? await db
            .select({
              id: productionWorkflowOrdersTable.id,
              orderNumber: productionWorkflowOrdersTable.orderNumber,
              workflowStatus: productionWorkflowOrdersTable.workflowStatus,
              productName: productionWorkflowOrdersTable.productName,
              qty: productionWorkflowOrdersTable.qty,
              unit: productionWorkflowOrdersTable.unit,
              neededBy: productionWorkflowOrdersTable.neededBy,
              priority: productionWorkflowOrdersTable.priority,
              claimedByName: productionWorkflowOrdersTable.claimedByName,
              bomRecipeId: productionWorkflowOrdersTable.bomRecipeId,
              splitSequence: productionWorkflowOrdersTable.splitSequence,
            })
            .from(productionWorkflowOrdersTable)
            .where(eq(productionWorkflowOrdersTable.rootWorkflowOrderId, record.workflowOrderId))
            .orderBy(asc(productionWorkflowOrdersTable.id))
        : [];

      const orderIds = linkedOrders.map((o) => o.id);
      const requisitions = await db
        .select()
        .from(purchaseRequisitionsTable)
        .where(
          orderIds.length
            ? sql`${purchaseRequisitionsTable.salesOrderId} = ${record.salesOrderId} OR ${inArray(purchaseRequisitionsTable.workflowOrderId, orderIds)}`
            : eq(purchaseRequisitionsTable.salesOrderId, record.salesOrderId),
        )
        .orderBy(desc(purchaseRequisitionsTable.createdAt));

      const now = new Date();
      const risk = caseRisk(record, now);
      res.json({
        case: record,
        lines,
        revisions,
        salesOrder: orderRows[0] ?? null,
        linkedOrders,
        requisitions,
        risk: { level: risk.level, reasons: risk.reasons, sla: risk.sla },
        nextAction: nextActionFor(record.status, Boolean(record.workflowOrderId)),
      });
    } catch (err) {
      next(err);
    }
  },
);

/** السعة: حمل المصنع على 14 يوم عمل جاية بسقف تحميل 85%، من الأوامر المفتوحة ومدد وصفاتها. */
router.get(
  "/operations-center/capacity",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseView),
  async (_req, res, next) => {
    try {
      const now = new Date();
      const cap = await loadCapacityForecast(now);
      res.json({
        generatedAt: now.toISOString(),
        cap: cap.config.cap,
        holidaysAhead: cap.config.holidaysAhead,
        lines: cap.lines,
        linesAssumed: cap.linesAssumed,
        openOrders: cap.openOrders,
        noRecipeOrders: cap.noRecipeOrders,
        ...cap.forecast,
      });
    } catch (err) {
      next(err);
    }
  },
);

/** خريطة السعة حسب مركز العمل: دقايق مسارات الأوامر المفتوحة على أيام العمل، وتاريخ الانتهاء المتوقع لكل أمر. */
router.get(
  "/operations-center/capacity/centers",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseView),
  async (_req, res, next) => {
    try {
      const now = new Date();
      const snap = await loadCenterCapacity(now);
      const { config, ...rest } = snap;
      res.json({ generatedAt: now.toISOString(), cap: config.cap, holidaysAhead: config.holidaysAhead, offDays: config.calendar.offDays, ...rest });
    } catch (err) {
      next(err);
    }
  },
);

/** وعد التسليم للحالة: نطاق (الأقرب/الأرجح/الأبعد) مقارنة بموعد الحالة، على أساس الطابور الحالي. */
router.get(
  "/operations-center/cases/:id/promise",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseView),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const out = await computeCasePromise(id, new Date());
      if (!out) {
        res.status(404).json({ error: { message: "حالة التشغيل غير موجودة" } });
        return;
      }
      res.json(out.body);
    } catch (err) {
      next(err);
    }
  },
);

const commitSchema = z.object({ reason: z.string().trim().max(300).optional() });

/** تثبيت الوعد على الحالة: سجل إضافة فقط. الأول من غير سبب، وأي تعديل بعده بسبب إجباري. بمعاملة واحدة مع التدقيق. */
router.post(
  "/operations-center/cases/:id/promise/commit",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseEdit),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const body = commitSchema.parse(req.body ?? {});
      const out = await computeCasePromise(id, new Date());
      if (!out) {
        res.status(404).json({ error: { message: "حالة التشغيل غير موجودة" } });
        return;
      }
      if (isClosedCase(out.status)) {
        res.status(409).json({ error: { code: "CASE_CLOSED", message: "الحالة مقفولة، مينفعش نثبّت وعد عليها" } });
        return;
      }
      const saved = await db.transaction(async (tx) => {
        const previous = await tx.select({ id: operationsCasePromisesTable.id }).from(operationsCasePromisesTable).where(eq(operationsCasePromisesTable.caseId, id)).limit(1);
        if (commitIssue({ hasPrevious: previous.length > 0, reason: body.reason }) === "reason") return null;
        const p = out.body;
        const [row] = await tx
          .insert(operationsCasePromisesTable)
          .values({
            caseId: id,
            promisedDate: p.confidenceDate,
            earliestDate: p.earliest,
            likelyDate: p.likely,
            latestDate: p.latest,
            confidencePercent: p.confidence === null ? null : Math.round(p.confidence * 100),
            method: p.method,
            runs: p.runs,
            dueDate: p.dueDate,
            reason: body.reason || null,
            createdBy: req.user!.userId,
          })
          .returning();
        await writeAuditEvent({
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: previous.length ? "case.promise.revised" : "case.promise.committed",
          resourceType: "operations_case",
          resourceId: id,
          afterData: { promisedDate: p.confidenceDate, method: p.method, confidence: p.confidence, dueDate: p.dueDate },
          reason: body.reason || null,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          executor: tx,
        });
        return row ?? null;
      });
      if (!saved) {
        res.status(400).json({ error: { code: "REASON_REQUIRED", message: "تعديل وعد مثبّت لازم له سبب (3 حروف على الأقل)" } });
        return;
      }
      res.status(201).json(toPromiseRow(saved));
    } catch (err) {
      next(err);
    }
  },
);

/** سجل وعود الحالة (الأحدث الأول). */
router.get(
  "/operations-center/cases/:id/promise/history",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseView),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const rows = await db.select().from(operationsCasePromisesTable).where(eq(operationsCasePromisesTable.caseId, id)).orderBy(desc(operationsCasePromisesTable.id)).limit(100);
      res.json(rows.map(toPromiseRow));
    } catch (err) {
      next(err);
    }
  },
);

/** تبويب «الوعود»: الحالات المفتوحة اللي ليها وعد مثبّت، الأول والحالي وعدد التعديلات ومقارنته بموعد الحالة. */
router.get(
  "/operations-center/promises",
  requireAuth,
  requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseView),
  async (_req, res, next) => {
    try {
      const rows = await db
        .select({
          id: operationsCasePromisesTable.id,
          caseId: operationsCasePromisesTable.caseId,
          promisedDate: operationsCasePromisesTable.promisedDate,
          confidencePercent: operationsCasePromisesTable.confidencePercent,
          method: operationsCasePromisesTable.method,
          reason: operationsCasePromisesTable.reason,
          createdAt: operationsCasePromisesTable.createdAt,
          caseNumber: operationsCasesTable.caseNumber,
          customer: operationsCasesTable.customerDisplayName,
          dueDate: operationsCasesTable.dueDate,
          status: operationsCasesTable.status,
        })
        .from(operationsCasePromisesTable)
        .innerJoin(operationsCasesTable, eq(operationsCasesTable.id, operationsCasePromisesTable.caseId))
        .where(notInArray(operationsCasesTable.status, [...CLOSED_CASE_STATUSES]))
        .orderBy(desc(operationsCasePromisesTable.id))
        .limit(1000);
      const meta = new Map(rows.map((r) => [r.caseId, { caseNumber: r.caseNumber, customer: r.customer, dueDate: r.dueDate }]));
      const sums = summarize(rows.map((r) => ({ id: r.id, caseId: r.caseId, promisedDate: r.promisedDate, confidencePercent: r.confidencePercent, method: r.method, reason: r.reason, createdAt: r.createdAt.toISOString() })));
      res.json(
        sums
          .map((s) => {
            const m = meta.get(s.caseId);
            return { caseId: s.caseId, caseNumber: m?.caseNumber ?? "", customer: m?.customer ?? null, dueDate: m?.dueDate ?? null, first: s.first, current: s.current, revisions: s.revisions, standing: standing(s.current.promisedDate, m?.dueDate ?? null) };
          })
          .sort((a, b) => (a.current.promisedDate < b.current.promisedDate ? -1 : 1)),
      );
    } catch (err) {
      next(err);
    }
  },
);

function toPromiseRow(r: typeof operationsCasePromisesTable.$inferSelect) {
  return { id: r.id, caseId: r.caseId, promisedDate: r.promisedDate, confidencePercent: r.confidencePercent, method: r.method, reason: r.reason, createdAt: r.createdAt.toISOString() };
}

export default router;
