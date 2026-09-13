/** @format */

import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  createMrpSchema,
  createRequisitionSchema,
  inventoryItemsTable,
  materialRequirementsTable,
  planningPurchaseRequisitionsTable,
  productionPlansTable,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { nextPhase0Number } from "../lib/phase0";

const router = Router();
const planningRoles = ["chairman", "production_manager", "production_controller", "warehouse_manager"];

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
