/** @format */

import { Router } from "express";
import { eq, and, asc, count, inArray } from "drizzle-orm";
import {
  db,
  bomRecipesTable,
  bomRecipeItemsTable,
  insertBomRecipeSchema,
  insertBomRecipeItemSchema,
  foundationItemsTable,
  productImagesTable,
  insertProductImageSchema,
  inventoryItemsTable,
  productionOrdersTable,
  productionRequestsTable,
  productionWorkflowOrdersTable,
  portalPriceInquiriesTable,
} from "../db";
import { writeAuditEvent } from "../lib/governance";
import {
  requireAuth,
  requireRole,
  requirePermission,
} from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { moveToTrash } from "../lib/trash";
import { getEnrichedBomItems } from "../lib/materials";
import { PERMISSIONS } from "../lib/permissions";
import { assertImageDataUrlOk, nextSecondarySortOrder } from "../lib/productImages";
import { z } from "zod";

const router = Router();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** كل مكوّن مربوط بالمخزون لازم يكون صنف موجود فعلًا (بدل خطأ مفتاح أجنبي 500 مبهم). */
async function assertInventoryItemsExist(tx: Tx, ids: Array<number | null | undefined>) {
  const wanted = [...new Set(ids.filter((v): v is number => typeof v === "number"))];
  if (!wanted.length) return;
  const found = await tx.select({ id: inventoryItemsTable.id }).from(inventoryItemsTable).where(inArray(inventoryItemsTable.id, wanted));
  if (found.length !== wanted.length) {
    throw Object.assign(new Error("في مكوّن مربوط بصنف مخزون مش موجود. اختار الصنف من القائمة."), { status: 400 });
  }
}

/** كام مكان بيستخدم الوصفة دي (أوامر إنتاج، طلبات إنتاج، استفسارات أسعار). لو أكتر من صفر الحذف ممنوع والإيقاف هو الحل. */
async function recipeUsage(tx: Tx, id: number) {
  const [[o], [w], [r], [q]] = await Promise.all([
    tx.select({ n: count() }).from(productionOrdersTable).where(eq(productionOrdersTable.bomRecipeId, id)),
    tx.select({ n: count() }).from(productionWorkflowOrdersTable).where(eq(productionWorkflowOrdersTable.bomRecipeId, id)),
    tx.select({ n: count() }).from(productionRequestsTable).where(eq(productionRequestsTable.bomRecipeId, id)),
    tx.select({ n: count() }).from(portalPriceInquiriesTable).where(eq(portalPriceInquiriesTable.bomRecipeId, id)),
  ]);
  const orders = Number(o?.n ?? 0) + Number(w?.n ?? 0), requests = Number(r?.n ?? 0), inquiries = Number(q?.n ?? 0);
  return { orders, requests, inquiries, total: orders + requests + inquiries };
}

const itemPatchSchema = insertBomRecipeItemSchema.omit({ recipeId: true }).partial();

const createBomSchema = insertBomRecipeSchema.extend({
  items: z.array(insertBomRecipeItemSchema.omit({ recipeId: true })).optional(),
});

// Phase 1 (Governance & Portal project): bom_recipes.productCode/productName
// must come from the linked Foundation item, not be independently typed,
// once a recipe is linked to صفحة البيانات الأساسية. This resolves the
// Foundation item and returns the canonical fields to merge into the recipe
// payload, or throws a clear Arabic error if the id doesn't point at an
// active "finished_good" Foundation item.
async function resolveFoundationLink(foundationItemId: number) {
  const [item] = await db
    .select()
    .from(foundationItemsTable)
    .where(eq(foundationItemsTable.id, foundationItemId))
    .limit(1);
  if (!item) {
    throw Object.assign(
      new Error("الصنف المختار من صفحة البيانات الأساسية مش موجود"),
      { status: 400 },
    );
  }
  if (item.itemType !== "finished_good") {
    throw Object.assign(
      new Error(
        "الصنف ده مش من نوع \"منتج تام\" في صفحة البيانات الأساسية — لازم تختار صنف من النوع ده",
      ),
      { status: 400 },
    );
  }
  if (!item.active) {
    throw Object.assign(
      new Error("الصنف ده متوقف حاليًا في صفحة البيانات الأساسية"),
      { status: 400 },
    );
  }
  return {
    foundationItemId: item.id,
    productCode: item.code,
    productName: item.name,
  };
}

