/** @format */

import { Router } from "express";
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../db";
import {
  bomRecipeItemsTable,
  bomRecipesTable,
  explodePlanningSchema,
  purchaseOrderItemsTable,
  purchaseOrdersTable,
  purchaseRequisitionsTable,
  createPlanningRunSchema,
  createRequisitionSchema,
  inventoryItemsTable,
  materialRequirementsTable,
  planningCapacityLoadsTable,
  planningPeggingLinksTable,
  planningReleaseDecisionsTable,
  planningRunInputsTable,
  planningRunsTable,
  planningShortageMessagesTable,
  planningPurchaseRequisitionsTable,
  productionPlansTable,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { nextPhase0Number } from "../lib/phase0";
import { parseIdParam } from "../lib/validate";
import { writeAuditEvent } from "../lib/governance";
import { addDecimalQuantities, maxZeroDecimalQuantity, subtractDecimalQuantities } from "../lib/decimal-quantity";
import {
  buildPlanningRunKey,
  buildReleaseImpact,
  calculatePlanningRequirement,
  evaluateCapacity,
  explodeBomLines,
  mergeCapacityLoads,
} from "../domain/planning";

const router = Router();
const planningRoles = ["chairman", "production_manager", "production_controller", "warehouse_manager"];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** تسجيل أثر تخطيط في نفس معاملة العملية (E9). */
const audit = (req: import("express").Request, tx: Tx, actionKey: string, resourceId: number, afterData: unknown, beforeData?: unknown) =>
  writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey, resourceType: "planning_run", resourceId, beforeData, afterData, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });

/**
 * التوريد المفتوح لكل صنف: اللي في الطريق ومحسوب قبل ما نقترح شراء تاني.
 * أوامر شراء غير مستلمة بالكامل أو ملغية (الباقي = الكمية − المستلم) + احتياجات تخطيط لسه مسودة + احتياجات تشغيل أُكّدت للمشتريات.
 */
async function loadOpenSupply(itemIds: number[]) {
  const out = new Map<number, { purchaseOrders: string; requisitions: string; total: string }>();
  if (!itemIds.length) return out;
  const [poRows, planRows, opsRows] = await Promise.all([
    db.select({ itemId: purchaseOrderItemsTable.inventoryItemId, qty: purchaseOrderItemsTable.qty, received: purchaseOrderItemsTable.receivedQty })
      .from(purchaseOrderItemsTable)
      .innerJoin(purchaseOrdersTable, eq(purchaseOrdersTable.id, purchaseOrderItemsTable.poId))
      .where(and(inArray(purchaseOrderItemsTable.inventoryItemId, itemIds), notInArray(purchaseOrdersTable.status, ["received", "cancelled"]))),
    db.select({ itemId: planningPurchaseRequisitionsTable.inventoryItemId, qty: planningPurchaseRequisitionsTable.requestedQty })
      .from(planningPurchaseRequisitionsTable)
      .where(and(inArray(planningPurchaseRequisitionsTable.inventoryItemId, itemIds), eq(planningPurchaseRequisitionsTable.status, "draft"))),
    db.select({ itemId: purchaseRequisitionsTable.inventoryItemId, qty: purchaseRequisitionsTable.shortageQty })
      .from(purchaseRequisitionsTable)
      .where(and(inArray(purchaseRequisitionsTable.inventoryItemId, itemIds), eq(purchaseRequisitionsTable.status, "confirmed_to_procurement"))),
  ]);
  const slot = (id: number) => out.get(id) ?? out.set(id, { purchaseOrders: "0", requisitions: "0", total: "0" }).get(id)!;
  for (const r of poRows) {
    const s = slot(r.itemId);
    s.purchaseOrders = addDecimalQuantities(s.purchaseOrders, maxZeroDecimalQuantity(subtractDecimalQuantities(r.qty, r.received)));
  }
  for (const r of [...planRows, ...opsRows]) {
    if (r.itemId == null) continue;
    const s = slot(r.itemId);
    s.requisitions = addDecimalQuantities(s.requisitions, r.qty);
  }
  for (const s of out.values()) s.total = addDecimalQuantities(s.purchaseOrders, s.requisitions);
  return out;
}

