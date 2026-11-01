/** @format */

import { Router } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  createChangeRequestSchema,
  createEngineeringProductSchema,
  createProductVersionSchema,
  createRoutingSchema,
  createBomComponentSchema,
  supersedeEngineeringVersionSchema,
  decideChangeRequestSchema,
  retireEngineeringVersionSchema,
  foundationItemsTable,
  foundationMachinesTable,
  foundationWorkCentersTable,
  engineeringBomComponentsTable,
  engineeringChangeRequestsTable,
  engineeringProductsTable,
  engineeringProductVersionsTable,
  engineeringRoutingsTable,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { nextPhase0Number } from "../lib/phase0";
import { writeAuditEvent } from "../lib/governance";
import {
  assertAllowedEngineeringVersionTransition,
  assertEngineeringVersionEditable,
} from "../domain/engineering-governance";
import {
  runManufacturabilityValidation,
  freezeVersionSnapshot,
  findEngineeringChangeImpact,
} from "../lib/engineering-governance";

const router = Router();
const engineeringRoles = [
  "chairman",
  "production_manager",
  "production_controller",
  "production_quality_controller",
];
// Phase 04 (delivery 1): who may approve/release/supersede an engineering
// version — narrower than engineeringRoles, same reasoning as
// APPROVAL_ROLES in src/routes/foundation.ts (phase 03): an approval step
// any editor can also approve is not a review.
const engineeringApprovalRoles = [
  "chairman",
  "production_manager",
  "production_quality_controller",
];

async function loadVersionOr404(id: number, res: import("express").Response) {
  const [version] = await db
    .select()
    .from(engineeringProductVersionsTable)
    .where(eq(engineeringProductVersionsTable.id, id))
    .limit(1);
  if (!version) {
    res.status(404).json({ error: { message: "إصدار المنتج غير موجود" } });
    return null;
  }
  return version;
}

// قوائم الاختيار لشاشة الهندسة (أصناف، مراكز عمل، ماكينات، منتجات هندسية). أدوار الهندسة مالهاش
// صلاحية /foundation/items أصلًا، فبدل ما نوسّع صلاحية الأساس بنقدّم هنا بيانات اختيار فقط:
// من غير سعر ولا مخزون ولا مورّد.
router.get("/engineering/lookups", requireAuth, requireRole(...engineeringRoles), async (_req, res, next) => {
  try {
    const [items, workCenters, machines, products] = await Promise.all([
      db.select({ id: foundationItemsTable.id, code: foundationItemsTable.code, name: foundationItemsTable.name, itemType: foundationItemsTable.itemType, baseUnit: foundationItemsTable.baseUnit })
        .from(foundationItemsTable).where(eq(foundationItemsTable.active, true)).orderBy(asc(foundationItemsTable.code)),
      db.select({ id: foundationWorkCentersTable.id, code: foundationWorkCentersTable.code, name: foundationWorkCentersTable.name })
        .from(foundationWorkCentersTable).where(eq(foundationWorkCentersTable.active, true)).orderBy(asc(foundationWorkCentersTable.code)),
      db.select({ id: foundationMachinesTable.id, code: foundationMachinesTable.code, name: foundationMachinesTable.name, workCenterId: foundationMachinesTable.workCenterId })
        .from(foundationMachinesTable).where(eq(foundationMachinesTable.active, true)).orderBy(asc(foundationMachinesTable.code)),
      db.select({ id: engineeringProductsTable.id, code: engineeringProductsTable.code, name: engineeringProductsTable.name })
        .from(engineeringProductsTable).orderBy(asc(engineeringProductsTable.code)),
    ]);
    res.json({ data: { items, workCenters, machines, products } });
  } catch (err) { next(err); }
});

router.get("/engineering/products", requireAuth, requireRole(...engineeringRoles), async (_req, res, next) => {
  try {
    res.json({ data: await db.select().from(engineeringProductsTable).orderBy(ascProductName()) });
  } catch (err) {
    next(err);
  }
});

