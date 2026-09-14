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

export const DEFAULT_BASE_DAYS = 5;
export const OPEN_ORDERS_PER_EXTRA_DAY = 10;
export const MAX_LOAD_DAYS = 7;

// أي حالة غير دي تُعتبر "مفتوحة" (بتنافس على موارد الإنتاج)
const TERMINAL_STATUSES = new Set([
  "completed",
  "delivered_customer",
  "delivered_warehouse",
  "cancelled",
]);

export function computeBaseDurationDays(params: {
  expectedProductionDays: number | null | undefined;
  qty: number;
  outputQty: number;
}): number {
  const baseDays =
    params.expectedProductionDays && params.expectedProductionDays > 0 ?
      params.expectedProductionDays
    : DEFAULT_BASE_DAYS;
  const outputQty = params.outputQty > 0 ? params.outputQty : 1;
  const multiplier = Math.max(1, Math.ceil(params.qty / outputQty));
  return baseDays * (1 + (multiplier - 1) * 0.5);
}

export function computeLoadDays(openOrdersCount: number): number {
  const days = Math.floor(openOrdersCount / OPEN_ORDERS_PER_EXTRA_DAY);
  return Math.min(days, MAX_LOAD_DAYS);
}

export function addCalendarDays(from: Date, days: number): string {
  const result = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

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