// GET /api/v1/bom/lookups — اختيارات النماذج (منتجات تامة + أصناف مخزون للربط). من غير أسعار ولا كميات مخزون.
// (لازم قبل "/bom/:id" وإلا Express هيفسّر "lookups" كـ :id)
router.get(
  "/bom/lookups",
  requireAuth,
  requireRole(...PERMISSIONS.bom.view),
  async (_req, res, next) => {
    try {
      const [products, inventory] = await Promise.all([
        db
          .select({ id: foundationItemsTable.id, code: foundationItemsTable.code, name: foundationItemsTable.name })
          .from(foundationItemsTable)
          .where(and(eq(foundationItemsTable.itemType, "finished_good"), eq(foundationItemsTable.active, true)))
          .orderBy(asc(foundationItemsTable.code)),
        db
          .select({ id: inventoryItemsTable.id, code: inventoryItemsTable.code, name: inventoryItemsTable.name, unit: inventoryItemsTable.unit })
          .from(inventoryItemsTable)
          .orderBy(asc(inventoryItemsTable.name)),
      ]);
      res.json({ data: { products, inventory } });
    } catch (err) {
      next(err);
    }
  },
);

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

      // Phase 1 (Governance & Portal project): every new recipe must be
      // linked to a real Foundation "finished_good" item — no more
      // free-typed product identity for new recipes. Legacy recipes created
      // before this phase are untouched (see PATCH below, where the link
      // stays optional so existing rows keep working).
      if (!recipeData.foundationItemId) {
        res.status(400).json({
          error: {
            message:
              "لازم تختار المنتج من صفحة البيانات الأساسية الأول قبل ما تضيف وصفة له",
          },
        });
        return;
      }
      const foundationFields = await resolveFoundationLink(
        recipeData.foundationItemId,
      );

      // الوصفة + مكوّناتها معاملة واحدة: انقطاع بينهم كان بيسيب وصفة من غير مكوّنات،
      // والإنتاج عليها كان هيستهلك صفر خامات.
      const { recipe, recipeItems } = await db.transaction(async (tx) => {
        await assertInventoryItemsExist(tx, (items ?? []).map((i: { inventoryItemId?: number | null }) => i.inventoryItemId));
        const [created] = await tx
          .insert(bomRecipesTable)
          .values({ ...recipeData, ...foundationFields })
          .returning();

        if (items && items.length > 0) {
          await tx
            .insert(bomRecipeItemsTable)
            .values(
              items.map((item: (typeof items)[0]) => ({
                ...item,
                recipeId: created.id,
              })),
            );
        }

        const rows = await tx
          .select()
          .from(bomRecipeItemsTable)
          .where(eq(bomRecipeItemsTable.recipeId, created.id));
        await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "bom.recipe.create", resourceType: "bom_recipe", resourceId: created.id, afterData: { productName: created.productName, foundationItemId: created.foundationItemId, items: rows.length }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
        return { recipe: created, recipeItems: rows };
      });

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

      // Phase 2 (Governance & Portal project): صور المنتج — الرئيسية والفرعية.
      const images = await db
        .select({
          id: productImagesTable.id,
          role: productImagesTable.role,
          imageData: productImagesTable.imageData,
          sortOrder: productImagesTable.sortOrder,
        })
        .from(productImagesTable)
        .where(eq(productImagesTable.bomRecipeId, id))
        .orderBy(productImagesTable.sortOrder);

      res.json({ ...recipe, items, images });
    } catch (err) {
      next(err);
    }
  },
);

// Phase 2 (Governance & Portal project) — product images.
// Base64-in-DB by design; see src/db/schema/product-images.ts for why.

