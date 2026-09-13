import { Router } from "express";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db, delegationsTable, approvalPoliciesTable, approvalRequestsTable, auditEventsTable, systemUsersTable, salesOrdersTable, salesOrderItemsTable, productionCostEntriesTable, permissionOverridesTable } from "../db";
import { releaseStockReservation, applyStockMovement } from "../lib/stock";
import { requireAuth, requireRole, requirePermission } from "../middleware/auth";
import { createDelegationSchema } from "../db/schema/governance";
import { ACTION_REGISTRY } from "../lib/actionRegistry";
import { z } from "zod";
import { writeAuditEvent } from "../lib/governance";
import { checkSoDViolation } from "../lib/approvals";
import { getEffectiveRoles } from "../lib/delegation";
import { createHash } from "node:crypto";
import { USER_ROLES } from "../lib/roles";

const router = Router();
router.use("/governance", requireAuth);

// ✨ GET /governance/users — قائمة مبسّطة (id/الاسم/الدور) لتغذية قوائم
// الاختيار (select) في شاشة الحوكمة بدل كتابة معرّف المستخدم يدويًا.
// متاحة لنفس أدوار شاشة الحوكمة (chairman + executive_manager) بخلاف
// GET /users في settings.ts اللي مقصورة على chairman فقط.
router.get("/governance/users", requireRole("chairman", "executive_manager"), async (_req, res, next) => {
  try {
    const users = await db.select({
      id: systemUsersTable.id,
      fullName: systemUsersTable.fullName,
      username: systemUsersTable.username,
      role: systemUsersTable.role,
      status: systemUsersTable.status,
    }).from(systemUsersTable).orderBy(systemUsersTable.fullName);
    res.json(users);
  } catch (err) { next(err); }
});

router.get("/governance/delegations", requireRole("chairman", "executive_manager"), async (req, res, next) => {
  try {
    const rows = await db.select({
      delegation: delegationsTable,
      grantorName: systemUsersTable.fullName,
    }).from(delegationsTable)
      .innerJoin(systemUsersTable, eq(delegationsTable.grantorUserId, systemUsersTable.id))
      .orderBy(desc(delegationsTable.createdAt));
    res.json(rows);
  } catch (err) { next(err); }
});

