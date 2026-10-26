import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import { inventoryItemsTable, operationsPlansTable, salesOrdersTable } from "../db/schema";
import { requireAuth, requirePermission } from "../middleware/auth";
import { writeAuditEvent } from "../lib/governance";
import { nextPhase0Number } from "../lib/phase0";
import { notifyRoles, notifyUser } from "../lib/notifications";
import { parseIdParam } from "../lib/validate";
import { OPERATIONS_CONTROL_ACTIONS, OPERATIONS_CONTROL_ROLES } from "../lib/operations-control-policy";
import { PLAN_LEVEL_ROLES, approvalLevelFor, checkPlanDecision, planShortageValue, type PlanLevel } from "../lib/operationsCenterCore";
import { buildSalesOrderPlan } from "./operations-control";

const router = Router();
const VIEW_ROLES = OPERATIONS_CONTROL_ROLES.caseView as readonly string[];

const createSchema = z.object({
  salesOrderId: z.number().int().positive(),
  caseId: z.number().int().positive().optional(),
  notes: z.string().trim().max(500).optional(),
});
const decisionSchema = z.object({ note: z.string().trim().max(500).default("") });

const LEVEL_REASONS: Record<string, string> = {
  ROLE_NOT_ALLOWED: "مستوى الاعتماد المطلوب أعلى من صلاحية دورك",
  SELF_APPROVAL: "مينفعش تعتمد خطة إنت اللي رفعتها، لازم حد تاني",
  NOTE_REQUIRED: "الخطة فوق 200 ألف ومحتاجة سبب مكتوب (3 حروف على الأقل)",
};

function planError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code });
}

type PlanRow = typeof operationsPlansTable.$inferSelect;
const summary = (p: PlanRow) => ({
  id: p.id,
  planNumber: p.planNumber,
  salesOrderId: p.salesOrderId,
  caseId: p.caseId,
  status: p.status,
  shortageValue: p.shortageValue,
  approvalLevel: p.approvalLevel,
  createdByName: p.createdByName,
  submittedBy: p.submittedBy,
  decidedByName: p.decidedByName,
  createdAt: p.createdAt,
  submittedAt: p.submittedAt,
  decidedAt: p.decidedAt,
});

/** حفظ الخطة كمسودة: لقطة من التحليل الحالي مع قيمة العجز والمستوى. أي مسودة أو خطة مرسلة قديمة لنفس الأمر بتتعلّم superseded. */
router.post("/operations-center/plans", requireAuth, requirePermission(OPERATIONS_CONTROL_ACTIONS.planCreate), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body ?? {});
    const built = await buildSalesOrderPlan(data.salesOrderId);
    if (!built) throw planError(404, "SALES_ORDER_NOT_FOUND", "طلب البيع غير موجود");

    const shortages = built.plan.flatMap((p) => p.purchaseShortages);
    const ids = [...new Set(shortages.map((s) => s.inventoryItemId).filter((x): x is number => typeof x === "number"))];
    const prices = ids.length
      ? await db.select({ id: inventoryItemsTable.id, unitPrice: inventoryItemsTable.unitPrice }).from(inventoryItemsTable).where(inArray(inventoryItemsTable.id, ids))
      : [];
    const priceOf = new Map(prices.map((p) => [p.id, p.unitPrice]));
    const value = planShortageValue(shortages.map((s) => ({ shortageQty: s.shortageQty, unitPrice: s.inventoryItemId ? priceOf.get(s.inventoryItemId) ?? null : null })));
    const level = approvalLevelFor(value);

    const created = await db.transaction(async (tx) => {
      await tx.update(operationsPlansTable).set({ status: "superseded", updatedAt: new Date() })
        .where(and(eq(operationsPlansTable.salesOrderId, data.salesOrderId), inArray(operationsPlansTable.status, ["draft", "submitted"])));
      const planNumber = await nextPhase0Number(tx, "operations_plan");
      const [row] = await tx.insert(operationsPlansTable).values({
        planNumber,
        salesOrderId: data.salesOrderId,
        caseId: data.caseId ?? null,
        snapshot: { plan: built.plan, salesOrderNumber: built.salesOrder.orderNumber },
        shortageValue: String(value),
        approvalLevel: level,
        notes: data.notes ?? null,
        createdBy: req.user!.userId,
        createdByName: req.user!.username,
      }).returning();
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "operations.plan.create", resourceType: "operations_plan", resourceId: row!.id, afterData: { planNumber, salesOrderId: data.salesOrderId, shortageValue: value, level }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      return row!;
    });
    res.status(201).json({ ...summary(created), snapshot: created.snapshot, notes: created.notes });
  } catch (err) { next(err); }
});

router.get("/operations-center/plans", requireAuth, async (req, res, next) => {
  try {
    if (!VIEW_ROLES.includes(req.user!.role)) { res.status(403).json({ error: { message: "غير مصرح" } }); return; }
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const salesOrderId = Number(req.query.salesOrderId) || null;
    const rows = await db.select().from(operationsPlansTable).where(and(
      status ? eq(operationsPlansTable.status, status) : ne(operationsPlansTable.status, "superseded"),
      salesOrderId ? eq(operationsPlansTable.salesOrderId, salesOrderId) : undefined,
    )).orderBy(desc(operationsPlansTable.createdAt)).limit(200);
    const orderIds = [...new Set(rows.map((r) => r.salesOrderId))];
    const orders = orderIds.length ? await db.select({ id: salesOrdersTable.id, orderNumber: salesOrdersTable.orderNumber }).from(salesOrdersTable).where(inArray(salesOrdersTable.id, orderIds)) : [];
    const no = new Map(orders.map((o) => [o.id, o.orderNumber]));
    res.json(rows.map((r) => ({ ...summary(r), salesOrderNumber: no.get(r.salesOrderId) ?? null })));
  } catch (err) { next(err); }
});

