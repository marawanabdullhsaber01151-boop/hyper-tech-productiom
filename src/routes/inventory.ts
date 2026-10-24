/** @format */

import { Router } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, inventoryItemsTable, insertInventoryItemSchema } from "../db";
import { foundationItemsTable } from "../db/schema";
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
      await moveToTrash(
        db,
        "inventory_items",
        existing,
        req.user!.userId,
        req.user!.username,
        existing.name,
      );
      await db
        .delete(inventoryItemsTable)
        .where(eq(inventoryItemsTable.id, id));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