// GET /planning/lookups — الوصفات المفعّلة لاختيارها في سيناريو جديد (من غير أسعار)
router.get("/planning/lookups", requireAuth, requireRole(...planningRoles), async (_req, res, next) => {
  try {
    const recipes = await db
      .select({ id: bomRecipesTable.id, productName: bomRecipesTable.productName, productCode: bomRecipesTable.productCode, outputQty: bomRecipesTable.outputQty })
      .from(bomRecipesTable)
      .where(eq(bomRecipesTable.isActive, true))
      .orderBy(asc(bomRecipesTable.productName));
    res.json({ data: { recipes } });
  } catch (err) { next(err); }
});

// POST /planning/explode — معاينة بدون حفظ: وصفات + كميات ← احتياج كل خامة، المتاح الحر، التوريد المفتوح، العجز، و«ليه».
router.post("/planning/explode", requireAuth, requireRole(...planningRoles), async (req, res, next) => {
  try {
    const { lines } = explodePlanningSchema.parse(req.body);
    const ids = [...new Set(lines.map((l) => l.bomRecipeId))];
    const [recipeRows, itemRows] = await Promise.all([
      db.select().from(bomRecipesTable).where(inArray(bomRecipesTable.id, ids)),
      db.select().from(bomRecipeItemsTable).where(inArray(bomRecipeItemsTable.recipeId, ids)),
    ]);
    const { demands, blockers } = explodeBomLines(lines, recipeRows.map((r) => ({
      id: r.id, productName: r.productName, productCode: r.productCode, outputQty: r.outputQty, isActive: r.isActive,
      items: itemRows.filter((i) => i.recipeId === r.id).map((i) => ({ id: i.id, inventoryItemId: i.inventoryItemId, materialName: i.materialName, qty: i.qty, unit: i.unit })),
    })));
    const itemIds = demands.map((d) => d.inventoryItemId);
    const [inventory, supply] = await Promise.all([
      itemIds.length ? db.select().from(inventoryItemsTable).where(inArray(inventoryItemsTable.id, itemIds)) : Promise.resolve([]),
      loadOpenSupply(itemIds),
    ]);
    const stock = new Map(inventory.map((i) => [i.id, i]));
    const rows = demands.map((d) => {
      const item = stock.get(d.inventoryItemId);
      if (!item) {
        blockers.push({ code: "item_unlinked", recipeId: d.sources[0]?.recipeId ?? 0, productName: d.sources[0]?.productName ?? null, materialName: d.materialName, message: `صنف المخزون الخاص بـ«${d.materialName}» مش موجود. راجع ربط المكوّن.` });
        return null;
      }
      const open = supply.get(d.inventoryItemId) ?? { purchaseOrders: "0", requisitions: "0", total: "0" };
      const result = calculatePlanningRequirement({
        grossQty: d.grossQty, availableQty: String(item.qty), reservedQty: String(item.reservedQty), quarantineQty: String(item.quarantineQty),
        openSupplyQty: open.total, leadDays: 0, requiredBy: d.requiredBy,
      });
      return {
        ...d,
        code: item.code,
        name: item.name,
        stock: { onHand: String(item.qty), reserved: String(item.reservedQty), quarantine: String(item.quarantineQty) },
        openSupply: open,
        result,
      };
    }).filter((r): r is NonNullable<typeof r> => r !== null);
    res.json({ data: { demands: rows, blockers, summary: { demandCount: rows.length, shortageCount: rows.filter((r) => r.result.status === "shortage").length, blockerCount: blockers.length } } });
  } catch (err) { next(err); }
});

/**
 * Phase 05 cockpit.
 *
 * A run is a snapshot, not a reservation. The only route that can change a
 * run's lifecycle is the optimistic status transition below; no route in this
 * module mutates inventory or production orders while a scenario is drafted.
 */
