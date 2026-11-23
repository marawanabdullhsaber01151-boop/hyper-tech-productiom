/** @format */
// إقفال الفترة المحاسبية (55): القواعد الصافية. نفس القواعد متكررة في ترجر القاعدة (هجرة 0107) كخط دفاع تاني.
import { z } from "zod";
import { addDays } from "./balanceConfirmationsCore";

export const REASON_MIN = 3;
export const DEFAULT_CLOSE_DAY = 5;
export const MIN_CLOSE_DAY = 1;
export const MAX_CLOSE_DAY = 28;
export const TASK_KIND = "period_close";
export const TASK_SOURCE = "gl_period";

export const closeBodySchema = z.object({ note: z.string().trim().max(300).optional().nullable() });
export const reopenBodySchema = z.object({ reason: z.string().trim().min(REASON_MIN, "اكتب سبب إعادة الفتح").max(500) });

/** يوم الإقفال من الإعدادات: قيمة تالفة أو برّه 1–28 ترجع 5. */
export function closeDayFrom(raw: string | undefined | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= MIN_CLOSE_DAY && n <= MAX_CLOSE_DAY ? n : DEFAULT_CLOSE_DAY;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** موعد إقفال فترة (سنة/شهر): يوم الإقفال من الشهر اللي بعده. */
export function closeDueDate(year: number, month: number, closeDay: number): string {
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  return `${ny}-${pad(nm)}-${pad(closeDay)}`;
}

/** الفترة اللي لازم تتقفل «دلوقتي»: الشهر اللي فات لو النهارده وصل يوم الإقفال أو عدّاه. */
export function periodDueNow(today: string, closeDay: number): { year: number; month: number } | null {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  if (d < closeDay) return null;
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

export interface PeriodLite { id: number; year: number; month: number; startsOn: string; endsOn: string; status: string }

export type CloseCheck = { ok: true } | { ok: false; code: "ALREADY_CLOSED" | "NOT_ENDED" | "EARLIER_OPEN"; error: string };

/** هل نقدر نقفل الفترة دي؟ (الشهر خلص + مفيش فترة أقدم لسه مفتوحة). */
export function canClose(p: PeriodLite, all: readonly PeriodLite[], today: string): CloseCheck {
  if (p.status !== "open") return { ok: false, code: "ALREADY_CLOSED", error: "الفترة دي مقفولة بالفعل" };
  if (p.endsOn >= today) return { ok: false, code: "NOT_ENDED", error: "الشهر لسه ما خلصش، مينفعش يتقفل" };
  if (all.some((x) => x.id !== p.id && x.status === "open" && x.endsOn < p.startsOn)) return { ok: false, code: "EARLIER_OPEN", error: "في فترة أقدم لسه مفتوحة، اقفلها الأول" };
  return { ok: true };
}

export type ReopenCheck = { ok: true } | { ok: false; code: "NOT_CLOSED" | "LATER_CLOSED"; error: string };

/** إعادة الفتح بالعكس: مينفعش لو في فترة أحدث مقفولة. */
export function canReopen(p: PeriodLite, all: readonly PeriodLite[]): ReopenCheck {
  if (p.status !== "closed") return { ok: false, code: "NOT_CLOSED", error: "الفترة دي مش مقفولة" };
  if (all.some((x) => x.id !== p.id && x.status === "closed" && x.startsOn > p.endsOn)) return { ok: false, code: "LATER_CLOSED", error: "في فترة أحدث مقفولة، افتحها الأول" };
  return { ok: true };
}

export const taskDedupeKey = (year: number, month: number, reopenCount: number): string => `${TASK_SOURCE}:${year}-${pad(month)}:${reopenCount}`;

/** حالة الفترة للعرض: متأخرة = لسه مفتوحة وعدّى موعد إقفالها. */
export function isLate(p: PeriodLite, closeDay: number, today: string): boolean {
  return p.status === "open" && closeDueDate(p.year, p.month, closeDay) < today;
}

/** آخر ميعاد للمهمة: نهاية يوم الإقفال بتوقيت القاهرة (UTC+2 تقريبًا، كفاية كموعد مهمة). */
export function taskDueAt(year: number, month: number, closeDay: number): Date {
  return new Date(`${closeDueDate(year, month, closeDay)}T21:00:00.000Z`);
}

export { addDays };
