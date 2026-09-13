/** @format */

import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  stockMovementsTable,
  inventoryItemsTable,
  insertStockMovementSchema,
} from "../db";
import {
  requireAuth,
  requireRole,
  requirePermission,
} from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { applyStockMovement } from "../lib/stock";
import { moveToTrash } from "../lib/trash";
import { PERMISSIONS } from "../lib/permissions";
import { assertReferencedMovement } from "../lib/phase0";

const router = Router();

// GET /api/v1/stock-movements
router.get(
  "/stock-movements",
  requireAuth,
  requireRole(...PERMISSIONS.movements.view),
  async (req, res, next) => {
    try {
      const { item_id, type } = req.query as Record<string, string | undefined>;
      let query = db.select().from(stockMovementsTable).$dynamic();
      if (item_id)
        query = query.where(
          eq(stockMovementsTable.inventoryItemId, parseInt(item_id, 10)),
        );
      if (type) query = query.where(eq(stockMovementsTable.movementType, type));
      const movements = await query.orderBy(stockMovementsTable.createdAt);
      res.json(movements.reverse());
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/stock-movements
router.post(
  "/stock-movements",
  requireAuth,
  requirePermission("movements.create"),
  async (req, res, next) => {
    try {
      const data = insertStockMovementSchema.parse(req.body);
      assertReferencedMovement(data);
      if (data.referenceType === "production") {
        res.status(403).json({
          error: { message: "حركات الإنتاج لا تُسجّل من المسار العام؛ استخدم مسار التشغيل والتحويلات الرسمية." },
        });
        return;
      }

      const created = await db.transaction(async (tx) => {
        return applyStockMovement(tx, {
          inventoryItemId: data.inventoryItemId,
          movementType: data.movementType as "in" | "out",
          qty: data.qty,
          referenceType: data.referenceType,
          referenceId: data.referenceId,
          unitPrice: data.unitPrice,
          notes: data.notes,
        });
      });

      res.status(201).json(created);
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        res
          .status((err as any).status)
          .json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// GET /api/v1/stock-movements/:id
router.get(
  "/stock-movements/:id",
  requireAuth,
  requireRole(...PERMISSIONS.movements.view),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [movement] = await db
        .select()
        .from(stockMovementsTable)
        .where(eq(stockMovementsTable.id, id))
        .limit(1);

      if (!movement) {
        res.status(404).json({ error: { message: "حركة المخزون غير موجودة" } });
        return;
      }
      res.json(movement);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/stock-movements/:id
// بيرجّع تأثير الحركة على كمية المخزون الأول (عكس in/out)، وبعدين ينقلها لسلة المهملات ويمسحها —
// بنفس منطق عكس الأثر المستخدم في حذف بنود فواتير المبيعات.
router.delete(
  "/stock-movements/:id",
  requireAuth,
  requirePermission("movements.delete"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;

      await db.transaction(async (tx) => {
        const [movement] = await tx
          .select()
          .from(stockMovementsTable)
          .where(eq(stockMovementsTable.id, id))
          .limit(1);

        if (!movement) {
          throw Object.assign(new Error("حركة المخزون غير موجودة"), {
            status: 404,
          });
        }

        const [item] = await tx
          .select()
          .from(inventoryItemsTable)
          .where(eq(inventoryItemsTable.id, movement.inventoryItemId))
          .for("update");

        if (!item) {
          throw Object.assign(
            new Error("الصنف المرتبط بهذه الحركة لم يعد موجوداً في المخزون"),
            { status: 404 },
          );
        }

        const currentQty = Number(item.qty);
        const moveQty = Number(movement.qty);
        // عكس الأثر: حركة "وارد" بتترجع بخصم الكمية، وحركة "منصرف" بترجع الكمية للمخزون
        const reversedQty =
          movement.movementType === "in" ?
            currentQty - moveQty
          : currentQty + moveQty;

        if (reversedQty < 0) {
          throw Object.assign(
            new Error(
              `تعذّر حذف الحركة: الكمية الحالية لصنف "${item.name}" (${currentQty}) أقل من كمية الحركة (${moveQty}) — على الأغلب تم صرف جزء منها بعد هذه الحركة`,
            ),
            { status: 400 },
          );
        }

        await tx
          .update(inventoryItemsTable)
          .set({ qty: String(reversedQty), updatedAt: new Date() })
          .where(eq(inventoryItemsTable.id, item.id));

        await moveToTrash(
          tx,
          "stock_movements",
          movement,
          req.user!.userId,
          req.user!.username,
          `${item.name} — ${movement.movementType === "in" ? "وارد" : "منصرف"} ${moveQty}`,
        );
        await tx
          .delete(stockMovementsTable)
          .where(eq(stockMovementsTable.id, id));
      });

      res.status(204).send();
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        res
          .status((err as any).status)
          .json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  },
);

export default router;