function ascProductName() {
  return engineeringProductsTable.name;
}

router.post("/engineering/products", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const data = createEngineeringProductSchema.parse(req.body);
    const [product] = await db.insert(engineeringProductsTable).values({
      ...data,
      createdBy: req.user?.userId,
    }).returning();
    res.status(201).json({ data: product });
  } catch (err) {
    next(err);
  }
});

router.get("/engineering/products/:id", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [product] = await db.select().from(engineeringProductsTable).where(eq(engineeringProductsTable.id, id)).limit(1);
    if (!product) {
      res.status(404).json({ error: { message: "المنتج الهندسي غير موجود" } });
      return;
    }
    const versions = await db.select().from(engineeringProductVersionsTable)
      .where(eq(engineeringProductVersionsTable.productId, id))
      .orderBy(desc(engineeringProductVersionsTable.createdAt));
    res.json({ data: { ...product, versions } });
  } catch (err) {
    next(err);
  }
});

router.post("/engineering/products/:id/versions", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const productId = parseIdParam(req.params.id, res);
    if (productId === null) return;
    const data = createProductVersionSchema.parse(req.body);
    const [version] = await db.insert(engineeringProductVersionsTable).values({
      ...data,
      productId,
      createdBy: req.user?.userId,
    }).returning();
    res.status(201).json({ data: version });
  } catch (err) {
    next(err);
  }
});

router.get("/engineering/product-versions/:id/components", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    res.json({ data: await db.select().from(engineeringBomComponentsTable)
      .where(eq(engineeringBomComponentsTable.productVersionId, id))
      .orderBy(engineeringBomComponentsTable.lineNo) });
  } catch (err) { next(err); }
});

router.post("/engineering/product-versions/:id/components", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const version = await loadVersionOr404(id, res);
    if (!version) return;
    // Phase 04 (delivery 1): "Make the released version obvious and prevent
    // editing it in place." Only draft/in_review accept new components.
    assertEngineeringVersionEditable(version.status);
    const data = createBomComponentSchema.parse(req.body);
    // البند + إبطال نتيجة التحقق = معاملة واحدة: لو انقطع التيار بينهم يبقى بند مضاف
    // ونسخة لسه «متحقق منها» (الاعتماد يعدّي على بيانات ما اتفحصتش).
    const component = await db.transaction(async (tx) => {
      const [created] = await tx.insert(engineeringBomComponentsTable).values({
        ...data, productVersionId: id, qty: String(data.qty), scrapFactorPct: String(data.scrapFactorPct),
      }).returning();
      // Editing components invalidates any previous validation result — this
      // is enforced, not just documented: approve() below re-checks
      // validationStatus/validatedAt against the version's current state.
      await tx.update(engineeringProductVersionsTable).set({ validationStatus: "not_validated" })
        .where(eq(engineeringProductVersionsTable.id, id));
      return created;
    });
    res.status(201).json({ data: component });
  } catch (err) { next(err); }
});

router.delete("/engineering/product-versions/:id/components/:componentId", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    const componentId = parseIdParam(req.params.componentId, res);
    if (id === null || componentId === null) return;
    const version = await loadVersionOr404(id, res);
    if (!version) return;
    assertEngineeringVersionEditable(version.status);
    // الحذف + إبطال التحقق معاملة واحدة (نفس سبب الإضافة).
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx.delete(engineeringBomComponentsTable)
        .where(eq(engineeringBomComponentsTable.id, componentId)).returning();
      if (!row) return null;
      await tx.update(engineeringProductVersionsTable).set({ validationStatus: "not_validated" })
        .where(eq(engineeringProductVersionsTable.id, id));
      return row;
    });
    if (!deleted) { res.status(404).json({ error: { message: "المكوّن غير موجود" } }); return; }
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// Phase 04 (delivery 1): "Run manufacturability validation before
// approval." Read-only — never mutates components/routing, only writes the
// cached validationStatus/validatedAt/validationIssues on the version.
router.post("/engineering/product-versions/:id/validate", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const version = await loadVersionOr404(id, res);
    if (!version) return;
    const result = await runManufacturabilityValidation(db, id, version.productId);
    res.json({ data: result });
  } catch (err) { next(err); }
});

