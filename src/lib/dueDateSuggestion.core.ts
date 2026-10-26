/** @format */
/** الجزء النقي من اقتراح تاريخ التسليم (من غير قاعدة بيانات) عشان يتشارك مع حساب السعة. التوثيق في dueDateSuggestion.ts. */

export const DEFAULT_BASE_DAYS = 5;
export const OPEN_ORDERS_PER_EXTRA_DAY = 10;
export const MAX_LOAD_DAYS = 7;

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

