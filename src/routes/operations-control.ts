import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  inventoryItemsTable,
  salesOrdersTable,
  salesOrderItemsTable,
  bomRecipesTable,
  bomRecipeItemsTable,
  productionWorkflowOrdersTable,
  purchaseRequisitionsTable,
  operationTransfersTable,
  workflowEventsTable,
  operationTransferSchema,
  systemSettingsTable,
} from "../db/schema";
import { requireAuth, requirePermission, requireRole } from "../middleware/auth";
import { applyStockMovement } from "../lib/stock";
import { writeAuditEvent } from "../lib/governance";
import {
  canDispatchPlan,
  isPlanningOnlyEnabled,
  OPERATIONS_CONTROL_ACTIONS,
  OPERATIONS_CONTROL_ROLES,
  PLANNING_BOUNDARY_SETTING,
} from "../lib/operations-control-policy";
import {
  compareDecimalQuantities,
  divideDecimalQuantities,
  isPositiveDecimalQuantity,
  maxZeroDecimalQuantity,
  minDecimalQuantities,
  multiplyDecimalQuantities,
  subtractDecimalQuantities,
} from "../lib/decimal-quantity";

const router = Router();
const OPERATIONS_ROLES = [...OPERATIONS_CONTROL_ROLES.planCreate] as const;
const INTERNAL_ROLES = [
  "operations_manager",
  "executive_manager",
  "chairman",
  "warehouse_manager",
  "storekeeper",
  "production_manager",
  "production_controller",
  "supervisor",
  "production_quality_controller",
  "quality_engineer",
] as const;

