/** @format */

import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  bomRecipesTable,
  bomRecipeItemsTable,
  insertBomRecipeSchema,
  insertBomRecipeItemSchema,
} from "../db";
import {
  requireAuth,
  requireRole,
  requirePermission,
} from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { moveToTrash } from "../lib/trash";
import { getEnrichedBomItems } from "../lib/materials";
import { PERMISSIONS } from "../lib/permissions";
import { z } from "zod";

const router = Router();

const createBomSchema = insertBomRecipeSchema.extend({
  items: z.array(insertBomRecipeItemSchema.omit({ recipeId: true })).optional(),
});

// GET /api/v1/bom
router.get(
  "/bom",
  requireAuth,
  requireRole(...PERMISSIONS.bom.view),
  async (_req, res, next) => {
    try {
      const recipes = await db
        .select()
        .from(bomRecipesTable)
        .orderBy(bomRecipesTable.productName);
      res.json(recipes);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/bom
router.post(
  "/bom",
  requireAuth,
  requirePermission("bom.create"),
  async (req, res, next) => {
    try {
      const { items, ...recipeData } = createBomSchema.parse(req.body);
      const [recipe] = await db
        .insert(bomRecipesTable)
        .values(recipeData)
        .returning();

      if (items && items.length > 0) {
        await db
          .insert(bomRecipeItemsTable)
          .values(
            items.map((item: (typeof items)[0]) => ({
              ...item,
              recipeId: recipe.id,
            })),
          );
      }

      const recipeItems = await db
        .select()
        .from(bomRecipeItemsTable)
        .where(eq(bomRecipeItemsTable.recipeId, recipe.id));

      res.status(201).json({ ...recipe, items: recipeItems });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/bom/items/all
// ✅ إضافة: مكوّنات كل الوصفات في نداء واحد — عشان صفحات زي "المواد الخام" تقدر
// تعرض "مستخدم في إيه" لكل صنف بسرعة، من غير ما تعمل نداء منفصل لكل وصفة على حدة.
// (لازم تتسجل قبل "/bom/:id" وإلا Express هيفسّر "items" كـ :id غلط)
router.get(
  "/bom/items/all",
  requireAuth,
  requireRole(...PERMISSIONS.bom.view),
  async (_req, res, next) => {
    try {
      const items = await db
        .select({
          id: bomRecipeItemsTable.id,
          recipeId: bomRecipeItemsTable.recipeId,
          inventoryItemId: bomRecipeItemsTable.inventoryItemId,
          materialName: bomRecipeItemsTable.materialName,
          qty: bomRecipeItemsTable.qty,
          unit: bomRecipeItemsTable.unit,
          unitCost: bomRecipeItemsTable.unitCost,
          productName: bomRecipesTable.productName,
          productCode: bomRecipesTable.productCode,
        })
        .from(bomRecipeItemsTable)
        .innerJoin(
          bomRecipesTable,
          eq(bomRecipeItemsTable.recipeId, bomRecipesTable.id),
        );
      res.json(items);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/bom/:id
router.get(
  "/bom/:id",
  requireAuth,
  requireRole(...PERMISSIONS.bom.view),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [recipe] = await db
        .select()
        .from(bomRecipesTable)
        .where(eq(bomRecipesTable.id, id))
        .limit(1);

      if (!recipe) {
        res.status(404).json({ error: { message: "الوصفة غير موجودة" } });
        return;
      }

      // ✅ كل مكوّن بيرجع مع حالته الحقيقية: مرتبط بالمخزون فعليًا؟ ومتوفر حاليًا؟
      const items = await getEnrichedBomItems(id);

      res.json({ ...recipe, items });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/bom/:id
router.patch(
  "/bom/:id",
  requireAuth,
  requirePermission("bom.edit"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const data = insertBomRecipeSchema.partial().parse(req.body);
      const [updated] = await db
        .update(bomRecipesTable)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(bomRecipesTable.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: { message: "الوصفة غير موجودة" } });
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/bom/:id
router.delete(
  "/bom/:id",
  requireAuth,
  requirePermission("bom.delete"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;

      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(bomRecipesTable)
          .where(eq(bomRecipesTable.id, id))
          .limit(1);
        if (!existing) {
          throw Object.assign(new Error("الوصفة غير موجودة"), { status: 404 });
        }
        // ✅ نقل مكوّنات الوصفة كمان للسلة قبل حذفها (بيتحذفوا تلقائيًا مع الوصفة عبر onDelete cascade)
        const items = await tx
          .select()
          .from(bomRecipeItemsTable)
          .where(eq(bomRecipeItemsTable.recipeId, id));
        for (const item of items) {
          await moveToTrash(
            tx,
            "bom_recipe_items",
            item,
            req.user!.userId,
            req.user!.username,
            existing.productName,
          );
        }
        await moveToTrash(
          tx,
          "bom_recipes",
          existing,
          req.user!.userId,
          req.user!.username,
          existing.productName,
        );
        await tx.delete(bomRecipesTable).where(eq(bomRecipesTable.id, id));
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/bom/:id/items
router.post(
  "/bom/:id/items",
  requireAuth,
  requirePermission("bom.edit"),
  async (req, res, next) => {
    try {
      const recipeId = parseIdParam(req.params.id, res);
      if (recipeId === null) return;
      const data = insertBomRecipeItemSchema
        .omit({ recipeId: true })
        .parse(req.body);
      const [item] = await db
        .insert(bomRecipeItemsTable)
        .values({ ...data, recipeId })
        .returning();
      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/bom/:id/items/:itemId
router.delete(
  "/bom/:id/items/:itemId",
  requireAuth,
  requirePermission("bom.edit"),
  async (req, res, next) => {
    try {
      const itemId = parseIdParam(req.params.itemId, res);
      if (itemId === null) return;

      const [existing] = await db
        .select()
        .from(bomRecipeItemsTable)
        .where(eq(bomRecipeItemsTable.id, itemId))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "المكوّن غير موجود" } });
        return;
      }
      await moveToTrash(
        db,
        "bom_recipe_items",
        existing,
        req.user!.userId,
        req.user!.username,
        existing.materialName,
      );
      await db
        .delete(bomRecipeItemsTable)
        .where(eq(bomRecipeItemsTable.id, itemId));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
