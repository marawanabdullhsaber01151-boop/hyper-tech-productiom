/** @format */
// تثبيت الوعد (44ب): قواعد نقية من غير قاعدة بيانات.

export const CLOSED_CASE_STATUSES = ["converted", "cancelled", "completed", "closed"] as const;
export const isClosedCase = (status: string): boolean => (CLOSED_CASE_STATUSES as readonly string[]).includes(status);

/** أول تثبيت من غير سبب. أي تثبيت بعده = تعديل وعد ولازم سبب (3 حروف على الأقل). */
export function commitIssue(input: { hasPrevious: boolean; reason: string | null | undefined }): "reason" | null {
  if (!input.hasPrevious) return null;
  return (input.reason ?? "").trim().length >= 3 ? null : "reason";
}

const DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** الفرق بالأيام بين الوعد الحالي المحسوب والمثبّت (موجب = المحسوب أبعد، يعني الوعد المثبّت بقى أضيق). */
export function driftDays(committed: string, live: string): number {
  return Math.round((parse(live) - parse(committed)) / DAY);
}

export type PromiseStanding = "within" | "over" | "none";
/** الوعد المثبّت مقابل موعد الحالة: جوه الموعد، أو بعده، أو من غير موعد. */
export function standing(promised: string, due: string | null): PromiseStanding {
  if (!due) return "none";
  return promised <= due ? "within" : "over";
}

export interface PromiseRow {
  id: number;
  caseId: number;
  promisedDate: string;
  confidencePercent: number | null;
  method: string;
  reason: string | null;
  createdAt: string;
}
export interface CasePromiseSummary {
  caseId: number;
  first: PromiseRow;
  current: PromiseRow;
  revisions: number;
}
/** بيجمّع صفوف الوعود (مرتبة بالأحدث أولًا) لكل حالة: الأول والحالي وعدد التعديلات. */
export function summarize(rows: readonly PromiseRow[]): CasePromiseSummary[] {
  const byCase = new Map<number, PromiseRow[]>();
  for (const r of rows) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r]);
  return [...byCase].map(([caseId, list]) => {
    const asc = [...list].sort((a, b) => a.id - b.id);
    return { caseId, first: asc[0] as PromiseRow, current: asc[asc.length - 1] as PromiseRow, revisions: asc.length - 1 };
  });
}
