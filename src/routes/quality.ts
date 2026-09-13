/** @format */

import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  qualityInspectionsTable,
  insertQualityInspectionSchema,
} from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { moveToTrash } from "../lib/trash";
import { PERMISSIONS } from "../lib/permissions";

const router = Router();

// GET /api/v1/quality
router.get(
  "/quality",
  requireAuth,
  requireRole(...PERMISSIONS.quality.view),
  async (req, res, next) => {
    try {
      const { result, reference_type } = req.query as Record<
        string,
        string | undefined
      >;
      let query = db.select().from(qualityInspectionsTable).$dynamic();
      if (result)
        query = query.where(eq(qualityInspectionsTable.result, result));
      if (reference_type)
        query = query.where(
          eq(qualityInspectionsTable.referenceType, reference_type),
        );
      const inspections = await query.orderBy(
        qualityInspectionsTable.createdAt,
      );
      res.json(inspections.reverse());
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/quality
router.post(
  "/quality",
  requireAuth,
  requireRole(...PERMISSIONS.quality.write),
  async (req, res, next) => {
    try {
      const data = insertQualityInspectionSchema.parse(req.body);
      const [created] = await db
        .insert(qualityInspectionsTable)
        .values(data)
        .returning();
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/quality/:id
router.get(
  "/quality/:id",
  requireAuth,
  requireRole(...PERMISSIONS.quality.view),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [inspection] = await db
        .select()
        .from(qualityInspectionsTable)
        .where(eq(qualityInspectionsTable.id, id))
        .limit(1);

      if (!inspection) {
        res.status(404).json({ error: { message: "سجل الفحص غير موجود" } });
        return;
      }
      res.json(inspection);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/quality/:id
router.patch(
  "/quality/:id",
  requireAuth,
  requireRole(...PERMISSIONS.quality.write),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const data = insertQualityInspectionSchema.partial().parse(req.body);
      const [updated] = await db
        .update(qualityInspectionsTable)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(qualityInspectionsTable.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: { message: "سجل الفحص غير موجود" } });
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/quality/:id
router.delete(
  "/quality/:id",
  requireAuth,
  requireRole(...PERMISSIONS.quality.write),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [existing] = await db
        .select()
        .from(qualityInspectionsTable)
        .where(eq(qualityInspectionsTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: { message: "سجل الفحص غير موجود" } });
        return;
      }
      await moveToTrash(
        db,
        "quality_inspections",
        existing,
        req.user!.userId,
        req.user!.username,
        null,
      );
      await db
        .delete(qualityInspectionsTable)
        .where(eq(qualityInspectionsTable.id, id));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