// ✨ GET /operations-control/lookups/* — قوائم مبسّطة (id + اسم مقروء) لتغذية
// قوائم الاختيار (select) في شاشة "التحكم في العمليات" بدل كتابة المعرّفات
// الرقمية يدويًا. متاحة لنفس أدوار الصفحة (INTERNAL_ROLES) بغض النظر عن
// صلاحيات العرض التفصيلية للموارد الأصلية (مثال: /sales أو /inventory)
// عشان محدش يتفاجئ بخطأ 403 وهو بس بيملى فورم.
router.get("/operations-control/lookups/sales-orders", requireAuth, requireRole(...INTERNAL_ROLES), async (_req, res, next) => {
  try {
    const rows = await db.select({
      id: salesOrdersTable.id,
      orderNumber: salesOrdersTable.orderNumber,
      status: salesOrdersTable.status,
    }).from(salesOrdersTable).orderBy(desc(salesOrdersTable.createdAt)).limit(200);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get("/operations-control/lookups/production-orders", requireAuth, requireRole(...INTERNAL_ROLES), async (_req, res, next) => {
  try {
    const rows = await db.select({
      id: productionWorkflowOrdersTable.id,
      orderNumber: productionWorkflowOrdersTable.orderNumber,
      productName: productionWorkflowOrdersTable.productName,
      workflowStatus: productionWorkflowOrdersTable.workflowStatus,
    }).from(productionWorkflowOrdersTable).orderBy(desc(productionWorkflowOrdersTable.createdAt)).limit(200);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get("/operations-control/lookups/inventory-items", requireAuth, requireRole(...INTERNAL_ROLES), async (_req, res, next) => {
  try {
    const rows = await db.select({
      id: inventoryItemsTable.id,
      code: inventoryItemsTable.code,
      name: inventoryItemsTable.name,
    }).from(inventoryItemsTable).orderBy(inventoryItemsTable.name).limit(500);
    res.json(rows);
  } catch (err) { next(err); }
});

type Requirement = {
  inventoryItemId: number | null;
  materialName: string;
  requiredQty: string;
  availableQty: string;
  shortageQty: string;
  recipeId: number | null;
};

async function findInventory(name: string, itemId?: number | null) {
  if (itemId) {
    const [item] = await db.select().from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.id, itemId)).limit(1);
    if (item) return item;
  }
  const [item] = await db.select().from(inventoryItemsTable)
    .where(sql`lower(trim(${inventoryItemsTable.name})) = lower(trim(${name}))`).limit(1);
  return item ?? null;
}

async function recipeFor(name: string) {
  const [recipe] = await db.select().from(bomRecipesTable)
    .where(sql`lower(trim(${bomRecipesTable.productName})) = lower(trim(${name}))`).limit(1);
  return recipe ?? null;
}

async function explodeRecipe(
  recipeId: number,
  outputQty: string,
  seen = new Set<number>(),
): Promise<Requirement[]> {
  if (seen.has(recipeId)) {
    throw Object.assign(new Error("تم اكتشاف حلقة داخل بنية الـBOM"), { status: 409 });
  }
  const nextSeen = new Set(seen).add(recipeId);
  const [recipe] = await db.select().from(bomRecipesTable)
    .where(eq(bomRecipesTable.id, recipeId)).limit(1);
  if (!recipe) throw Object.assign(new Error("وصفة التصنيع غير موجودة"), { status: 404 });
  const rows = await db.select().from(bomRecipeItemsTable)
    .where(eq(bomRecipeItemsTable.recipeId, recipeId));
  const result: Requirement[] = [];
  for (const row of rows) {
    const requiredQty = divideDecimalQuantities(
      multiplyDecimalQuantities(outputQty, row.qty),
      recipe.outputQty || "1",
    );
    const item = await findInventory(row.materialName, row.inventoryItemId);
    const availableQty = item
      ? maxZeroDecimalQuantity(subtractDecimalQuantities(item.qty, item.reservedQty))
      : "0";
    const childRecipe = await recipeFor(row.materialName);
    result.push({
      inventoryItemId: item?.id ?? row.inventoryItemId ?? null,
      materialName: row.materialName,
      requiredQty,
      availableQty,
      shortageQty: maxZeroDecimalQuantity(
        subtractDecimalQuantities(requiredQty, availableQty),
      ),
      recipeId: childRecipe?.id ?? null,
    });
    if (childRecipe && compareDecimalQuantities(requiredQty, availableQty) > 0) {
      result.push(
        ...await explodeRecipe(
          childRecipe.id,
          subtractDecimalQuantities(requiredQty, availableQty),
          nextSeen,
        ),
      );
    }
  }
  return result;
}

async function planningOnlyEnabled() {
  const [setting] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, PLANNING_BOUNDARY_SETTING))
    .limit(1);
  return isPlanningOnlyEnabled(setting?.value);
}

async function buildSalesOrderPlan(salesOrderId: number) {
  const [order] = await db.select().from(salesOrdersTable)
    .where(eq(salesOrdersTable.id, salesOrderId)).limit(1);
  if (!order) return null;

  const items = await db.select().from(salesOrderItemsTable)
    .where(eq(salesOrderItemsTable.orderId, salesOrderId));
  const plan = [];
  for (const item of items) {
    const inventory = await findInventory(item.description, item.inventoryItemId);
    const available = inventory
      ? maxZeroDecimalQuantity(subtractDecimalQuantities(inventory.qty, inventory.reservedQty))
      : "0";
    const stockQty = minDecimalQuantities(available, item.qty);
    const shortage = maxZeroDecimalQuantity(
      subtractDecimalQuantities(item.qty, stockQty),
    );
    const recipe = await recipeFor(item.description);
    const requirements = recipe && isPositiveDecimalQuantity(shortage)
      ? await explodeRecipe(recipe.id, shortage) : [];
    plan.push({
      salesOrderItemId: item.id, productName: item.description, requestedQty: item.qty,
      finishedGood: {
        inventoryItemId: inventory?.id ?? null,
        physicalQty: inventory?.qty ?? "0",
        reservedQty: inventory?.reservedQty ?? "0",
        availableQty: stockQty,
      },
      allocation: { fromStock: stockQty, toProduction: shortage },
      recipeId: recipe?.id ?? null, requirements,
      purchaseShortages: requirements.filter(
        (r) => isPositiveDecimalQuantity(r.shortageQty) && !r.recipeId,
      ),
    });
  }
  return { salesOrder: order, plan };
}

router.get("/operations-control/sales-orders/:id/plan",
  requireAuth, requirePermission(OPERATIONS_CONTROL_ACTIONS.analysisRun),
  async (req, res, next) => {
    try {
      const salesOrderId = Number(req.params.id);
      if (!Number.isInteger(salesOrderId) || salesOrderId <= 0) {
        res.status(400).json({ error: { message: "رقم طلب البيع غير صالح" } }); return;
      }
      const result = await buildSalesOrderPlan(salesOrderId);
      if (!result) {
        res.status(404).json({ error: { message: "طلب البيع غير موجود" } });
        return;
      }
      res.json({ ...result, readOnly: true, inventoryMutated: false });
    } catch (err) { next(err); }
  },
);

router.post("/operations-control/sales-orders/:id/draft-plan",
  requireAuth, requirePermission(OPERATIONS_CONTROL_ACTIONS.planCreate),
  async (req, res, next) => {
    try {
      const salesOrderId = Number(req.params.id);
      if (!Number.isInteger(salesOrderId) || salesOrderId <= 0) {
        res.status(400).json({ error: { message: "رقم طلب البيع غير صالح" } });
        return;
      }
      const result = await buildSalesOrderPlan(salesOrderId);
      if (!result) {
        res.status(404).json({ error: { message: "طلب البيع غير موجود" } });
        return;
      }
      res.status(200).json({
        ...result,
        status: "draft",
        persisted: false,
        readOnly: true,
        inventoryMutated: false,
        message: "تم تجهيز مسودة الخطة للعرض فقط. لم يتم تعديل المخزون أو إنشاء مستندات تنفيذية.",
      });
    } catch (err) { next(err); }
  },
);

router.post("/operations-control/sales-orders/:id/execute-plan",
  requireAuth,
  async (req, res, next) => {
    try {
      const planningOnly = await planningOnlyEnabled();
      const canDispatch = canDispatchPlan({
        role: req.user!.role,
        planningOnly,
        // Stage 01 has no approved-plan resource to validate, so the legacy
        // endpoint can never dispatch work.
        planApproved: false,
      });
      if (!canDispatch) {
        res.status(410).json({
          error: {
            code: "OPERATIONS_PLAN_DISPATCH_DISABLED",
            message: "تم تعطيل التنفيذ المباشر. استخدم حفظ خطة مسودة؛ لا يتم إنشاء إنتاج أو شراء أثناء التحليل.",
          },
          warning: "هذا المسار deprecated وسيُستبدل بمسار اعتماد وتسليم آمن.",
        });
        return;
      }
      res.status(410).json({
        error: {
          code: "OPERATIONS_PLAN_DISPATCH_NOT_IMPLEMENTED",
          message: "لا يمكن تنفيذ الخطة بدون خطة معتمدة ومسار تسليم مصرح.",
        },
      });
    } catch (err) { next(err); }
  },
);

router.get("/operations-control/purchase-requisitions",
  requireAuth, requireRole(...OPERATIONS_ROLES, "warehouse_manager"),
  async (_req, res, next) => {
    try { res.json(await db.select().from(purchaseRequisitionsTable).orderBy(desc(purchaseRequisitionsTable.createdAt))); }
    catch (err) { next(err); }
  },
);

router.patch("/operations-control/purchase-requisitions/:id/confirm",
  requireAuth, requireRole(...OPERATIONS_ROLES),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const [updated] = await db.update(purchaseRequisitionsTable).set({
        status: "confirmed_to_procurement", confirmedBy: req.user!.userId, confirmedAt: new Date(),
      }).where(and(eq(purchaseRequisitionsTable.id, id), eq(purchaseRequisitionsTable.status, "pending_operations"))).returning();
      if (!updated) { res.status(409).json({ error: { message: "الاحتياج غير موجود أو تم تأكيده مسبقًا" } }); return; }
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username,
        actionKey: "operations.purchaseRequisition.confirm", resourceType: "purchase_requisition", resourceId: id,
        afterData: updated, ipAddress: req.ip, userAgent: req.get("user-agent") });
      res.json(updated);
    } catch (err) { next(err); }
  },
);