router.get("/operations-center/plans/:id", requireAuth, async (req, res, next) => {
  try {
    if (!VIEW_ROLES.includes(req.user!.role)) { res.status(403).json({ error: { message: "غير مصرح" } }); return; }
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [row] = await db.select().from(operationsPlansTable).where(eq(operationsPlansTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: { message: "الخطة غير موجودة" } }); return; }
    res.json({ ...summary(row), snapshot: row.snapshot, notes: row.notes, decisionNote: row.decisionNote });
  } catch (err) { next(err); }
});

/** إرسال للاعتماد. لو القيمة تحت 10 آلاف بتتعتمد تلقائيًا بسجل تدقيق، غير كده بتتبلّغ الأدوار المناسبة للمستوى. */
router.post("/operations-center/plans/:id/submit", requireAuth, requirePermission(OPERATIONS_CONTROL_ACTIONS.planSubmit), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const result = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(operationsPlansTable).where(eq(operationsPlansTable.id, id)).for("update");
      if (!row) throw planError(404, "PLAN_NOT_FOUND", "الخطة غير موجودة");
      if (row.status !== "draft") throw planError(409, "PLAN_NOT_DRAFT", "الخطة مش مسودة");
      const auto = row.approvalLevel === 0;
      const now = new Date();
      const [updated] = await tx.update(operationsPlansTable).set(auto
        ? { status: "approved", submittedBy: req.user!.userId, submittedAt: now, decidedBy: req.user!.userId, decidedByName: req.user!.username, decidedAt: now, decisionNote: "اعتماد تلقائي: القيمة تحت حد المراجعة", updatedAt: now }
        : { status: "submitted", submittedBy: req.user!.userId, submittedAt: now, updatedAt: now })
        .where(eq(operationsPlansTable.id, id)).returning();
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: auto ? "operations.plan.autoApprove" : "operations.plan.submit", resourceType: "operations_plan", resourceId: id, beforeData: { status: "draft" }, afterData: { status: updated!.status, level: row.approvalLevel }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      return updated!;
    });
    if (result.status === "submitted") {
      const roles = PLAN_LEVEL_ROLES[result.approvalLevel as PlanLevel].filter((r) => r !== req.user!.role);
      await notifyRoles([...roles], { type: "operations_plan_submitted", title: `خطة تشغيل ${result.planNumber} محتاجة اعتمادك`, body: `قيمة عجز الخامات ${result.shortageValue} جنيه (مستوى ${result.approvalLevel}).`, referenceType: "operations_plan", referenceId: result.id }).catch(() => undefined);
    }
    res.json(summary(result));
  } catch (err) { next(err); }
});

async function decide(req: Request, res: Response, next: NextFunction, to: "approved" | "rejected") {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const { note } = decisionSchema.parse(req.body ?? {});
    if (to === "rejected" && note.length < 3) throw planError(422, "NOTE_REQUIRED", "اكتب سبب الرفض (3 حروف على الأقل)");
    const result = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(operationsPlansTable).where(eq(operationsPlansTable.id, id)).for("update");
      if (!row) throw planError(404, "PLAN_NOT_FOUND", "الخطة غير موجودة");
      if (row.status !== "submitted") throw planError(409, "PLAN_NOT_SUBMITTED", "الخطة مش مستنية اعتماد");
      const check = checkPlanDecision({ role: req.user!.role, userId: req.user!.userId, level: row.approvalLevel as PlanLevel, submittedBy: row.submittedBy, note });
      // الرفض مسموح لصاحب الخطة (سحب)، وبدون سبب 3 حروف المنطق فوق بيطلبه.
      if (!check.ok && !(to === "rejected" && check.code !== "ROLE_NOT_ALLOWED")) throw planError(403, `PLAN_${check.code}`, LEVEL_REASONS[check.code]!);
      const [updated] = await tx.update(operationsPlansTable).set({ status: to, decidedBy: req.user!.userId, decidedByName: req.user!.username, decidedAt: new Date(), decisionNote: note || null, updatedAt: new Date() }).where(eq(operationsPlansTable.id, id)).returning();
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: to === "approved" ? "operations.plan.approve" : "operations.plan.reject", resourceType: "operations_plan", resourceId: id, beforeData: { status: "submitted" }, afterData: { status: to, level: row.approvalLevel }, reason: note || null, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      return updated!;
    });
    if (result.submittedBy) {
      await notifyUser(result.submittedBy, { type: "operations_plan_decided", title: `خطة ${result.planNumber} ${to === "approved" ? "اتعتمدت" : "اترفضت"}`, body: result.decisionNote ?? "", referenceType: "operations_plan", referenceId: result.id }).catch(() => undefined);
    }
    res.json(summary(result));
  } catch (err) { next(err); }
}
router.post("/operations-center/plans/:id/approve", requireAuth, (req, res, next) => void decide(req, res, next, "approved"));
router.post("/operations-center/plans/:id/reject", requireAuth, (req, res, next) => void decide(req, res, next, "rejected"));

export default router;
