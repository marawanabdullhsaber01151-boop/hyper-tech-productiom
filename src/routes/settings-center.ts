/** @format */
// مركز الإعدادات (40أ): سجل الإعدادات المنظّم + حفظ بمعاملة وتدقيق + سجل «مين غيّر إيه».
import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { auditEventsTable, db, systemUsersTable } from "../db";
import { requirePermission } from "../middleware/auth";
import { SETTING_DEFS, defOf } from "../domain/settings-registry";
import { loadSettingValues, saveSettings } from "../lib/settingsStore";

const router = Router();
const requireSettings = requirePermission("settings.manageUsers");

const ISSUE_TEXT: Record<string, string> = {
  unknown: "إعداد غير معروف", type: "قيمة غير صالحة", range: "القيمة خارج الحدود المسموحة", length: "النص أطول من المسموح",
  option: "اختيار غير موجود", email: "الإيميل غير صالح", required: "الحقل ده لازم يتكتب", hours: "نهاية الدوام لازم تكون بعد البداية",
};

// الإعدادات بكل بياناتها (التعريف + القيمة الفعلية + الافتراضي) علشان الشاشة تتبني منها.
router.get("/settings/center", requireSettings, async (_req, res, next) => {
  try {
    const values = await loadSettingValues();
    res.json({ data: { defs: SETTING_DEFS, values } });
  } catch (err) { next(err); }
});

const saveSchema = z.object({ values: z.record(z.union([z.string(), z.number()])), reason: z.string().trim().max(300).optional() });

router.put("/settings/center", requireSettings, async (req, res, next) => {
  try {
    const body = saveSchema.parse(req.body);
    const result = await saveSettings(body.values, { userId: req.user!.userId, username: req.user!.username, ip: req.ip, userAgent: req.get("user-agent") }, body.reason);
    if (!result.ok) {
      res.status(400).json({ error: { code: "INVALID_SETTINGS", message: result.issues.map((i) => `${defOf(i.key)?.label ?? i.key}: ${ISSUE_TEXT[i.error] ?? i.error}`).join(" — "), issues: result.issues } });
      return;
    }
    res.json({ data: { changed: result.changes.length, values: result.values } });
  } catch (err) { next(err); }
});

// آخر التغييرات: مين، إمتى، من إيه لإيه.
router.get("/settings/center/history", requireSettings, async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = await db.select({
      id: auditEventsTable.id, createdAt: auditEventsTable.createdAt, actorName: systemUsersTable.fullName, actorUsername: auditEventsTable.actorName,
      before: auditEventsTable.beforeData, after: auditEventsTable.afterData, reason: auditEventsTable.reason,
    }).from(auditEventsTable)
      .leftJoin(systemUsersTable, eq(auditEventsTable.actorUserId, systemUsersTable.id))
      .where(and(eq(auditEventsTable.actionKey, "setting.changed"), eq(auditEventsTable.resourceType, "system_setting")))
      .orderBy(desc(auditEventsTable.id)).limit(limit);
    const val = (x: unknown) => (x && typeof x === "object" && "value" in x ? String((x as { value: unknown }).value) : "");
    const key = (x: unknown) => (x && typeof x === "object" && "key" in x ? String((x as { key: unknown }).key) : "");
    res.json({ data: rows.map((r) => {
      const k = key(r.after) || key(r.before);
      return { id: r.id, createdAt: r.createdAt, actor: r.actorName || r.actorUsername || "—", key: k, label: defOf(k)?.label ?? k, before: val(r.before), after: val(r.after), reason: r.reason };
    }) });
  } catch (err) { next(err); }
});

export default router;
