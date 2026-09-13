/** @format */

import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db, inventoryItemsTable, insertInventoryItemSchema } from "../db";
import {
  requireAuth,
  requireRole,
  requirePermission,
} from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { moveToTrash } from "../lib/trash";
import { PERMISSIONS } from "../lib/permissions";

const router = Router();

// GET /api/v1/inventory
router.get(
  "/inventory",
  requireAuth,
  requireRole(...PERMISSIONS.inventory.view),
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
       res.json(items.map((item) => ({
         ...(salesOnly ? {
           id: item.id, name: item.name, unit: item.unit, category: item.category,
           qty: item.qty, reservedQty: item.reservedQty,
         } : item),
        availableQty: String(Math.max(0, Number(item.qty) - Number(item.reservedQty))),
      })));
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
  requireRole(...PERMISSIONS.inventory.view),
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
       res.json({
         ...(["sales_manager", "online_seller", "offline_seller"].includes(req.user!.role) ? {
           id: item.id, name: item.name, unit: item.unit, category: item.category,
           qty: item.qty, reservedQty: item.reservedQty,
         } : item),
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