router.post("/planning/runs", requireAuth, requireRole(...planningRoles), async (req, res, next) => {
  try {
    const data = createPlanningRunSchema.parse(req.body);
    if (data.horizonEnd < data.horizonStart) {
      res.status(422).json({ error: { message: "نهاية أفق التخطيط يجب أن تكون بعد بدايته" } });
      return;
    }

    const runKey = buildPlanningRunKey({
      scenarioCode: data.scenarioCode,
      horizonStart: data.horizonStart,
      horizonEnd: data.horizonEnd,
      assumptions: data.assumptions,
      demands: data.demands,
      capacityLoads: data.capacityLoads,
    });
    const existing = await db.select().from(planningRunsTable)
      .where(eq(planningRunsTable.runKey, runKey)).limit(1);
    if (existing[0]) {
      res.json({ data: await loadPlanningRun(existing[0].id), meta: { idempotent: true } });
      return;
    }

    const created = await db.transaction(async (tx) => {
      const [run] = await tx.insert(planningRunsTable).values({
        runKey,
        scenarioCode: data.scenarioCode,
        horizonStart: data.horizonStart,
        horizonEnd: data.horizonEnd,
        inputHash: runKey.slice(4),
        assumptions: data.assumptions,
        createdBy: req.user!.userId,
      }).onConflictDoNothing({ target: planningRunsTable.runKey }).returning();
      if (!run) {
        const [existingRun] = await tx.select().from(planningRunsTable)
          .where(eq(planningRunsTable.runKey, runKey)).limit(1);
        return { run: existingRun, created: false };
      }

      // Keep the existing production_plans consumer compatible while the new
      // run remains isolated from live reservations and orders.
      const planNumber = await nextPhase0Number(tx, "production_plan");
      const [compatibilityPlan] = await tx.insert(productionPlansTable).values({
        planNumber,
        dueDate: data.horizonEnd,
        demandSource: `scenario:${data.scenarioCode}`,
        assumptions: data.assumptions,
        createdBy: req.user!.userId,
      }).returning();
      const itemIds = [...new Set(data.demands.map((demand) => demand.inventoryItemId))];
      const inventory = await tx.select().from(inventoryItemsTable);
      const inventoryById = new Map(inventory.filter((item) => itemIds.includes(item.id)).map((item) => [item.id, item]));
      const requirements = [];
      const inputs = [];
      const shortages = [];
      const pegging = [];

      for (const demand of data.demands) {
        const item = inventoryById.get(demand.inventoryItemId);
        if (!item) {
          throw Object.assign(new Error("صنف خامة غير موجود في لقطة التخطيط"), { status: 404 });
        }
        const result = calculatePlanningRequirement({
          grossQty: demand.grossQty,
          availableQty: String(item.qty),
          reservedQty: String(item.reservedQty),
          quarantineQty: String(item.quarantineQty),
          openSupplyQty: demand.openSupplyQty,
          leadDays: demand.leadDays,
          requiredBy: demand.requiredBy,
        });
        const [requirement] = await tx.insert(materialRequirementsTable).values({
          planId: compatibilityPlan.id,
          inventoryItemId: item.id,
          grossQty: demand.grossQty,
          availableQty: result.freeAvailableQty,
          netQty: result.netQty,
          requiredBy: demand.requiredBy,
          status: result.status,
        }).returning();
        // The existing material_requirements contract requires plan_id. The
        // run id is recorded in every new planning child table, while the
        // legacy field is filled below by the compatibility plan.
        requirements.push({ requirement, demand, result, item });
        inputs.push({
          runId: run.id,
          sourceType: demand.sourceType,
          sourceId: demand.sourceId == null ? null : String(demand.sourceId),
          inventoryItemId: item.id,
          grossQty: demand.grossQty,
          requiredBy: demand.requiredBy,
          snapshot: {
            ...demand.snapshot,
            item: { id: item.id, code: item.code, name: item.name, unit: item.unit },
            reservedQty: item.reservedQty,
            quarantineQty: item.quarantineQty,
            openSupplyQty: demand.openSupplyQty,
            leadDays: demand.leadDays,
          },
        });
        pegging.push({
          runId: run.id,
          materialRequirementId: requirement.id,
          demandType: demand.sourceType,
          demandId: demand.sourceId == null ? null : String(demand.sourceId),
          peggedQty: demand.grossQty,
        });
        if (result.status === "shortage") {
          shortages.push({
            runId: run.id,
            materialRequirementId: requirement.id,
            severity: "critical",
            code: result.shortageCode,
            message: `عجز ${result.netQty} من ${item.name}`,
            explanation: result.explanation,
            recommendedAction: demand.openSupplyQty !== "0"
              ? "راجع موعد التوريد أو اختر بديلًا معتمدًا."
              : "أنشئ طلب شراء أو اختر بديلًا معتمدًا.",
          });
        }
      }

      if (inputs.length) await tx.insert(planningRunInputsTable).values(inputs);
      if (shortages.length) await tx.insert(planningShortageMessagesTable).values(shortages);
      if (pegging.length) await tx.insert(planningPeggingLinksTable).values(pegging);

      const capacityRows = mergeCapacityLoads(data.capacityLoads).map((load) => {
        const result = evaluateCapacity(load.requiredMinutes, load.availableMinutes);
        return {
          runId: run.id,
          workCenterId: load.workCenterId ?? null,
          machineId: load.machineId ?? null,
          shiftId: load.shiftId ?? null,
          loadDate: load.loadDate,
          requiredMinutes: load.requiredMinutes,
          availableMinutes: load.availableMinutes,
          overloadMinutes: result.overloadMinutes,
          status: result.status,
          explanation: result.explanation,
        };
      });
      if (capacityRows.length) await tx.insert(planningCapacityLoadsTable).values(capacityRows);
      await audit(req, tx, "planning.run.create", run.id, { scenarioCode: data.scenarioCode, horizonStart: data.horizonStart, horizonEnd: data.horizonEnd, demands: inputs.length, shortages: shortages.length });
      return { run, created: true };
    });

    res.status(created.created ? 201 : 200).json({ data: await loadPlanningRun(created.run.id), meta: { idempotent: !created.created } });
  } catch (err) {
    next(err);
  }
});

