/** @format */
/**
 * Due-Date Suggestion — اقتراح تاريخ التسليم لكل سطر في طلب البوابة (Phase 3)
 *
 * الصيغة (موثّقة هنا وفي CHANGE-MANIFEST-PHASE-3.md — أي تعديل مستقبلي في
 * المنطق لازم يتحدث في المكانين):
 *
 *   1. مدة أساسية = recipe.expectedProductionDays، أو DEFAULT_BASE_DAYS لو
 *      المنتج لسه ملوش تقدير مسجّل.
 *   2. عامل الكمية: لو الكمية المطلوبة أكبر من outputQty بتاعة الوصفة (يعني
 *      محتاجة أكتر من "دفعة" واحدة)، كل دفعة إضافية تزود نص المدة الأساسية
 *      بس (مش ضعف كامل) — بافتراض إن فيه كفاءة تصنيع تحصل مع تكرار نفس
 *      المنتج. multiplier = ceil(qty / outputQty)؛
 *      durationDays = baseDays * (1 + (multiplier - 1) * 0.5)
 *   3. عامل الحمل الحالي: عدد أوامر الإنتاج "المفتوحة" في النظام كله وقت
 *      الطلب (v1 heuristic بسيط زي ما البرومبت سمح — مفيش تقسيم حسب خط
 *      إنتاج أو مرحلة محددة لسه، ده تحسين مستقبلي). كل OPEN_ORDERS_PER_EXTRA_DAY
 *      أمر مفتوح إضافي = يوم زيادة، بحد أقصى MAX_LOAD_DAYS عشان الاقتراح
 *      مايبقاش غير واقعي مع الحمل الكبير جدًا.
 *   4. الناتج = تاريخ النهارده + ceil(durationDays) + loadDays أيام تقويمية
 *      (v1: أيام تقويمية عادية، من غير استبعاد الجمعة/الإجازات الرسمية —
 *      ده تحسين مستقبلي موثّق في المانفست).
 *
 * الدالتين الأساسيتين (computeBaseDurationDays, computeLoadDays) نقيتين
 * (pure) وقابلتين للاختبار من غير قاعدة بيانات؛ suggestDueDate هي اللي
 * بتتصل بقاعدة البيانات لحساب عدد الأوامر المفتوحة وقت الطلب.
 */
import { sql } from "drizzle-orm";
import { db, productionWorkflowOrdersTable } from "../db";

import { DEFAULT_BASE_DAYS, MAX_LOAD_DAYS, OPEN_ORDERS_PER_EXTRA_DAY, addCalendarDays, computeBaseDurationDays, computeLoadDays } from "./dueDateSuggestion.core";

export { DEFAULT_BASE_DAYS, MAX_LOAD_DAYS, OPEN_ORDERS_PER_EXTRA_DAY, addCalendarDays, computeBaseDurationDays, computeLoadDays };

// أي حالة غير دي تُعتبر "مفتوحة" (بتنافس على موارد الإنتاج)
const TERMINAL_STATUSES = new Set([
  "completed",
  "delivered_customer",
  "delivered_warehouse",
  "cancelled",
]);

export async function countOpenProductionOrders(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(productionWorkflowOrdersTable)
    .where(
      sql`${productionWorkflowOrdersTable.workflowStatus} NOT IN (${sql.join(
        [...TERMINAL_STATUSES].map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
  return row?.n ?? 0;
}

export async function suggestDueDate(params: {
  expectedProductionDays: number | null | undefined;
  qty: number;
  outputQty: number;
  now?: Date;
}): Promise<{ date: string; totalDays: number; breakdown: {
  baseDurationDays: number;
  loadDays: number;
} }> {
  const baseDurationDays = computeBaseDurationDays(params);
  const openOrdersCount = await countOpenProductionOrders();
  const loadDays = computeLoadDays(openOrdersCount);
  const totalDays = Math.ceil(baseDurationDays) + loadDays;
  const date = addCalendarDays(params.now ?? new Date(), totalDays);
  return { date, totalDays, breakdown: { baseDurationDays, loadDays } };
}