router.post("/governance/delegations", requireRole("chairman", "executive_manager"), async (req, res, next) => {
  try {
    const data = createDelegationSchema.parse(req.body);
    if (!ACTION_REGISTRY.some((a) => a.key === data.actionKey)) {
      res.status(400).json({ error: { message: "الإجراء غير موجود في سجل الإجراءات" } }); return;
    }
    if (req.user!.role !== "chairman" && data.grantorUserId !== req.user!.userId) {
      res.status(403).json({ error: { message: "المدير يستطيع تفويض صلاحياته فقط" } }); return;
    }
    const [grantor] = await db.select({ role: systemUsersTable.role }).from(systemUsersTable)
      .where(eq(systemUsersTable.id, data.grantorUserId)).limit(1);
    const action = ACTION_REGISTRY.find((item) => item.key === data.actionKey);
    if (!grantor || !action?.defaultRoles.includes(grantor.role as never)) {
      res.status(403).json({ error: { message: "صاحب التفويض لا يملك الصلاحية الأصلية لهذا الإجراء" } }); return;
    }
    const [delegate] = await db.select({ id: systemUsersTable.id }).from(systemUsersTable)
      .where(eq(systemUsersTable.id, data.delegateUserId)).limit(1);
    if (!delegate) { res.status(404).json({ error: { message: "المستخدم المفوض إليه غير موجود" } }); return; }
    const [created] = await db.insert(delegationsTable).values({
      ...data, maxAmount: data.maxAmount ?? null, scopeId: data.scopeId ?? null,
      startsAt: new Date(data.startsAt), endsAt: new Date(data.endsAt),
    }).returning();
    await writeAuditEvent({
      actorUserId: req.user!.userId,
      actorName: req.user!.username,
      actionKey: "governance.manageDelegations",
      resourceType: "delegation",
      resourceId: created.id,
      afterData: created,
      reason: data.reason,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

router.patch("/governance/delegations/:id/revoke", requireRole("chairman", "executive_manager"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: { message: "معرّف غير صالح" } }); return; }
    const [before] = await db.select().from(delegationsTable)
      .where(eq(delegationsTable.id, id)).limit(1);
    if (!before || before.revokedAt) {
      res.status(404).json({ error: { message: "التفويض غير موجود أو ملغي" } }); return;
    }
    if (req.user!.role !== "chairman" && before.grantorUserId !== req.user!.userId) {
      res.status(403).json({ error: { message: "لا يمكنك إلغاء تفويض لا تملكه" } }); return;
    }
    const [updated] = await db.update(delegationsTable).set({
      status: "revoked", revokedAt: new Date(), revokedBy: req.user!.userId,
    }).where(and(eq(delegationsTable.id, id), isNull(delegationsTable.revokedAt))).returning();
    if (!updated) { res.status(404).json({ error: { message: "التفويض غير موجود أو ملغي" } }); return; }
    await writeAuditEvent({
      actorUserId: req.user!.userId,
      actorName: req.user!.username,
      actionKey: "governance.manageDelegations",
      resourceType: "delegation",
      resourceId: id,
      beforeData: before,
      afterData: updated,
      decision: "revoked",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.get("/governance/audit", requireRole("chairman", "executive_manager"), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    res.json(await db.select().from(auditEventsTable).orderBy(desc(auditEventsTable.createdAt)).limit(limit));
  } catch (err) { next(err); }
});

router.get("/governance/approval-policies", requireRole("executive_manager", "sales_manager", "chairman"), async (_req, res, next) => {
  try { res.json(await db.select().from(approvalPoliciesTable).orderBy(approvalPoliciesTable.actionKey, approvalPoliciesTable.minAmount)); }
  catch (err) { next(err); }
});

router.get("/governance/approval-requests", requireRole("chairman", "executive_manager", "sales_manager", "purchasing_manager", "hr_manager", "production_manager", "operations_manager"), async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    if (!["pending", "approved", "rejected"].includes(status)) {
      res.status(400).json({ error: { message: "حالة طلب الاعتماد غير صحيحة" } }); return;
    }
    const requests = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.status, status)).orderBy(desc(approvalRequestsTable.createdAt));
    let roles = [req.user!.role];
    try { roles = await getEffectiveRoles(req.user!.userId); } catch { /* safe fallback */ }
    const policies = await db.select().from(approvalPoliciesTable).where(eq(approvalPoliciesTable.active, true));
    res.json(requests.filter((request) => policies.some((p) =>
      p.actionKey === request.actionKey && p.sequence === request.currentStep &&
      (p.approverRoles as string[]).some((role) => roles.includes(role)),
    )));
  } catch (err) { next(err); }
});

const approvalPolicySchema = z.object({
  actionKey: z.string().min(1).max(120),
  minAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  approverRoles: z.array(z.string().min(1)).min(1),
  sequence: z.number().int().positive().optional(),
  requiredApprovals: z.literal(1).optional(),
  active: z.boolean().optional(),
});