async function loadPlanningRun(id: number) {
  const [run] = await db.select().from(planningRunsTable).where(eq(planningRunsTable.id, id)).limit(1);
  if (!run) return null;
  const [inputs, capacityLoads, shortageMessages, peggingLinks] = await Promise.all([
    db.select().from(planningRunInputsTable).where(eq(planningRunInputsTable.runId, id)),
    db.select().from(planningCapacityLoadsTable).where(eq(planningCapacityLoadsTable.runId, id)),
    db.select().from(planningShortageMessagesTable).where(eq(planningShortageMessagesTable.runId, id)),
    db.select().from(planningPeggingLinksTable).where(eq(planningPeggingLinksTable.runId, id)),
  ]);
  const reqIds = peggingLinks.map((p) => p.materialRequirementId);
  const requisitions = reqIds.length
    ? await db.select({ id: planningPurchaseRequisitionsTable.id, number: planningPurchaseRequisitionsTable.requisitionNumber, materialRequirementId: planningPurchaseRequisitionsTable.materialRequirementId, requestedQty: planningPurchaseRequisitionsTable.requestedQty, status: planningPurchaseRequisitionsTable.status })
      .from(planningPurchaseRequisitionsTable).where(inArray(planningPurchaseRequisitionsTable.materialRequirementId, reqIds))
    : [];
  return {
    ...run,
    inputs,
    capacityLoads,
    shortageMessages,
    peggingLinks,
    requisitions,
    summary: {
      demandCount: inputs.length,
      shortageCount: shortageMessages.length,
      overloadedCount: capacityLoads.filter((load) => load.status === "overloaded").length,
    },
  };
}

async function loadPlanningRunSummaries(runs: Array<typeof planningRunsTable.$inferSelect>) {
  const ids = runs.map((run) => run.id);
  if (!ids.length) return [];
  const [inputs, shortages, capacityLoads] = await Promise.all([
    db.select().from(planningRunInputsTable).where(inArray(planningRunInputsTable.runId, ids)),
    db.select().from(planningShortageMessagesTable).where(inArray(planningShortageMessagesTable.runId, ids)),
    db.select().from(planningCapacityLoadsTable).where(inArray(planningCapacityLoadsTable.runId, ids)),
  ]);
  return runs.map((run) => ({
    ...run,
    summary: {
      demandCount: inputs.filter((input) => input.runId === run.id).length,
      shortageCount: shortages.filter((shortage) => shortage.runId === run.id).length,
      overloadedCount: capacityLoads.filter((load) => load.runId === run.id && load.status === "overloaded").length,
    },
  }));
}

