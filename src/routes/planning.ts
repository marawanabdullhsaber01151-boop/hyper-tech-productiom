/** @format */

import { Router } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  createPlanningRunSchema,
  createMrpSchema,
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
import {
  buildPlanningRunKey,
  buildReleaseImpact,
  calculatePlanningRequirement,
  evaluateCapacity,
  mergeCapacityLoads,
} from "../domain/planning";

const router = Router();
const planningRoles = ["chairman", "production_manager", "production_controller", "warehouse_manager"];

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
  return {
    ...run,
    inputs,
    capacityLoads,
    shortageMessages,
    peggingLinks,
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
    const run = await loadPlanningRun(Number(req.params.id));
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
    const id = Number(req.params.id);
    const [run] = await db.update(planningRunsTable).set({
      status: "approved",
      approvedBy: req.user!.userId,
      approvedAt: new Date(),
    }).where(and(eq(planningRunsTable.id, id), eq(planningRunsTable.status, "draft"))).returning();
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
    const run = await loadPlanningRun(Number(req.params.id));
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
    const id = Number(req.params.id);
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

router.post("/planning/mrp", requireAuth, requireRole(...planningRoles), async (req, res, next) => {
  try {
    const data = createMrpSchema.parse(req.body);
    const plan = await db.transaction(async (tx) => {
      const planNumber = await nextPhase0Number(tx, "production_plan");
      const [createdPlan] = await tx.insert(productionPlansTable).values({
        planNumber,
        dueDate: data.dueDate,
        demandSource: data.demandSource,
        createdBy: req.user!.userId,
      }).returning();
      const items = await Promise.all(data.requirements.map(async (requirement) => {
        const [item] = await tx.select().from(inventoryItemsTable)
          .where(eq(inventoryItemsTable.id, requirement.inventoryItemId)).limit(1);
        if (!item) throw Object.assign(new Error("صنف خامة غير موجود"), { status: 404 });
        const available = Math.max(0, Number(item.qty) - Number(item.reservedQty) - Number(item.quarantineQty));
        const gross = Number(requirement.grossQty);
        const net = Math.max(0, gross - available);
        const [created] = await tx.insert(materialRequirementsTable).values({
          planId: createdPlan.id,
          inventoryItemId: item.id,
          workflowOrderId: data.workflowOrderId,
          grossQty: requirement.grossQty,
          availableQty: String(available),
          netQty: String(net),
          requiredBy: requirement.requiredBy,
          status: net > 0 ? "shortage" : "covered",
        }).returning();
        return created;
      }));
      return { ...createdPlan, requirements: items };
    });
    res.status(201).json({ data: plan });
  } catch (err) {
    next(err);
  }
});

router.get("/planning/mrp", requireAuth, requireRole(...planningRoles), async (_req, res, next) => {
  try {
    const plans = await db.select().from(productionPlansTable).orderBy(desc(productionPlansTable.createdAt));
    const requirements = await db.select().from(materialRequirementsTable);
    res.json({ data: plans.map((plan) => ({
      ...plan,
      requirements: requirements.filter((requirement) => requirement.planId === plan.id),
    })) });
  } catch (err) {
    next(err);
  }
});

router.post("/planning/requisitions", requireAuth, requireRole(...planningRoles), async (req, res, next) => {
  try {
    const { materialRequirementId } = createRequisitionSchema.parse(req.body);
    const [requirement] = await db.select().from(materialRequirementsTable)
      .where(eq(materialRequirementsTable.id, materialRequirementId)).limit(1);
    if (!requirement || Number(requirement.netQty) <= 0) {
      res.status(400).json({ error: { message: "لا يوجد عجز صالح لإنشاء طلب شراء" } });
      return;
    }
    const created = await db.transaction(async (tx) => {
      const requisitionNumber = await nextPhase0Number(tx, "purchase_requisition");
      const [record] = await tx.insert(planningPurchaseRequisitionsTable).values({
        requisitionNumber,
        planId: requirement.planId,
        materialRequirementId: requirement.id,
        inventoryItemId: requirement.inventoryItemId,
        requestedQty: requirement.netQty,
        createdBy: req.user!.userId,
      }).returning();
      return record;
    });
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
});

export default router;