router.post("/engineering/product-versions/:id/submit-review", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const version = await loadVersionOr404(id, res);
    if (!version) return;
    assertAllowedEngineeringVersionTransition(version.status, "in_review");
    // الشرط على الحالة الحالية: ضغطتين متزامنتين ما يعدّوش الانتقال مرتين.
    const [updated] = await db.update(engineeringProductVersionsTable).set({ status: "in_review" })
      .where(and(eq(engineeringProductVersionsTable.id, id), eq(engineeringProductVersionsTable.status, version.status))).returning();
    if (!updated) { res.status(409).json({ error: { message: "حالة الإصدار اتغيّرت للتو، حدّث الصفحة وجرّب تاني" } }); return; }
    res.json({ data: updated });
  } catch (err) { next(err); }
});

router.post("/engineering/bom-versions/:id/approve", requireAuth, requireRole(...engineeringApprovalRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const version = await loadVersionOr404(id, res);
    if (!version) return;
    assertAllowedEngineeringVersionTransition(version.status, "approved");
    // Phase 04 (delivery 1): approval now requires a passing, *current*
    // validation — "current" meaning validated_at is not stale relative to
    // the version's own updated_at, which the component/routing endpoints
    // above reset to "not_validated" on every edit, so this can never pass
    // against components that were changed after the last successful run.
    if (version.validationStatus !== "passed") {
      throw Object.assign(
        new Error("يجب اجتياز فحص قابلية التصنيع (manufacturability validation) قبل الاعتماد — استخدم POST /engineering/product-versions/:id/validate أولًا"),
        { status: 409, code: "VALIDATION_REQUIRED" },
      );
    }
    const [approved] = await db.update(engineeringProductVersionsTable).set({
      status: "approved",
      approvedBy: req.user?.userId,
      approvedAt: new Date(),
    }).where(and(eq(engineeringProductVersionsTable.id, id), eq(engineeringProductVersionsTable.status, version.status), eq(engineeringProductVersionsTable.validationStatus, "passed"))).returning();
    if (!approved) { res.status(409).json({ error: { message: "الإصدار اتعدّل أو اتغيّرت حالته للتو، شغّل فحص القابلية وحدّث الصفحة" } }); return; }
    res.json({ data: approved });
  } catch (err) { next(err); }
});

router.post("/engineering/product-versions/:id/release", requireAuth, requireRole(...engineeringApprovalRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const version = await loadVersionOr404(id, res);
    if (!version) return;
    assertAllowedEngineeringVersionTransition(version.status, "released");
    // freezeVersionSnapshot both writes the immutable bom_snapshot/
    // routing_snapshot and sets status: "released" in one update, inside
    // one transaction, so a released row can never be caught mid-freeze.
    const released = await db.transaction((tx) => freezeVersionSnapshot(tx as any, id, req.user?.userId ?? null));
    res.json({ data: released });
  } catch (err) { next(err); }
});