router.get("/planning/runs", requireAuth, requireRole(...planningRoles), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const runs = await db.select().from(planningRunsTable)
      .orderBy(desc(planningRunsTable.createdAt)).limit(limit);
    res.json({ data: await loadPlanningRunSummaries(runs) });
  } catch (err) {
    next(err);
  }
});

router.get("/planning/runs/:id", requireAuth, requireRole(...planningRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const run = await loadPlanningRun(id);
    if (!run) {
      res.status(404).json({ error: { message: "تشغيل التخطيط غير موجود" } });
      return;
    }
    res.json({ data: run });
  } catch (err) {
    next(err);
  }
});

router.post("/planning/runs/:id/approve", requireAuth, requireRole("chairman", "production_manager"), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const run = await db.transaction(async (tx) => {
      const [row] = await tx.update(planningRunsTable).set({
        status: "approved",
        approvedBy: req.user!.userId,
        approvedAt: new Date(),
      }).where(and(eq(planningRunsTable.id, id), eq(planningRunsTable.status, "draft"))).returning();
      if (row) await audit(req, tx, "planning.run.approve", id, { status: "approved" }, { status: "draft" });
      return row;
    });
    if (!run) {
      res.status(409).json({ error: { message: "الخطة ليست في حالة مسودة أو تم اعتمادها مسبقًا" } });
      return;
    }
    res.json({ data: await loadPlanningRun(run.id) });
  } catch (err) {
    next(err);
  }
});

router.post("/planning/runs/:id/release/preview", requireAuth, requireRole(...planningRoles), async (req, res, next) => {
  try {
    const previewId = parseIdParam(req.params.id, res);
    if (previewId === null) return;
    const run = await loadPlanningRun(previewId);
    if (!run) {
      res.status(404).json({ error: { message: "تشغيل التخطيط غير موجود" } });
      return;
    }
    res.json({ data: buildReleaseImpact({
      shortageCount: run.summary.shortageCount,
      overloadedCount: run.summary.overloadedCount,
      requirementCount: run.summary.demandCount,
    }) });
  } catch (err) {
    next(err);
  }
});

router.post("/planning/runs/:id/release", requireAuth, requireRole("chairman", "production_manager"), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const released = await db.transaction(async (tx) => {
      const [run] = await tx.update(planningRunsTable).set({
        status: "released",
        releasedBy: req.user!.userId,
        releasedAt: new Date(),
      }).where(and(eq(planningRunsTable.id, id), eq(planningRunsTable.status, "approved"))).returning();
      if (!run) return null;
      const [inputs, shortages, capacityLoads] = await Promise.all([
        tx.select().from(planningRunInputsTable).where(eq(planningRunInputsTable.runId, id)),
        tx.select().from(planningShortageMessagesTable).where(eq(planningShortageMessagesTable.runId, id)),
        tx.select().from(planningCapacityLoadsTable).where(eq(planningCapacityLoadsTable.runId, id)),
      ]);
      const impact = buildReleaseImpact({
        shortageCount: shortages.length,
        overloadedCount: capacityLoads.filter((load) => load.status === "overloaded").length,
        requirementCount: inputs.length,
      });
      await tx.insert(planningReleaseDecisionsTable).values({
        runId: id,
        decision: "released",
        decidedBy: req.user!.userId,
        impactSnapshot: impact,
      });
      await audit(req, tx, "planning.run.release", id, { status: "released", impact }, { status: "approved" });
      return run;
    });
    if (!released) {
      res.status(409).json({ error: { message: "لا يمكن تسليم الخطة قبل اعتمادها أو تم تسليمها بالفعل" } });
      return;
    }
    res.json({ data: await loadPlanningRun(released.id) });
  } catch (err) {
    next(err);
  }
});

