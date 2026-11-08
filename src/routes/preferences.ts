/** @format */
// تفضيلات المستخدم المحفوظة على السيرفر (الخطوة 41ب): ترتيب وإخفاء كروت اللوحة. كل مستخدم بيقرا ويكتب تفضيله هو بس.
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, userPreferencesTable } from "../db";
import { DASHBOARD_PREF_KEY, DEFAULT_DASHBOARD_PREFS, isValidPrefsInput, normalizePrefs } from "../domain/dashboardPrefs";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use("/me/preferences", requireAuth);

// GET /api/v1/me/preferences/dashboard
router.get("/me/preferences/dashboard", async (req, res, next) => {
  try {
    const [row] = await db.select({ value: userPreferencesTable.value }).from(userPreferencesTable)
      .where(and(eq(userPreferencesTable.userId, req.user!.userId), eq(userPreferencesTable.key, DASHBOARD_PREF_KEY))).limit(1);
    res.json(row ? normalizePrefs(row.value) : DEFAULT_DASHBOARD_PREFS);
  } catch (err) { next(err); }
});

// PUT /api/v1/me/preferences/dashboard  { order: [...], hidden: [...] } — كتابة واحدة (upsert) فمفيش حاجة لمعاملة
router.put("/me/preferences/dashboard", async (req, res, next) => {
  try {
    if (!isValidPrefsInput(req.body)) { res.status(400).json({ error: { message: "ترتيب الكروت غير صالح" } }); return; }
    const value = normalizePrefs(req.body);
    await db.insert(userPreferencesTable).values({ userId: req.user!.userId, key: DASHBOARD_PREF_KEY, value })
      .onConflictDoUpdate({ target: [userPreferencesTable.userId, userPreferencesTable.key], set: { value, updatedAt: new Date() } });
    res.json(value);
  } catch (err) { next(err); }
});

// DELETE /api/v1/me/preferences/dashboard — رجوع للترتيب الأصلي
router.delete("/me/preferences/dashboard", async (req, res, next) => {
  try {
    await db.delete(userPreferencesTable).where(and(eq(userPreferencesTable.userId, req.user!.userId), eq(userPreferencesTable.key, DASHBOARD_PREF_KEY)));
    res.json(DEFAULT_DASHBOARD_PREFS);
  } catch (err) { next(err); }
});

export default router;
