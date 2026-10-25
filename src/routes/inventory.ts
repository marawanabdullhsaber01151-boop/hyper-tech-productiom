/** @format */

import { findPostgresError } from "../middleware/errorHandler";
import { Router } from "express";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db, inventoryItemsTable, insertInventoryItemSchema } from "../db";
import { bomRecipeItemsTable, bomRecipesTable, contactsTable, foundationItemsTable, productionWorkflowOrdersTable } from "../db/schema";
import { ACTIVE_PRODUCTION_STATUSES, STOCK_USAGE_ROLES, shapeUsage } from "../lib/stockUsage";
import { foundationTypeToCategory } from "../lib/stockManual";
import {
  requireAuth,
  requireRole,
  requirePermission,
} from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { moveToTrash } from "../lib/trash";
import { PERMISSIONS } from "../lib/permissions";
import { maskFields } from "../lib/fieldMasking";
import { ACCESS } from "../lib/accessRegistry";

const router = Router();

// GET /api/v1/inventory
router.get(
  "/inventory",
  requireAuth,
  requireRole(...ACCESS.inventoryRead),
  async (req, res, next) => {
    try {
      const { category, low_stock } = req.query as Record<
        string,
        string | undefined
      >;
      let query = db.select().from(inventoryItemsTable).$dynamic();

       const salesOnly = ["sales_manager", "online_seller", "offline_seller"].includes(req.user!.role);
       // ✅ فلترة نوع صنف: الإنتاج محتاج يشوف الخامات وWIP بس (مش المنتج
       // التام، ده شغل المخازن/المبيعات) — نفس مبدأ فلترة المبيعات فوق.
       const productionOnly = ["production_manager", "production_controller"].includes(req.user!.role);
       if (salesOnly) {
         query = query.where(eq(inventoryItemsTable.category, "finished_good"));
       } else if (productionOnly) {
         query = query.where(
           sql`${inventoryItemsTable.category} IN ('raw_material', 'wip')`,
         );
       } else if (category)
        query = query.where(eq(inventoryItemsTable.category, category));
      if (low_stock === "true") {
        query = query.where(
          sql`${inventoryItemsTable.qty}::numeric <= ${inventoryItemsTable.minQty}::numeric`,
        );
      }

      // ✅ ORDER BY name — لا يوجد reverse() في الذاكرة
      const items = await query.orderBy(inventoryItemsTable.name);
       // سياسة إخفاء الحقول (سعر الوحدة/المورّد) كانت معرّفة ومش متطبّقة هنا: أي دور يشوف المخزون
      // كان بياخد الصنف كامل. دلوقتي بتتطبّق على الرد قبل ما يخرج من السيرفر.
      res.json(items.map((item) => {
        const base = salesOnly ? {
          id: item.id, name: item.name, unit: item.unit, category: item.category,
          qty: item.qty, reservedQty: item.reservedQty,
        } : item;
        return {
          ...(maskFields("inventory_items", base, req.user!.role) as typeof base),
          availableQty: String(Math.max(0, Number(item.qty) - Number(item.reservedQty))),
        };
      }));
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/inventory/suppliers
// الموردين (للربط في نافذة الصنف). كانت من /contacts اللي أمين المخزن مالوش صلاحية عليها.
router.get(
  "/inventory/suppliers",
  requireAuth,
  requirePermission("inventory.edit"),
  async (_req, res, next) => {
    try {
      const rows = await db
        .select({ id: contactsTable.id, name: contactsTable.name })
        .from(contactsTable)
        .where(or(eq(contactsTable.type, "supplier"), eq(contactsTable.type, "both")))
        .orderBy(asc(contactsTable.name));
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/inventory/:id/usage
// الصنف ده مستخدم في أنهي وصفات وأوامر إنتاج نشطة، وانهي مورّد. بديل لتجميع 3 مسارات في المتصفح
// (/contacts و/bom و/production-workflow) كان بيرجّع فاضي بصمت لأمين المخزن.
router.get(
  "/inventory/:id/usage",
  requireAuth,
  requireRole(...STOCK_USAGE_ROLES),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [item] = await db
        .select({ id: inventoryItemsTable.id, supplierId: inventoryItemsTable.supplierId, leadDays: inventoryItemsTable.leadDays })
        .from(inventoryItemsTable)
        .where(eq(inventoryItemsTable.id, id))
        .limit(1);
      if (!item) {
        res.status(404).json({ error: { message: "العنصر غير موجود" } });
        return;
      }
      const bom = await db
        .select({ recipeId: bomRecipeItemsTable.recipeId, productName: bomRecipesTable.productName, qty: bomRecipeItemsTable.qty, unit: bomRecipeItemsTable.unit })
        .from(bomRecipeItemsTable)
        .innerJoin(bomRecipesTable, eq(bomRecipeItemsTable.recipeId, bomRecipesTable.id))
        .where(eq(bomRecipeItemsTable.inventoryItemId, id));
      const recipeIds = [...new Set(bom.map((b) => b.recipeId))];
      const orders = recipeIds.length
        ? await db
            .select({ id: productionWorkflowOrdersTable.id, orderNumber: productionWorkflowOrdersTable.orderNumber, productName: productionWorkflowOrdersTable.productName, qty: productionWorkflowOrdersTable.qty, workflowStatus: productionWorkflowOrdersTable.workflowStatus, bomRecipeId: productionWorkflowOrdersTable.bomRecipeId })
            .from(productionWorkflowOrdersTable)
            .where(and(inArray(productionWorkflowOrdersTable.bomRecipeId, recipeIds), inArray(productionWorkflowOrdersTable.workflowStatus, [...ACTIVE_PRODUCTION_STATUSES])))
        : [];
      const [supplier] = item.supplierId
        ? await db.select({ id: contactsTable.id, name: contactsTable.name }).from(contactsTable).where(eq(contactsTable.id, item.supplierId)).limit(1)
        : [];
      res.json({ supplier: supplier ?? null, leadDays: item.leadDays ?? null, ...shapeUsage(req.user!.role, bom, orders) });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/inventory/link-options
// الأصناف النشطة في البيانات الأساسية اللي لسه ماتسجّلتش في المخزون (الصنف الجديد لازم يتربط بواحد منهم).
// كانت بتتقرا من /foundation/items اللي أمين المخزن مالوش صلاحية عليها، فكان مبيقدرش يضيف صنف.
router.get(
  "/inventory/link-options",
  requireAuth,
  requirePermission("inventory.create"),
  async (_req, res, next) => {
    try {
      const rows = await db
        .select({
          id: foundationItemsTable.id,
          code: foundationItemsTable.code,
          name: foundationItemsTable.name,
          itemType: foundationItemsTable.itemType,
          baseUnit: foundationItemsTable.baseUnit,
          minStock: foundationItemsTable.minStock,
        })
        .from(foundationItemsTable)
        .where(
          and(
            eq(foundationItemsTable.active, true),
            sql`NOT EXISTS (SELECT 1 FROM inventory_items ii WHERE ii.foundation_item_id = ${foundationItemsTable.id})`,
          ),
        )
        .orderBy(asc(foundationItemsTable.code));
      res.json(rows.map((r) => ({ ...r, category: foundationTypeToCategory(r.itemType) })));
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/inventory
router.post(
  "/inventory",
  requireAuth,
  requirePermission("inventory.create"),
  async (req, res, next) => {
    try {
      const data = insertInventoryItemSchema.parse(req.body);
      if (data.foundationItemId) {
        const [dup] = await db
          .select({ id: inventoryItemsTable.id })
          .from(inventoryItemsTable)
          .where(eq(inventoryItemsTable.foundationItemId, data.foundationItemId))
          .limit(1);
        if (dup) {
          res.status(409).json({ error: { message: "الصنف ده متسجّل في المخزون بالفعل" } });
          return;
        }
      }
      const [created] = await db
        .insert(inventoryItemsTable)
        .values(data)
        .returning();
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/inventory/:id
router.get(
  "/inventory/:id",
  requireAuth,
  requireRole(...ACCESS.inventoryRead),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
       const [item] = await db
        .select()
        .from(inventoryItemsTable)
        .where(eq(inventoryItemsTable.id, id))
        .limit(1);

      if (!item) {
        res.status(404).json({ error: { message: "العنصر غير موجود" } });
        return;
      }
       if (["sales_manager", "online_seller", "offline_seller"].includes(req.user!.role) &&
           item.category !== "finished_good") {
         res.status(404).json({ error: { message: "العنصر غير موجود" } });
         return;
       }
       const isSales = ["sales_manager", "online_seller", "offline_seller"].includes(req.user!.role);
       const base = isSales ? {
         id: item.id, name: item.name, unit: item.unit, category: item.category,
         qty: item.qty, reservedQty: item.reservedQty,
       } : item;
       res.json({
         ...(maskFields("inventory_items", base, req.user!.role) as typeof base),
        availableQty: String(Math.max(0, Number(item.qty) - Number(item.reservedQty))),
      });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/inventory/:id
router.patch(
  "/inventory/:id",
  requireAuth,
  requirePermission("inventory.edit"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const data = insertInventoryItemSchema.partial().parse(req.body);
      const [updated] = await db
        .update(inventoryItemsTable)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(inventoryItemsTable.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: { message: "العنصر غير موجود" } });
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/inventory/:id
router.delete(
  "/inventory/:id",
  requireAuth,
  requirePermission("inventory.delete"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [existing] = await db
        .select()
        .from(inventoryItemsTable)
        .where(eq(inventoryItemsTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "العنصر غير موجود" } });
        return;
      }
      // نقل للسلة + حذف في معاملة واحدة: لو الصنف مرتبط (حركات/وصفات/أوامر شراء...) الحذف بيتلغي
      // كله ومفيش نسخة يتيمة في السلة، والمستخدم بياخد رسالة واضحة بدل خطأ سيرفر.
      try {
        await db.transaction(async (tx) => {
          await moveToTrash(tx, "inventory_items", existing, req.user!.userId, req.user!.username, existing.name);
          await tx.delete(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
        });
      } catch (e) {
        if (findPostgresError(e)?.code === "23503") {
          res.status(409).json({
            error: {
              code: "ITEM_IN_USE",
              message: "الصنف عليه حركات أو وصفات أو أوامر مرتبطة، فمينفعش يتحذف. عدّل بياناته أو سيبه بدون رصيد.",
            },
          });
          return;
        }
        throw e;
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