router.post("/operations-control/transfers",
  requireAuth, requireRole(...INTERNAL_ROLES),
  async (req, res, next) => {
    try {
      const data = operationTransferSchema.parse(req.body);
      const allowed: Record<string, string[]> = {
        warehouse_to_operations: ["warehouse_manager", ...OPERATIONS_ROLES],
        operations_to_production: [...OPERATIONS_ROLES],
        production_to_operations: ["production_manager", "supervisor", ...OPERATIONS_ROLES],
        operations_to_warehouse: [...OPERATIONS_ROLES],
      };
      if (!allowed[data.direction].includes(req.user!.role)) {
        res.status(403).json({ error: { message: "هذا الانتقال لا يبدأه دورك" } }); return;
      }
      const [transfer] = await db.insert(operationTransfersTable).values({
        ...data, quantity: data.quantity, preparedBy: req.user!.userId,
      }).onConflictDoNothing().returning();
      if (!transfer) { res.status(409).json({ error: { message: "هذه الحركة مسجلة مسبقًا" } }); return; }
      res.status(201).json(transfer);
    } catch (err) { next(err); }
  },
);

router.patch("/operations-control/transfers/:id/receive",
  requireAuth, requireRole(...INTERNAL_ROLES),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const [transfer] = await db.select().from(operationTransfersTable).where(eq(operationTransfersTable.id, id)).limit(1);
      if (!transfer) { res.status(404).json({ error: { message: "حركة النقل غير موجودة" } }); return; }
      const receivers: Record<string, string[]> = {
        warehouse_to_operations: [...OPERATIONS_ROLES], operations_to_production: ["production_manager", "supervisor"],
        production_to_operations: [...OPERATIONS_ROLES], operations_to_warehouse: ["warehouse_manager"],
      };
      if (!receivers[transfer.direction].includes(req.user!.role)) {
        res.status(403).json({ error: { message: "هذا الانتقال لا يستلمه دورك" } }); return;
      }
       const updated = await db.transaction(async (tx) => {
         const [received] = await tx.update(operationTransfersTable).set({
           status: "received", receivedBy: req.user!.userId, receivedAt: new Date(),
         }).where(and(eq(operationTransfersTable.id, id), eq(operationTransfersTable.status, "pending"))).returning();
         if (!received) return undefined;
         if (received.inventoryItemId &&
             ["warehouse_to_operations", "operations_to_production"].includes(received.direction)) {
           await applyStockMovement(tx, {
             inventoryItemId: received.inventoryItemId, movementType: "out",
             qty: received.quantity, referenceType: "production",
             referenceId: received.workflowOrderId,
             notes: `خصم بعد استلام تحويل تشغيلي #${received.id}`,
           });
         }
         if (received.inventoryItemId && received.direction === "operations_to_warehouse") {
           await applyStockMovement(tx, {
             inventoryItemId: received.inventoryItemId, movementType: "in",
             qty: received.quantity, referenceType: "production",
             referenceId: received.workflowOrderId,
             notes: `إضافة بعد استلام تحويل تشغيلي #${received.id}`,
           });
         }
         return received;
       });
      if (!updated) { res.status(409).json({ error: { message: "تم استلام الحركة مسبقًا" } }); return; }
      res.json(updated);
    } catch (err) { next(err); }
  },
);

router.get("/operations-control/orders/:id/events",
  requireAuth, requireRole(...INTERNAL_ROLES),
  async (req, res, next) => {
    try { res.json(await db.select().from(workflowEventsTable).where(eq(workflowEventsTable.workflowOrderId, Number(req.params.id))).orderBy(workflowEventsTable.createdAt)); }
    catch (err) { next(err); }
  },
);

router.get("/operations-control/orders/:id/customer-status",
  requireAuth,
  async (req, res, next) => {
    try {
      const rows = await db.select({
        customerStatus: workflowEventsTable.customerStatus,
        createdAt: workflowEventsTable.createdAt,
      }).from(workflowEventsTable)
        .where(and(eq(workflowEventsTable.workflowOrderId, Number(req.params.id)), sql`${workflowEventsTable.customerStatus} is not null`))
        .orderBy(workflowEventsTable.createdAt);
      res.json(rows);
    } catch (err) { next(err); }
  },
);

export default router;