// POST /api/v1/bom/:id/images/primary — رفع/استبدال الصورة الرئيسية
router.post(
  "/bom/:id/images/primary",
  requireAuth,
  requirePermission("bom.edit"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const { imageData } = insertProductImageSchema
        .pick({ imageData: true })
        .parse(req.body);
      assertImageDataUrlOk(imageData);

      const [recipe] = await db
        .select({ id: bomRecipesTable.id })
        .from(bomRecipesTable)
        .where(eq(bomRecipesTable.id, id))
        .limit(1);
      if (!recipe) {
        res.status(404).json({ error: { message: "الوصفة غير موجودة" } });
        return;
      }

      const saved = await db.transaction(async (tx) => {
        // استبدال: نمسح أي صورة رئيسية قديمة ونحط الجديدة، عشان يفضل واحدة بس.
        await tx
          .delete(productImagesTable)
          .where(
            and(
              eq(productImagesTable.bomRecipeId, id),
              eq(productImagesTable.role, "primary"),
            ),
          );
        const [created] = await tx
          .insert(productImagesTable)
          .values({
            bomRecipeId: id,
            role: "primary",
            imageData,
            sortOrder: 0,
            uploadedByUserId: req.user?.userId ?? null,
          })
          .returning();
        await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "bom.image.primary", resourceType: "bom_recipe", resourceId: id, afterData: { imageId: created!.id }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
        return created;
      });
      res.status(201).json(saved);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/bom/:id/images/secondary — إضافة صورة فرعية جديدة
router.post(
  "/bom/:id/images/secondary",
  requireAuth,
  requirePermission("bom.edit"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const { imageData } = insertProductImageSchema
        .pick({ imageData: true })
        .parse(req.body);
      assertImageDataUrlOk(imageData);

      const [recipe] = await db
        .select({ id: bomRecipesTable.id })
        .from(bomRecipesTable)
        .where(eq(bomRecipesTable.id, id))
        .limit(1);
      if (!recipe) {
        res.status(404).json({ error: { message: "الوصفة غير موجودة" } });
        return;
      }

      const existing = await db
        .select({ sortOrder: productImagesTable.sortOrder })
        .from(productImagesTable)
        .where(
          and(
            eq(productImagesTable.bomRecipeId, id),
            eq(productImagesTable.role, "secondary"),
          ),
        );
      const nextSortOrder = nextSecondarySortOrder(
        existing.map((e) => e.sortOrder),
      );

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(productImagesTable)
          .values({
            bomRecipeId: id,
            role: "secondary",
            imageData,
            sortOrder: nextSortOrder,
            uploadedByUserId: req.user?.userId ?? null,
          })
          .returning();
        await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "bom.image.secondary", resourceType: "bom_recipe", resourceId: id, afterData: { imageId: row!.id }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
        return row!;
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/bom/:id/images/reorder — إعادة ترتيب الصور الفرعية
router.patch(
  "/bom/:id/images/reorder",
  requireAuth,
  requirePermission("bom.edit"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const { order } = z
        .object({ order: z.array(z.number().int().positive()) })
        .parse(req.body);

      await db.transaction(async (tx) => {
        for (let i = 0; i < order.length; i++) {
          await tx
            .update(productImagesTable)
            .set({ sortOrder: i })
            .where(
              and(
                eq(productImagesTable.id, order[i]),
                eq(productImagesTable.bomRecipeId, id),
                eq(productImagesTable.role, "secondary"),
              ),
            );
        }
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/bom/:id/images/:imageId — حذف أي صورة (رئيسية أو فرعية)
router.delete(
  "/bom/:id/images/:imageId",
  requireAuth,
  requirePermission("bom.edit"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const imageId = parseIdParam(req.params.imageId, res);
      if (imageId === null) return;

      const deleted = await db.transaction(async (tx) => {
        const rows = await tx
          .delete(productImagesTable)
          .where(and(eq(productImagesTable.id, imageId), eq(productImagesTable.bomRecipeId, id)))
          .returning({ id: productImagesTable.id, role: productImagesTable.role });
        if (rows.length) {
          await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "bom.image.delete", resourceType: "bom_recipe", resourceId: id, beforeData: { imageId, role: rows[0]!.role }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
        }
        return rows;
      });
      if (!deleted.length) {
        res.status(404).json({ error: { message: "الصورة غير موجودة" } });
        return;
      }
      res.json({ ok: true });
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

      // Phase 1 (Governance & Portal project): if a foundation link is being
      // set/changed, re-derive productCode/productName from Foundation so
      // they never drift out of sync with the master record. Existing
      // recipes that don't touch foundationItemId in this PATCH are left
      // exactly as before (backward compatible with legacy unlinked rows).
      const foundationFields = data.foundationItemId
        ? await resolveFoundationLink(data.foundationItemId)
        : {};

      const updated = await db.transaction(async (tx) => {
        const [before] = await tx.select().from(bomRecipesTable).where(eq(bomRecipesTable.id, id)).for("update").limit(1);
        if (!before) throw Object.assign(new Error("الوصفة غير موجودة"), { status: 404 });
        const [row] = await tx
          .update(bomRecipesTable)
          .set({ ...data, ...foundationFields, updatedAt: new Date() })
          .where(eq(bomRecipesTable.id, id))
          .returning();
        await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "bom.recipe.update", resourceType: "bom_recipe", resourceId: id, beforeData: { productName: before.productName, isActive: before.isActive, outputQty: before.outputQty, referencePrice: before.referencePrice }, afterData: { productName: row!.productName, isActive: row!.isActive, outputQty: row!.outputQty, referencePrice: row!.referencePrice }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
        return row!;
      });
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
        // وصفة اتستخدمت في إنتاج أو طلبات: الحذف كان بيقع بخطأ مفتاح أجنبي 500. دلوقتي رفض واضح، والإيقاف هو البديل.
        const usage = await recipeUsage(tx, id);
        if (usage.total > 0) {
          throw Object.assign(
            new Error(`الوصفة دي مستخدمة (${usage.orders} أمر إنتاج، ${usage.requests} طلب إنتاج، ${usage.inquiries} استفسار سعر). أوقفها بدل ما تمسحها عشان السجلات القديمة تفضل سليمة.`),
            { status: 409 },
          );
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
        await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "bom.recipe.delete", resourceType: "bom_recipe", resourceId: id, beforeData: { productName: existing.productName, items: items.length }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
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
      // Phase 3 (Governance & Portal project): same 2MB cap as product images
      // for a featured-ingredient image (format is already checked by the zod
      // schema; this adds the size guard).
      if (data.featuredImageData) {
        assertImageDataUrlOk(data.featuredImageData);
      }
      const item = await db.transaction(async (tx) => {
        const [recipe] = await tx.select({ id: bomRecipesTable.id }).from(bomRecipesTable).where(eq(bomRecipesTable.id, recipeId)).for("update").limit(1);
        if (!recipe) throw Object.assign(new Error("الوصفة غير موجودة"), { status: 404 });
        await assertInventoryItemsExist(tx, [data.inventoryItemId]);
        const [created] = await tx.insert(bomRecipeItemsTable).values({ ...data, recipeId }).returning();
        await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "bom.item.add", resourceType: "bom_recipe", resourceId: recipeId, afterData: { itemId: created!.id, materialName: created!.materialName, qty: created!.qty, unit: created!.unit }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
        return created!;
      });
      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/bom/:id/items/:itemId — تعديل مكوّن (الكمية، الربط بالمخزون، المميز وصورته)
router.patch(
  "/bom/:id/items/:itemId",
  requireAuth,
  requirePermission("bom.edit"),
  async (req, res, next) => {
    try {
      const recipeId = parseIdParam(req.params.id, res);
      if (recipeId === null) return;
      const itemId = parseIdParam(req.params.itemId, res);
      if (itemId === null) return;
      const data = itemPatchSchema.parse(req.body);
      if (data.featuredImageData) assertImageDataUrlOk(data.featuredImageData);
      const updated = await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(bomRecipeItemsTable)
          .where(and(eq(bomRecipeItemsTable.id, itemId), eq(bomRecipeItemsTable.recipeId, recipeId)))
          .for("update")
          .limit(1);
        if (!before) throw Object.assign(new Error("المكوّن غير موجود في الوصفة دي"), { status: 404 });
        await assertInventoryItemsExist(tx, [data.inventoryItemId]);
        const [row] = await tx.update(bomRecipeItemsTable).set(data).where(eq(bomRecipeItemsTable.id, itemId)).returning();
        await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "bom.item.update", resourceType: "bom_recipe", resourceId: recipeId, beforeData: { itemId, qty: before.qty, unit: before.unit, inventoryItemId: before.inventoryItemId, isFeatured: before.isFeatured }, afterData: { qty: row!.qty, unit: row!.unit, inventoryItemId: row!.inventoryItemId, isFeatured: row!.isFeatured }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
        return row!;
      });
      res.json(updated);
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
      const recipeId = parseIdParam(req.params.id, res);
      if (recipeId === null) return;
      const itemId = parseIdParam(req.params.itemId, res);
      if (itemId === null) return;

      // المكوّن لازم يكون تبع الوصفة اللي في المسار (قبل كده كان بيتمسح أي مكوّن بالرقم بس).
      const [existing] = await db
        .select()
        .from(bomRecipeItemsTable)
        .where(and(eq(bomRecipeItemsTable.id, itemId), eq(bomRecipeItemsTable.recipeId, recipeId)))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "المكوّن غير موجود في الوصفة دي" } });
        return;
      }
      await db.transaction(async (tx) => {
        await moveToTrash(
          tx,
          "bom_recipe_items",
          existing,
          req.user!.userId,
          req.user!.username,
          existing.materialName,
        );
        await tx
          .delete(bomRecipeItemsTable)
          .where(eq(bomRecipeItemsTable.id, itemId));
        await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "bom.item.delete", resourceType: "bom_recipe", resourceId: recipeId, beforeData: { itemId, materialName: existing.materialName, qty: existing.qty }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
