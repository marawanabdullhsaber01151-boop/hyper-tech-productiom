/** @format */
// مركز الإعدادات (40أ): سجل الإعدادات المنظّم + حفظ بمعاملة وتدقيق + سجل «مين غيّر إيه».
import { Router } from "express";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { auditEventsTable, db, systemUsersTable, workHolidaysTable } from "../db";
import { requireAuth, requirePermission } from "../middleware/auth";
import { SETTING_DEFS, defOf } from "../domain/settings-registry";
import { loadSettingValues, saveSettings } from "../lib/settingsStore";
import { writeAuditEvent } from "../lib/governance";
import { holidayIssue, holidayWindowStart } from "../lib/workHolidays";
import { todayCairo } from "../lib/operationsCapacityCore";

const router = Router();
const requireSettings = requirePermission("settings.manageUsers");

// بدون requireAuth الـreq.user بيبقى فاضي فكل طلب بيرجع 401 والواجهة تخرّج المستخدم (ده كان سبب «الإعدادات بتخرّجني»).
router.use("/settings/center", requireAuth);

const ISSUE_TEXT: Record<string, string> = {
  unknown: "إعداد غير معروف", type: "قيمة غير صالحة", range: "القيمة خارج الحدود المسموحة", length: "النص أطول من المسموح",
  option: "اختيار غير موجود", email: "الإيميل غير صالح", required: "الحقل ده لازم يتكتب", hours: "نهاية الدوام لازم تكون بعد البداية", days: "الإجازة التانية لازم تختلف عن الإجازة الأسبوعية",
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

// العطلات (43ب): السعة وتواريخ الانتهاء المتوقعة بتتخطى التواريخ دي. بنعرض آخر 30 يوم وكل اللي جاي.
router.get("/settings/center/holidays", requireSettings, async (_req, res, next) => {
  try {
    const from = holidayWindowStart(todayCairo(new Date()));
    const rows = await db.select().from(workHolidaysTable).where(gte(workHolidaysTable.holidayDate, from)).orderBy(asc(workHolidaysTable.holidayDate)).limit(400);
    res.json({ data: rows.map((r) => ({ id: r.id, date: r.holidayDate, reason: r.reason })) });
  } catch (err) { next(err); }
});

const holidaySchema = z.object({ date: z.string().trim(), reason: z.string().trim().max(120) });

router.post("/settings/center/holidays", requireSettings, async (req, res, next) => {
  try {
    const body = holidaySchema.parse(req.body);
    const issue = holidayIssue(body.date, body.reason, todayCairo(new Date()));
    if (issue) { res.status(400).json({ error: { code: "INVALID_HOLIDAY", message: issue } }); return; }
    const [existing] = await db.select({ id: workHolidaysTable.id }).from(workHolidaysTable).where(eq(workHolidaysTable.holidayDate, body.date)).limit(1);
    if (existing) { res.status(409).json({ error: { code: "HOLIDAY_EXISTS", message: "التاريخ ده متسجّل كعطلة قبل كده" } }); return; }
    const row = await db.transaction(async (tx) => {
      const [saved] = await tx.insert(workHolidaysTable).values({ holidayDate: body.date, reason: body.reason, createdBy: req.user!.userId }).returning();
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "holiday.added", resourceType: "work_holiday", resourceId: saved!.id, afterData: { date: body.date, reason: body.reason }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      return saved!;
    });
    res.status(201).json({ data: { id: row.id, date: row.holidayDate, reason: row.reason } });
  } catch (err) { next(err); }
});

router.delete("/settings/center/holidays/:id", requireSettings, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: { code: "INVALID_ID", message: "رقم العطلة غير صالح" } }); return; }
    const done = await db.transaction(async (tx) => {
      const [gone] = await tx.delete(workHolidaysTable).where(eq(workHolidaysTable.id, id)).returning();
      if (!gone) return null;
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "holiday.removed", resourceType: "work_holiday", resourceId: id, beforeData: { date: gone.holidayDate, reason: gone.reason }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      return gone;
    });
    if (!done) { res.status(404).json({ error: { code: "NOT_FOUND", message: "العطلة غير موجودة" } }); return; }
    res.json({ data: { id } });
  } catch (err) { next(err); }
});

export default router;
