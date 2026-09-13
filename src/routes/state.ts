/** @format */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, appStateTable, setStateSchema } from "../db";
import { requireAuth } from "../middleware/auth";

const router = Router();

const KEY_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

router.get("/state", requireAuth, async (_req, res, next) => {
  try {
    const rows = await db.select().from(appStateTable);
    const state: Record<string, unknown> = {};
    let updatedAt = new Date(0).toISOString();
    for (const row of rows) {
      state[row.key] = row.value;
      const rowUpdatedAt = row.updatedAt.toISOString();
      if (rowUpdatedAt > updatedAt) updatedAt = rowUpdatedAt;
    }
    res.json({ state, updatedAt });
  } catch (err) {
    next(err);
  }
});

router.put("/state/:key", requireAuth, async (req, res, next) => {
  try {
    const key = String(req.params.key);
    if (!KEY_PATTERN.test(key)) {
      res.status(400).json({ error: { message: "مفتاح غير صالح" } });
      return;
    }
    const { value } = setStateSchema.parse(req.body);
    const [saved] = await db
      .insert(appStateTable)
      .values({ key, value })
      .onConflictDoUpdate({
        target: appStateTable.key,
        set: { value, updatedAt: new Date() },
      })
      .returning();
    res.json({ key: saved.key, value: saved.value });
  } catch (err) {
    next(err);
  }
});

router.delete("/state/:key", requireAuth, async (req, res, next) => {
  try {
    const key = String(req.params.key);
    await db.delete(appStateTable).where(eq(appStateTable.key, key));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
