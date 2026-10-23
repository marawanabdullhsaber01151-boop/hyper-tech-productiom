/** @format */
/**
 * ملخص الصباح الذكي — تقرير يومي تلقائي لرئيس المجلس والمدير التنفيذي.
 * بيستخدم نفس فحوصات «صحة النظام» (مصدر واحد للحقيقة)، فمفيش رقم يتعرض في الملخص
 * وهو مختلف عن اللي بيظهر في الصفحة. لو كله سليم بيطمّن، ولو في مشكلة بيسمّيها وبيدّي رابط معالجتها.
 */
import { and, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { notificationsTable } from "../db/schema";
import { ACCESS } from "./accessRegistry";
import { notifyRoles } from "./notifications";
import { runSystemHealth } from "./systemHealth";
import { BRIEF_DEDUPE_HOURS, DAILY_BRIEF_REF, DAILY_BRIEF_TYPE, composeBrief } from "./dailyBriefCore";

export type BriefResult = { sent: boolean; reason?: "already_sent"; status?: string; problems?: number };

/** يبعت الملخص لأصحاب صلاحية «صحة النظام» لو ما اتبعتش النهارده. */
export async function sendDailyBrief(now: Date = new Date()): Promise<BriefResult> {
  const since = new Date(now.getTime() - BRIEF_DEDUPE_HOURS * 3600_000);
  const [recent] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.type, DAILY_BRIEF_TYPE), gte(notificationsTable.createdAt, since)))
    .limit(1);
  if (recent) return { sent: false, reason: "already_sent" };

  const brief = composeBrief(await runSystemHealth());
  await notifyRoles([...ACCESS.systemHealthRead], {
    type: DAILY_BRIEF_TYPE,
    title: brief.title,
    body: brief.body,
    referenceType: DAILY_BRIEF_REF,
  });
  return { sent: true, status: brief.status, problems: brief.problems };
}

export { BRIEF_MAX_ITEMS, composeBrief } from "./dailyBriefCore";
