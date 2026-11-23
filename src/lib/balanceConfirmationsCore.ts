/** @format */
// تأكيد الأرصدة (53ب): القواعد النقية (لقطة كشف الحساب، المهلة، الانتقالات، التحقق، رؤية العميل). مفيش قاعدة بيانات هنا.
import { z } from "zod";
import { isIsoDate } from "./ledgerCore";
import { buildStatement, signedDecimal, type Movement } from "./receivablesCore";

export const CONFIRM_STATUSES = ["open", "agreed", "disputed", "resolved", "cancelled"] as const;
export type ConfirmStatus = (typeof CONFIRM_STATUSES)[number];

export const TASK_KIND = "balance_dispute";
export const TASK_SOURCE = "balance_confirmation";
export const REASON_MIN = 3;
/** مهلة رد العميل (أيام). بعدها الطلب بيتعلّم «متأخر» لكن العميل لسه يقدر يرد. */
export const REPLY_DAYS = 14;
/** اللقطة بتغطي آخر كام يوم، وحد أقصى لعدد الحركات المحفوظة. */
export const SNAPSHOT_DAYS = 180;
export const MAX_SNAPSHOT_LINES = 300;
/** أقدم يوم رصيد مقبول (أيام قبل النهارده). */
export const MAX_AS_OF_AGE_DAYS = 366;

export const taskDedupeKey = (id: number): string => `${TASK_SOURCE}:${id}`;

const dayNumber = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
export function addDays(iso: string, n: number): string {
  return new Date((dayNumber(iso) + n) * 86_400_000).toISOString().slice(0, 10);
}
export const replyDueDate = (today: string): string => addDays(today, REPLY_DAYS);
export const isOverdue = (status: string, dueDate: string, today: string): boolean => status === "open" && dueDate < today;

const isoDate = z.string().refine(isIsoDate, "التاريخ غير صحيح");
export const requestBodySchema = z.object({
  contactId: z.number().int().positive(),
  asOf: isoDate.optional(),
  note: z.string().trim().max(300).optional().nullable(),
});
export const AMOUNT_RE = /^-?\d{1,12}(\.\d{1,2})?$/;
export const disputeBodySchema = z.object({
  note: z.string().trim().min(REASON_MIN, "اكتب سبب الاعتراض عشان المالية تراجعه").max(500),
  amount: z.string().trim().regex(AMOUNT_RE, "المبلغ غير صحيح").optional().nullable(),
});
export const resolveBodySchema = z.object({ note: z.string().trim().min(REASON_MIN, "اكتب ملاحظة بتشرح النتيجة").max(500) });
export const cancelBodySchema = z.object({ reason: z.string().trim().min(REASON_MIN, "اكتب سبب الإلغاء").max(500) });

export type AsOfCheck = { ok: true } | { ok: false; code: "FUTURE_DATE" | "TOO_OLD"; error: string };
export function checkAsOf(asOf: string, today: string): AsOfCheck {
  if (asOf > today) return { ok: false, code: "FUTURE_DATE", error: "تاريخ الرصيد مينفعش يكون في المستقبل" };
  if (dayNumber(today) - dayNumber(asOf) > MAX_AS_OF_AGE_DAYS) return { ok: false, code: "TOO_OLD", error: "تاريخ الرصيد أقدم من سنة" };
  return { ok: true };
}

/** الانتقالات المسموحة (نفس ترجر القاعدة). */
export function canTransition(from: ConfirmStatus, to: ConfirmStatus): boolean {
  if (from === "open") return to === "agreed" || to === "disputed" || to === "cancelled";
  if (from === "disputed") return to === "resolved" || to === "cancelled";
  return false;
}
export const isActive = (s: string): boolean => s === "open" || s === "disputed";

export interface SnapshotLine { kind: "invoice" | "payment"; date: string; number: string; note: string | null; debit: string; credit: string; balance: string }
export interface Snapshot { balanceCents: bigint; openingCents: bigint; periodFrom: string; lines: SnapshotLine[] }

/** لقطة كشف الحساب لحد يوم `asOf`: الرصيد + آخر 180 يوم حركات (حد أقصى 300، والرصيد الافتتاحي بيتظبط عشان المعادلة تفضل صحيحة). */
export function buildSnapshot(movements: readonly Movement[], asOf: string): Snapshot {
  const periodFrom = addDays(asOf, -SNAPSHOT_DAYS);
  const s = buildStatement(movements, periodFrom, asOf);
  let lines = s.lines;
  let opening = s.openingCents;
  if (lines.length > MAX_SNAPSHOT_LINES) {
    const drop = lines.length - MAX_SNAPSHOT_LINES;
    opening = lines[drop - 1].balanceCents;
    lines = lines.slice(drop);
  }
  return {
    balanceCents: s.closingCents,
    openingCents: opening,
    periodFrom,
    lines: lines.map((l) => ({ kind: l.kind, date: l.date, number: l.number, note: l.note, debit: signedDecimal(l.debitCents), credit: signedDecimal(l.creditCents), balance: signedDecimal(l.balanceCents) })),
  };
}

/** رصيد موجب = على العميل، سالب = له عندنا، صفر = متعادل. */
export type Direction = "owes" | "credit" | "zero";
export const directionOf = (cents: bigint): Direction => (cents > 0n ? "owes" : cents < 0n ? "credit" : "zero");

export interface ConfirmationRow {
  id: number;
  confirmationNumber: string;
  contactId: number;
  portalCustomerId: number;
  asOf: string;
  balance: string;
  periodFrom: string;
  opening: string;
  lines: SnapshotLine[];
  note: string | null;
  dueDate: string;
  requestedByName: string;
  status: ConfirmStatus;
  respondedByName: string | null;
  respondedAt: string | null;
  customerAmount: string | null;
  customerNote: string | null;
  taskId: number | null;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

/** اللي العميل بيشوفه: من غير المهمة الداخلية ولا اسم موظف المالية ولا سبب الإلغاء الداخلي. */
export function toPortalView(r: ConfirmationRow, today: string) {
  return {
    id: r.id,
    confirmationNumber: r.confirmationNumber,
    asOf: r.asOf,
    balance: r.balance,
    direction: directionOf(BigInt(Math.round(Number(r.balance) * 100))),
    periodFrom: r.periodFrom,
    opening: r.opening,
    lines: r.lines,
    note: r.note,
    dueDate: r.dueDate,
    overdue: isOverdue(r.status, r.dueDate, today),
    status: r.status,
    respondedByName: r.respondedByName,
    respondedAt: r.respondedAt,
    customerAmount: r.customerAmount,
    customerNote: r.customerNote,
    resolutionNote: r.status === "resolved" ? r.resolutionNote : null,
    createdAt: r.createdAt,
  };
}

export function customerNotice(kind: "requested" | "resolved" | "cancelled", r: Pick<ConfirmationRow, "confirmationNumber" | "asOf" | "resolutionNote" | "dueDate">): { title: string; body: string } {
  if (kind === "requested") return { title: "المالية بتطلب تأكيد رصيدك", body: `الطلب ${r.confirmationNumber}: رصيدك في ${r.asOf}. راجعه ووافق عليه أو اعترض لحد ${r.dueDate}.` };
  if (kind === "resolved") return { title: "اتراجع اعتراضك على الرصيد", body: `الطلب ${r.confirmationNumber}: ${r.resolutionNote ?? ""}` };
  return { title: "اتلغى طلب تأكيد الرصيد", body: `الطلب ${r.confirmationNumber} اتلغى. مش مطلوب منك أي رد.` };
}
