/** @format */

import { Router, Request, Response, NextFunction } from "express";
import { eq, and, desc, count } from "drizzle-orm";
import { db } from "../db";
import { notificationsTable } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";

const router = Router();

// GET /api/v1/notifications
router.get(
  "/notifications",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const requestedLimit = Number(req.query.limit ?? 50);
      const limit =
        Number.isInteger(requestedLimit) && requestedLimit > 0 ?
          Math.min(requestedLimit, 100)
        : 50;

      const notifications = await db
        .select()
        .from(notificationsTable)
        .where(eq(notificationsTable.userId, userId))
        .orderBy(desc(notificationsTable.createdAt))
        .limit(limit);

      res.json({ data: notifications });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/notifications/unread-count
// ✅ إصلاح: COUNT في SQL بدلاً من جلب كل الصفوف وعدّها في JS
router.get(
  "/notifications/unread-count",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const [result] = await db
        .select({ count: count() })
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.userId, userId),
            eq(notificationsTable.isRead, false),
          ),
        );

      res.json({ count: result?.count ?? 0 });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/notifications/:id/read
router.patch(
  "/notifications/:id/read",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;

      const [updated] = await db
        .update(notificationsTable)
        .set({ isRead: true })
        .where(
          and(
            eq(notificationsTable.id, id),
            eq(notificationsTable.userId, userId),
          ),
        )
        .returning();

      if (!updated) {
        res.status(404).json({ error: { message: "الإشعار غير موجود" } });
        return;
      }
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/notifications/read-all
router.patch(
  "/notifications/read-all",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      await db
        .update(notificationsTable)
        .set({ isRead: true })
        .where(
          and(
            eq(notificationsTable.userId, userId),
            eq(notificationsTable.isRead, false),
          ),
        );
      res.json({ message: "تم تعليم كل الإشعارات مقروءة" });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/notifications/:id
router.delete(
  "/notifications/:id",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;

      await db
        .delete(notificationsTable)
        .where(
          and(
            eq(notificationsTable.id, id),
            eq(notificationsTable.userId, userId),
          ),
        );
      res.json({ message: "تم حذف الإشعار" });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