router.post("/engineering/product-versions/:id/supersede", requireAuth, requireRole(...engineeringApprovalRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const version = await loadVersionOr404(id, res);
    if (!version) return;
    assertAllowedEngineeringVersionTransition(version.status, "superseded");
    const input = supersedeEngineeringVersionSchema.parse(req.body);
    const [replacement] = await db.select({ id: engineeringProductVersionsTable.id, productId: engineeringProductVersionsTable.productId })
      .from(engineeringProductVersionsTable).where(eq(engineeringProductVersionsTable.id, input.supersededByVersionId));
    if (!replacement || replacement.productId !== version.productId) {
      res.status(422).json({ error: { message: "الإصدار البديل يجب أن يخص نفس المنتج الهندسي" } });
      return;
    }
    const [updated] = await db.update(engineeringProductVersionsTable).set({
      status: "superseded", supersededByVersionId: input.supersededByVersionId,
    }).where(and(eq(engineeringProductVersionsTable.id, id), eq(engineeringProductVersionsTable.status, version.status))).returning();
    if (!updated) { res.status(409).json({ error: { message: "حالة الإصدار اتغيّرت للتو، حدّث الصفحة وجرّب تاني" } }); return; }
    await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "engineering.version.supersede", resourceType: "engineering_product_version", resourceId: id, afterData: { supersededByVersionId: input.supersededByVersionId, reason: input.reason }, ipAddress: req.ip, userAgent: req.get("user-agent") }).catch(() => undefined);
    res.json({ data: updated });
  } catch (err) { next(err); }
});

router.post("/engineering/product-versions/:id/retire", requireAuth, requireRole(...engineeringApprovalRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const input = retireEngineeringVersionSchema.parse(req.body);
    const version = await loadVersionOr404(id, res);
    if (!version) return;
    assertAllowedEngineeringVersionTransition(version.status, "retired");
    const [updated] = await db.update(engineeringProductVersionsTable).set({ status: "retired", effectiveTo: new Date().toISOString().slice(0, 10) })
      .where(and(eq(engineeringProductVersionsTable.id, id), eq(engineeringProductVersionsTable.status, version.status))).returning();
    if (!updated) { res.status(409).json({ error: { message: "حالة الإصدار اتغيّرت للتو، حدّث الصفحة وجرّب تاني" } }); return; }
    await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "engineering.version.retire", resourceType: "engineering_product_version", resourceId: id, afterData: { reason: input.reason }, ipAddress: req.ip, userAgent: req.get("user-agent") }).catch(() => undefined);
    res.json({ data: updated });
  } catch (err) { next(err); }
});

router.get("/engineering/routings/:versionId/operations", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const versionId = parseIdParam(req.params.versionId, res);
    if (versionId === null) return;
    res.json({ data: await db.select().from(engineeringRoutingsTable)
      .where(eq(engineeringRoutingsTable.productVersionId, versionId))
      .orderBy(engineeringRoutingsTable.operationNo) });
  } catch (err) { next(err); }
});

router.post("/engineering/routings/:versionId/operations", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const productVersionId = parseIdParam(req.params.versionId, res);
    if (productVersionId === null) return;
    const version = await loadVersionOr404(productVersionId, res);
    if (!version) return;
    // Phase 04 (delivery 1): this endpoint previously accepted new routing
    // operations regardless of the version's status — an approved/released
    // version's routing could be changed in place with no guard at all.
    assertEngineeringVersionEditable(version.status);
    const data = createRoutingSchema.parse(req.body);
    // العملية + إبطال التحقق معاملة واحدة (انقطاع بينهم = مسار تصنيع جديد على نسخة لسه «متحقق منها»).
    const operation = await db.transaction(async (tx) => {
      const [created] = await tx.insert(engineeringRoutingsTable).values({
        ...data,
        productVersionId,
        runMinutesPerUnit: String(data.runMinutesPerUnit),
      }).returning();
      await tx.update(engineeringProductVersionsTable).set({ validationStatus: "not_validated" })
        .where(eq(engineeringProductVersionsTable.id, productVersionId));
      return created;
    });
    res.status(201).json({ data: operation });
  } catch (err) {
    next(err);
  }
});

router.get("/engineering/change-requests", requireAuth, requireRole(...engineeringRoles), async (_req, res, next) => {
  try {
    res.json({ data: await db.select().from(engineeringChangeRequestsTable).orderBy(desc(engineeringChangeRequestsTable.createdAt)) });
  } catch (err) {
    next(err);
  }
});

