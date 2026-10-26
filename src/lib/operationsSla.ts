import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { notificationsTable, operationsCasesTable } from "../db/schema";
import { notifyRoles } from "./notifications";
import { slaClock } from "./operationsCenterCore";

/** أقل فاصل بين مرّتين فحص داخل نفس العملية (السيرفرلس بيصحّى ويرجع ينام). */
const MIN_GAP_MS = 10 * 60 * 1000;
let lastSweepAt = 0;

export const SLA_NOTIFICATION_TYPE = "operations_sla_breach";

/**
 * تصعيد تلقائي: أي حالة تشغيل عدّت مهلتها (4 ساعات عمل للاستقبال/التحقق، يوم عمل لانتظار المبيعات)
 * بيتبلّغ عنها رئيس المجلس مرة واحدة بس. التكرار ممنوع بسجل الإشعارات نفسه.
 */
export async function escalateOperationsSla(
  now = new Date(),
  opts: { force?: boolean } = {},
): Promise<{ checked: number; escalated: number; skipped?: "throttled" }> {
  if (!opts.force && now.getTime() - lastSweepAt < MIN_GAP_MS) {
    return { checked: 0, escalated: 0, skipped: "throttled" };
  }
  lastSweepAt = now.getTime();

  const rows = await db
    .select({
      id: operationsCasesTable.id,
      caseNumber: operationsCasesTable.caseNumber,
      status: operationsCasesTable.status,
      createdAt: operationsCasesTable.createdAt,
      updatedAt: operationsCasesTable.updatedAt,
      customerDisplayName: operationsCasesTable.customerDisplayName,
    })
    .from(operationsCasesTable)
    .where(inArray(operationsCasesTable.status, ["received", "under_validation", "needs_sales_clarification"]));

  const breached = rows.filter((r) => slaClock(r, now)?.state === "breached");
  if (!breached.length) return { checked: rows.length, escalated: 0 };

  const already = await db
    .select({ referenceId: notificationsTable.referenceId })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.type, SLA_NOTIFICATION_TYPE),
        eq(notificationsTable.referenceType, "operations_case"),
        inArray(notificationsTable.referenceId, breached.map((b) => b.id)),
      ),
    );
  const seen = new Set(already.map((a) => a.referenceId));

  let escalated = 0;
  for (const item of breached) {
    if (seen.has(item.id)) continue;
    const clock = slaClock(item, now)!;
    await notifyRoles(["chairman"], {
      type: SLA_NOTIFICATION_TYPE,
      title: `حالة تشغيل عدّت مهلتها: ${item.caseNumber}`,
      body:
        clock.kind === "waiting_sales"
          ? `مستنية رد المبيعات بقالها ${clock.hours} ساعة عمل (المهلة ${clock.limit}).`
          : `من غير إجراء بقالها ${clock.hours} ساعة عمل (المهلة ${clock.limit}).`,
      referenceType: "operations_case",
      referenceId: item.id,
    });
    escalated += 1;
  }
  return { checked: rows.length, escalated };
}
