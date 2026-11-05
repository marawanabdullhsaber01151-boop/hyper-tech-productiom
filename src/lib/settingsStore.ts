/** @format */
// مخزن الإعدادات (40أ): قراءة القيم الفعلية (كل مرة من القاعدة، يعني أي تغيير بيبان فورًا) وحفظها بمعاملة واحدة مع تدقيق لكل تغيير.
import { inArray, sql } from "drizzle-orm";
import { db, systemSettingsTable } from "../db";
import { SETTING_DEFS, isKnownKey, operationalConfig, planChanges, resolveSettings, type OperationalConfig, type SettingChange, type SettingValues, type SettingsIssue } from "../domain/settings-registry";
import { writeAuditEvent } from "./governance";

type Reader = Pick<typeof db, "select">;

async function storedValues(executor: Reader = db): Promise<Record<string, string>> {
  const rows = await executor.select({ key: systemSettingsTable.key, value: systemSettingsTable.value }).from(systemSettingsTable).where(inArray(systemSettingsTable.key, SETTING_DEFS.map((d) => d.key)));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function loadSettingValues(executor: Reader = db): Promise<SettingValues> {
  return resolveSettings(await storedValues(executor));
}

/** إعدادات التشغيل (ساعات العمل، مهلة الاعتماد، حساسية الوقوف). لو القراءة فشلت بنرجع للافتراضي بدل ما نوقف الشغل. */
export async function loadOperationalConfig(executor: Reader = db): Promise<OperationalConfig> {
  try { return operationalConfig(await storedValues(executor)); } catch { return operationalConfig({}); }
}

export interface SaveActor { userId: number; username: string; ip?: string | null; userAgent?: string | null }
export type SaveResult = { ok: true; changes: SettingChange[]; values: SettingValues } | { ok: false; issues: SettingsIssue[] };

/**
 * بيحفظ التغييرات الفعلية بس. كل تغيير = صف تدقيق (`setting.changed`) بالقيمة قبل وبعد، وكله في معاملة واحدة (ADR 0008):
 * ما يبقاش إعداد اتغيّر من غير أثر في السجل. القيم المخزّنة القديمة (مفاتيح بره السجل المنظّم) بتتقبل بعد التحقق من اسم المفتاح بس.
 */
export async function saveSettings(updates: Record<string, unknown>, actor: SaveActor, reason?: string | null): Promise<SaveResult> {
  const unknown = Object.keys(updates).filter((k) => !isKnownKey(k));
  if (unknown.length) return { ok: false, issues: unknown.map((key) => ({ key, error: "unknown" as const })) };
  const legacy = Object.fromEntries(Object.entries(updates).filter(([k]) => !SETTING_DEFS.some((d) => d.key === k)));
  const typed = Object.fromEntries(Object.entries(updates).filter(([k]) => SETTING_DEFS.some((d) => d.key === k)));
  return db.transaction(async (tx) => {
    const current = await storedValues(tx);
    const plan = planChanges(current, typed);
    if (plan.issues.length) return { ok: false as const, issues: plan.issues };
    const rows: Array<{ key: string; value: string; before: string; after: string }> = plan.changes.map((c) => ({ key: c.key, value: c.after, before: c.before, after: c.after }));
    for (const [key, v] of Object.entries(legacy)) {
      if (typeof v !== "string") continue;
      rows.push({ key, value: v, before: "", after: v });
    }
    for (const r of rows) {
      const [saved] = await tx.insert(systemSettingsTable).values({ key: r.key, value: r.value })
        .onConflictDoUpdate({ target: systemSettingsTable.key, set: { value: r.value, updatedAt: sql`now()` } }).returning({ id: systemSettingsTable.id });
      await writeAuditEvent({
        actorUserId: actor.userId, actorName: actor.username, actionKey: "setting.changed", resourceType: "system_setting",
        resourceId: saved.id, beforeData: { key: r.key, value: r.before }, afterData: { key: r.key, value: r.after },
        reason: reason ?? null, ipAddress: actor.ip, userAgent: actor.userAgent, executor: tx,
      });
    }
    const values = resolveSettings({ ...current, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) });
    return { ok: true as const, changes: plan.changes, values };
  });
}