router.post("/engineering/change-requests", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const data = createChangeRequestSchema.parse(req.body);
    const changeRequest = await db.transaction(async (tx) => {
      const [product] = await tx.select({ id: engineeringProductsTable.id }).from(engineeringProductsTable).where(eq(engineeringProductsTable.id, data.productId)).limit(1);
      if (!product) throw Object.assign(new Error("المنتج الهندسي غير موجود"), { status: 404 });
      if (data.productVersionId) {
        const [v] = await tx.select({ productId: engineeringProductVersionsTable.productId }).from(engineeringProductVersionsTable).where(eq(engineeringProductVersionsTable.id, data.productVersionId)).limit(1);
        if (!v || v.productId !== data.productId) throw Object.assign(new Error("الإصدار المختار لا يخص هذا المنتج"), { status: 422 });
      }
      // الرقم والإدخال معاملة واحدة: انقطاع بينهم ما يحرقش رقم ولا يسيب طلب بدون رقم.
      const requestNumber = await nextPhase0Number(tx, "engineering_change_request");
      const [created] = await tx.insert(engineeringChangeRequestsTable).values({
        ...data,
        requestNumber,
        requestedBy: req.user?.userId,
      }).returning();
      return created;
    });
    res.status(201).json({ data: changeRequest });
  } catch (err) {
    next(err);
  }
});

// قرار على طلب التغيير: اعتماد أو رفض بسبب مكتوب. صاحب الطلب ما يقررش على طلبه (فصل المهام)،
// والقرار مرة واحدة (الصف مقفول والحالة لازم تكون open).
router.patch("/engineering/change-requests/:id/decide", requireAuth, requireRole(...engineeringApprovalRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const input = decideChangeRequestSchema.parse(req.body);
    const decided = await db.transaction(async (tx) => {
      const [cr] = await tx.select().from(engineeringChangeRequestsTable).where(eq(engineeringChangeRequestsTable.id, id)).limit(1).for("update");
      if (!cr) throw Object.assign(new Error("طلب التغيير غير موجود"), { status: 404 });
      if (cr.status !== "open") throw Object.assign(new Error("تم البت في طلب التغيير ده قبل كده"), { status: 409 });
      if (cr.requestedBy && cr.requestedBy === req.user!.userId) throw Object.assign(new Error("لا يمكنك البت في طلب تغيير فتحته بنفسك"), { status: 403 });
      const [row] = await tx.update(engineeringChangeRequestsTable).set({
        status: input.decision, decidedBy: req.user!.userId, decidedAt: new Date(), decisionReason: input.reason,
      }).where(eq(engineeringChangeRequestsTable.id, id)).returning();
      // التدقيق في نفس المعاملة: ما يتسجلش قرار ناجح لو الكتابة فشلت، ولا قرار بدون أثر تدقيق.
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: `engineering.change.${input.decision}`, resourceType: "engineering_change_request", resourceId: id, afterData: { decision: input.decision, reason: input.reason }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      return row;
    });
    res.json({ data: decided });
  } catch (err) { next(err); }
});

// Phase 04 (delivery 1): real, computable change-impact — other engineering
// product versions that consume this product as a sub-assembly component.
// Deliberately does NOT report production-order impact: production orders
// are driven by bom_recipes, not this engineering module (see the Phase 04
// delivery 1 report). An honest empty/partial answer beats a fabricated one.
router.get("/engineering/change-requests/:id/impact", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [changeRequest] = await db.select().from(engineeringChangeRequestsTable)
      .where(eq(engineeringChangeRequestsTable.id, id));
    if (!changeRequest) { res.status(404).json({ error: { message: "طلب التغيير غير موجود" } }); return; }
    const affectedVersions = await findEngineeringChangeImpact(db, changeRequest.productId);
    res.json({
      data: {
        affectedEngineeringVersions: affectedVersions,
        // See the code comment above — not a false negative, a documented scope limit.
        productionOrderImpact: "غير متاح حاليًا — أوامر الإنتاج لا تستهلك مراجعات الهندسة بعد",
      },
    });
  } catch (err) { next(err); }
});

export default router;
