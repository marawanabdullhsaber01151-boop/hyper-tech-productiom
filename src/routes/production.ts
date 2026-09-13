/** @format */

import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db, productionOrdersTable, insertProductionOrderSchema } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { moveToTrash } from "../lib/trash";
import { getUnlinkedBomItemNames } from "../lib/materials";
import { PERMISSIONS } from "../lib/permissions";
import { bomRecipesTable } from "../db";

const router = Router();

// GET /api/v1/production-orders
router.get(
  "/production-orders",
  requireAuth,
  requireRole(...PERMISSIONS.production.view),
  async (req, res, next) => {
    try {
      const { status } = req.query as { status?: string };
      let query = db.select().from(productionOrdersTable).$dynamic();
      if (status) query = query.where(eq(productionOrdersTable.status, status));

      // ✅ ORDER BY DESC مباشرةً بدلاً من .orderBy(ASC).reverse()
      const orders = await query.orderBy(desc(productionOrdersTable.createdAt));
      res.json(orders);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/production-orders
router.post(
  "/production-orders",
  requireAuth,
  requireRole(...PERMISSIONS.production.write),
  async (req, res, next) => {
    try {
      const data = insertProductionOrderSchema.parse(req.body);

      // ✅ اختيار المنتج لازم يكون من وصفة تصنيع فعلية — مفيش اسم منتج حر
      if (!data.bomRecipeId) {
        res
          .status(400)
          .json({
            error: {
              code: "RECIPE_REQUIRED",
              message:
                "لازم تختار منتج له وصفة تصنيع محفوظة، مفيش إدخال يدوي لاسم المنتج",
            },
          });
        return;
      }
      const [recipe] = await db
        .select()
        .from(bomRecipesTable)
        .where(eq(bomRecipesTable.id, data.bomRecipeId))
        .limit(1);
      if (!recipe) {
        res
          .status(400)
          .json({
            error: {
              code: "RECIPE_NOT_FOUND",
              message: "وصفة التصنيع المختارة غير موجودة",
            },
          });
        return;
      }

      // ✅ منع تأكيد أمر الإنتاج لو فيه أي مكوّن في الوصفة لسه مش مرتبط بصنف حقيقي بالمخزون
      const unlinked = await getUnlinkedBomItemNames(data.bomRecipeId);
      if (unlinked.length > 0) {
        res.status(400).json({
          error: {
            code: "UNLINKED_COMPONENTS",
            message: `لازم تربط كل مكوّنات الوصفة بالمخزون الأول. المكوّنات غير المرتبطة: ${unlinked.join("، ")}`,
            unlinkedComponents: unlinked,
          },
        });
        return;
      }

      // ✅ اسم المنتج مُشتق من الوصفة نفسها دايمًا — مش من إدخال المستخدم
      const [created] = await db
        .insert(productionOrdersTable)
        .values({ ...data, productName: recipe.productName })
        .returning();
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/production-orders/:id
router.get(
  "/production-orders/:id",
  requireAuth,
  requireRole(...PERMISSIONS.production.view),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [order] = await db
        .select()
        .from(productionOrdersTable)
        .where(eq(productionOrdersTable.id, id))
        .limit(1);

      if (!order) {
        res.status(404).json({ error: { message: "أمر الإنتاج غير موجود" } });
        return;
      }
      res.json(order);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/production-orders/:id
router.patch(
  "/production-orders/:id",
  requireAuth,
  requireRole(...PERMISSIONS.production.write),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const data = insertProductionOrderSchema.partial().parse(req.body);

      if (data.bomRecipeId) {
        const [recipe] = await db
          .select()
          .from(bomRecipesTable)
          .where(eq(bomRecipesTable.id, data.bomRecipeId))
          .limit(1);
        if (!recipe) {
          res
            .status(400)
            .json({
              error: {
                code: "RECIPE_NOT_FOUND",
                message: "وصفة التصنيع المختارة غير موجودة",
              },
            });
          return;
        }
        const unlinked = await getUnlinkedBomItemNames(data.bomRecipeId);
        if (unlinked.length > 0) {
          res.status(400).json({
            error: {
              code: "UNLINKED_COMPONENTS",
              message: `لازم تربط كل مكوّنات الوصفة بالمخزون الأول. المكوّنات غير المرتبطة: ${unlinked.join("، ")}`,
              unlinkedComponents: unlinked,
            },
          });
          return;
        }
        data.productName = recipe.productName;
      }

      const [updated] = await db
        .update(productionOrdersTable)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(productionOrdersTable.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: { message: "أمر الإنتاج غير موجود" } });
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/production-orders/:id
router.delete(
  "/production-orders/:id",
  requireAuth,
  requireRole(...PERMISSIONS.production.write),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [existing] = await db
        .select()
        .from(productionOrdersTable)
        .where(eq(productionOrdersTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "أمر الإنتاج غير موجود" } });
        return;
      }
      await moveToTrash(
        db,
        "production_orders",
        existing,
        req.user!.userId,
        req.user!.username,
        existing.orderNumber,
      );
      await db
        .delete(productionOrdersTable)
        .where(eq(productionOrdersTable.id, id));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