router.post("/governance/approval-policies", requirePermission("governance.managePolicies"), async (req, res, next) => {
  try {
    const data = approvalPolicySchema.parse(req.body);
    if (!ACTION_REGISTRY.some((action) => action.key === data.actionKey)) {
      res.status(400).json({ error: { message: "الإجراء غير موجود في سجل الإجراءات" } });
      return;
    }
    const [created] = await db.insert(approvalPoliciesTable).values({
      actionKey: data.actionKey, minAmount: data.minAmount,
      approverRoles: data.approverRoles, sequence: data.sequence ?? 1,
      requiredApprovals: data.requiredApprovals ?? 1, active: data.active ?? true,
    }).returning();
    await writeAuditEvent({
      actorUserId: req.user!.userId, actorName: req.user!.username,
      actionKey: "governance.managePolicies", resourceType: "approval_policy",
      resourceId: created.id, afterData: created, ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

router.patch("/governance/approval-policies/:id", requirePermission("governance.managePolicies"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: { message: "معرّف السياسة غير صالح" } }); return;
    }
    const data = approvalPolicySchema.partial().parse(req.body);
    if (data.actionKey && !ACTION_REGISTRY.some((action) => action.key === data.actionKey)) {
      res.status(400).json({ error: { message: "الإجراء غير موجود في سجل الإجراءات" } }); return;
    }
    const [before] = await db.select().from(approvalPoliciesTable).where(eq(approvalPoliciesTable.id, id)).limit(1);
    if (!before) { res.status(404).json({ error: { message: "سياسة الاعتماد غير موجودة" } }); return; }
    const [updated] = await db.update(approvalPoliciesTable).set(data)
      .where(eq(approvalPoliciesTable.id, id)).returning();
    await writeAuditEvent({
      actorUserId: req.user!.userId, actorName: req.user!.username,
      actionKey: "governance.managePolicies", resourceType: "approval_policy",
      resourceId: id, beforeData: before, afterData: updated,
      ipAddress: req.ip, userAgent: req.get("user-agent"),
    });
    res.json(updated);
  } catch (err) { next(err); }
});

router.patch("/governance/approval-requests/:id/decide", requireRole("chairman", "executive_manager", "sales_manager", "purchasing_manager", "hr_manager", "production_manager", "operations_manager"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const decision = z.object({
      decision: z.enum(["approve", "reject"]).optional(),
      approved: z.boolean().optional(),
      note: z.string().max(500).optional(),
    }).refine((value) => value.decision !== undefined || value.approved !== undefined, {
      message: "يجب تحديد قرار الاعتماد",
    }).parse(req.body);
    const [request] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, id)).limit(1);
    if (!request || request.status !== "pending") {
      res.status(404).json({ error: { message: "طلب الاعتماد غير موجود أو تم اتخاذ قرار بشأنه" } });
      return;
    }
    const approved = decision.decision ? decision.decision === "approve" : decision.approved === true;
    const policy = await db.select().from(approvalPoliciesTable).where(and(
      eq(approvalPoliciesTable.actionKey, request.actionKey),
      eq(approvalPoliciesTable.sequence, request.currentStep),
      eq(approvalPoliciesTable.active, true),
    )).limit(1);
    const [nextPolicy] = await db.select({ sequence: approvalPoliciesTable.sequence }).from(approvalPoliciesTable)
      .where(and(
        eq(approvalPoliciesTable.actionKey, request.actionKey),
        eq(approvalPoliciesTable.active, true),
        gt(approvalPoliciesTable.sequence, request.currentStep),
      )).orderBy(approvalPoliciesTable.sequence).limit(1);
    let effectiveRoles = [req.user!.role];
    try { effectiveRoles = await getEffectiveRoles(req.user!.userId); } catch { /* safe fallback */ }
    if (!policy[0] || !(policy[0].approverRoles as string[]).some((role) => effectiveRoles.includes(role))) {
      res.status(403).json({ error: { message: "ليس لديك دور معتمد لهذه الخطوة من طلب الاعتماد" } }); return;
    }
    if (approved && await checkSoDViolation(req.user!.userId, request.actionKey, request.resourceType, request.resourceId)) {
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: request.actionKey, resourceType: request.resourceType, resourceId: request.resourceId, decision: "rejected_sod", reason: "لا يمكن لمنشئ المورد اعتماده" });
      res.status(403).json({ error: { message: "لا يمكن اعتماد المورد بواسطة نفس المستخدم الذي أنشأه" } }); return;
    }
    const status = approved ? "approved" : "rejected";
    const result = await db.transaction(async (tx) => {
      const [updatedRequest] = await tx.update(approvalRequestsTable).set({
        status: approved && nextPolicy ? "pending" : status,
        currentStep: approved && nextPolicy ? nextPolicy.sequence : request.currentStep,
        decisionNote: decision.note ?? null,
        decidedAt: new Date(),
      }).where(and(eq(approvalRequestsTable.id, id), eq(approvalRequestsTable.status, "pending"))).returning();
      if (!updatedRequest) throw Object.assign(new Error("تم تحديث طلب الاعتماد بالفعل"), { status: 409 });
      if (updatedRequest.status !== "pending") {
        if (request.resourceType === "sales_order") {
          // ✅ إصلاح باگ حرج: قبل هذا الإصلاح كان الرفض يكتفي بتغيير حالة
          // الأمر لـ "cancelled" من غير أي عكس فعلي — لو الأمر اتعمل وقت
          // الإنشاء بحالة "confirmed" (حجز مخزون) أو "shipped"/"paid"
          // (خصم فعلي من المخزون)، الحجز/الخصم ده كان بيفضل عالق للأبد
          // حتى بعد الرفض، وده بيسبب فرق حقيقي في أرقام المخزون.
          const originalStatus =
            typeof request.metadata === "object" && request.metadata !== null &&
            "originalStatus" in request.metadata && typeof request.metadata.originalStatus === "string"
              ? request.metadata.originalStatus : "confirmed";

          const [salesOrder] = await tx.select().from(salesOrdersTable)
            .where(eq(salesOrdersTable.id, request.resourceId)).limit(1);

          if (salesOrder) {
            if (approved) {
              // ✅ نرجّع الأمر لحالته الأصلية اللي كانت مطلوبة وقت الإنشاء
              // (مش نثبّته دايمًا على "confirmed" بغض النظر عن حالته الحقيقية)
              await tx.update(salesOrdersTable).set({ status: originalStatus, updatedAt: new Date() })
                .where(eq(salesOrdersTable.id, request.resourceId));
            } else {
              const items = await tx.select().from(salesOrderItemsTable)
                .where(eq(salesOrderItemsTable.orderId, request.resourceId));
              if (originalStatus === "confirmed") {
                for (const item of items) {
                  if (item.inventoryItemId) await releaseStockReservation(tx, item.inventoryItemId, item.qty);
                }
              } else if (["shipped", "paid"].includes(originalStatus)) {
                for (const item of items) {
                  if (item.inventoryItemId) await applyStockMovement(tx, {
                    inventoryItemId: item.inventoryItemId, movementType: "in", qty: item.qty,
                    referenceType: "sales_order", referenceId: request.resourceId,
                    notes: `استرجاع تلقائي — رفض اعتماد أمر بيع ${salesOrder.orderNumber}`,
                  });
                }
              }
              // ✅ عكس قيد "التزام غير مدفوع" المسجّل على رصيد العميل وقت
              // الإنشاء (لو كانت الحالة الأصلية confirmed/shipped)، بنفس
              // منطق الإلغاء الموجود بالفعل في PATCH /sales/:id.
              // (Phase 2: contact-balance/credit-ledger feature removed —
              // this system carries no accounting logic. Stock reversal
              // above still applies; only the balance adjustment is gone.)
              await tx.update(salesOrdersTable).set({ status: "cancelled", updatedAt: new Date() })
                .where(eq(salesOrdersTable.id, request.resourceId));
            }
          }
        }
        if (request.resourceType === "production_cost_entry") {
          await tx.update(productionCostEntriesTable)
            .set({ status: approved ? "approved" : "rejected" })
            .where(eq(productionCostEntriesTable.id, request.resourceId));
        }
      }
      return updatedRequest;
    });
    await writeAuditEvent({
      actorUserId: req.user!.userId,
      actorName: req.user!.username,
      actionKey: request.actionKey,
      resourceType: request.resourceType,
      resourceId: request.resourceId,
         decision: approved ? "approved" : "rejected",
      reason: decision.note,
      afterData: result,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.get("/governance/simulate", requireRole("chairman"), async (req, res, next) => {
  try {
    const role = typeof req.query.role === "string" ? req.query.role : "";
    if (role && !(USER_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: { message: "دور المستخدم غير معتمد" } }); return;
    }
    const userId = req.query.userId ? Number(req.query.userId) : null;
    let roles = role ? [role] : [];
    if (userId && Number.isInteger(userId)) {
      const [user] = await db.select({ role: systemUsersTable.role }).from(systemUsersTable)
        .where(eq(systemUsersTable.id, userId)).limit(1);
      if (!user) { res.status(404).json({ error: { message: "المستخدم غير موجود" } }); return; }
      try { roles = await getEffectiveRoles(userId); } catch { roles = [user.role]; }
    }
    const overrides = userId ? await db.select().from(permissionOverridesTable).where(and(
      eq(permissionOverridesTable.userId, userId),
      isNull(permissionOverridesTable.revokedAt),
      or(isNull(permissionOverridesTable.expiresAt), gt(permissionOverridesTable.expiresAt, new Date())),
    )) : [];
    res.json(ACTION_REGISTRY.map((action) => {
      const override = overrides.find((item) => item.actionKey === action.key);
      return { key: action.key, label: action.label, allowed: override ? override.allowed : action.defaultRoles.some((r) => roles.includes(r)) || roles.includes(action.key) };
    }));
  } catch (err) { next(err); }
});

router.get("/governance/audit-events/verify", requireRole("chairman"), async (_req, res, next) => {
  try {
    const rows = await db.select().from(auditEventsTable).orderBy(auditEventsTable.id);
    let prevHash: string | null = null;
    for (const row of rows) {
      const expected: string = createHash("sha256").update([
        prevHash ?? "", row.actorUserId ?? "", row.actionKey, row.resourceId ?? "", row.createdAt.toISOString(),
      ].join("")).digest("hex");
      if (row.prevHash !== prevHash || row.recordHash !== expected) {
        res.json({ valid: false, firstInvalidId: row.id }); return;
      }
      prevHash = row.recordHash;
    }
    res.json({ valid: true, count: rows.length });
  } catch (err) { next(err); }
});

export default router;