// إنشاء طلب شراء لاحتياج واحد. الاحتياج بيتقفل (FOR UPDATE) وبيتفحص إنه ما اتطلبش قبل كده، فمفيش تكرار حتى لو ضغطتين مع بعض.
router.post("/planning/requisitions", requireAuth, requireRole(...planningRoles), async (req, res, next) => {
  try {
    const { materialRequirementId } = createRequisitionSchema.parse(req.body);
    const created = await db.transaction(async (tx) => {
      const [requirement] = await tx.select().from(materialRequirementsTable)
        .where(eq(materialRequirementsTable.id, materialRequirementId)).for("update").limit(1);
      if (!requirement || Number(requirement.netQty) <= 0) {
        throw Object.assign(new Error("لا يوجد عجز صالح لإنشاء طلب شراء"), { status: 400 });
      }
      const [existing] = await tx.select({ number: planningPurchaseRequisitionsTable.requisitionNumber }).from(planningPurchaseRequisitionsTable)
        .where(eq(planningPurchaseRequisitionsTable.materialRequirementId, requirement.id)).limit(1);
      if (existing) {
        throw Object.assign(new Error(`تم إنشاء طلب شراء لهذا الاحتياج من قبل (${existing.number}).`), { status: 409 });
      }
      const requisitionNumber = await nextPhase0Number(tx, "purchase_requisition");
      const [record] = await tx.insert(planningPurchaseRequisitionsTable).values({
        requisitionNumber,
        planId: requirement.planId,
        materialRequirementId: requirement.id,
        inventoryItemId: requirement.inventoryItemId,
        requestedQty: requirement.netQty,
        createdBy: req.user!.userId,
      }).returning();
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "planning.requisition.create", resourceType: "planning_purchase_requisition", resourceId: record!.id, afterData: { requisitionNumber, inventoryItemId: requirement.inventoryItemId, requestedQty: requirement.netQty }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      return record!;
    });
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
});

// POST /planning/runs/:id/requisitions — طلبات شراء لكل عجز في السيناريو المعتمد بمعاملة واحدة، من غير تكرار.
router.post("/planning/runs/:id/requisitions", requireAuth, requireRole(...planningRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const result = await db.transaction(async (tx) => {
      const [run] = await tx.select().from(planningRunsTable).where(eq(planningRunsTable.id, id)).for("update").limit(1);
      if (!run) throw Object.assign(new Error("تشغيل التخطيط غير موجود"), { status: 404 });
      if (run.status !== "approved" && run.status !== "released") {
        throw Object.assign(new Error("اعتمد السيناريو الأول، وبعدين اعمل طلبات الشراء."), { status: 409 });
      }
      const links = await tx.select({ requirementId: planningPeggingLinksTable.materialRequirementId }).from(planningPeggingLinksTable).where(eq(planningPeggingLinksTable.runId, id));
      const reqIds = [...new Set(links.map((l) => l.requirementId))];
      if (!reqIds.length) return { created: [] as Array<{ id: number; number: string; inventoryItemId: number; qty: string }>, skipped: 0 };
      const requirements = await tx.select().from(materialRequirementsTable).where(inArray(materialRequirementsTable.id, reqIds)).for("update");
      const shortages = requirements.filter((r) => Number(r.netQty) > 0);
      const already = await tx.select({ requirementId: planningPurchaseRequisitionsTable.materialRequirementId }).from(planningPurchaseRequisitionsTable)
        .where(inArray(planningPurchaseRequisitionsTable.materialRequirementId, reqIds));
      const done = new Set(already.map((a) => a.requirementId));
      const created: Array<{ id: number; number: string; inventoryItemId: number; qty: string }> = [];
      for (const requirement of shortages) {
        if (done.has(requirement.id)) continue;
        const requisitionNumber = await nextPhase0Number(tx, "purchase_requisition");
        const [record] = await tx.insert(planningPurchaseRequisitionsTable).values({
          requisitionNumber,
          planId: requirement.planId,
          materialRequirementId: requirement.id,
          inventoryItemId: requirement.inventoryItemId,
          requestedQty: requirement.netQty,
          createdBy: req.user!.userId,
        }).returning();
        created.push({ id: record!.id, number: requisitionNumber, inventoryItemId: requirement.inventoryItemId, qty: String(requirement.netQty) });
      }
      await audit(req, tx, "planning.run.requisitions", id, { created: created.map((c) => c.number), skippedExisting: shortages.length - created.length });
      return { created, skipped: shortages.length - created.length };
    });
    res.status(result.created.length ? 201 : 200).json({ data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
