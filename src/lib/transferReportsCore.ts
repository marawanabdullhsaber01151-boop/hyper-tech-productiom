/** @format */
// إبلاغ العميل عن تحويل (53أ): القواعد النقية (تحقق، مهلة المالية، قرار التأكيد، رسايل). مفيش قاعدة بيانات هنا.
import { z } from "zod";
import { SLA_WORKING_MINUTES, workingMinutesBetween } from "../domain/approvals-inbox";
import { isIsoDate } from "./ledgerCore";
import { PAYMENT_METHODS, parsePaymentAmount, type PaymentMethod } from "./paymentsCore";

export const REPORT_METHODS = ["bank", "instapay", "wallet"] as const;
export type ReportMethod = (typeof REPORT_METHODS)[number];
export const REPORT_STATUSES = ["pending", "confirmed", "rejected"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const TASK_KIND = "transfer_report";
export const TASK_SOURCE = "customer_transfer_report";
export const REFERENCE_MIN = 3;
export const REASON_MIN = 3;
/** أقدم تاريخ تحويل مقبول من العميل (أيام). أقدم من كده غالبًا غلطة في السنة، فبيكلّم المبيعات. */
export const MAX_TRANSFER_AGE_DAYS = 90;
/** مهلة مراجعة المالية: نفس مهلة الاعتمادات (240 دقيقة عمل). */
export const REVIEW_SLA_MINUTES = SLA_WORKING_MINUTES;
/** أكبر تقارير معلّقة للشركة الواحدة: بيمنع الإغراق. */
export const MAX_PENDING_PER_COMPANY = 10;

export const taskDedupeKey = (reportId: number): string => `${TASK_SOURCE}:${reportId}`;

export const referenceKey = (ref: string): string => ref.trim().toLowerCase();

/** الطريقة اللي المالية بتقترحها عند التأكيد (تقدر تغيّرها): المحفظة بتتعامل كنقدي. */
export function defaultPaymentMethod(m: ReportMethod): PaymentMethod {
  return m === "wallet" ? "cash" : "bank";
}

const isoDate = z.string().refine(isIsoDate, "التاريخ غير صحيح");

export const reportBodySchema = z.object({
  amount: z.string(),
  transferDate: isoDate,
  method: z.enum(REPORT_METHODS),
  reference: z.string().trim().min(REFERENCE_MIN, "اكتب رقم العملية أو آخر 3 أرقام منها على الأقل").max(120),
  note: z.string().trim().max(500).optional().nullable(),
});
export type ReportBody = z.infer<typeof reportBodySchema>;

export type ReportCheck = { ok: true; cents: bigint } | { ok: false; code: "BAD_AMOUNT" | "FUTURE_DATE" | "TOO_OLD"; error: string };

const dayNumber = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/** تحقق من المبلغ والتاريخ. `today` تاريخ القاهرة (YYYY-MM-DD). */
export function checkReport(b: Pick<ReportBody, "amount" | "transferDate">, today: string): ReportCheck {
  const a = parsePaymentAmount(b.amount);
  if (!a.ok) return { ok: false, code: "BAD_AMOUNT", error: a.error };
  if (b.transferDate > today) return { ok: false, code: "FUTURE_DATE", error: "تاريخ التحويل مينفعش يكون في المستقبل" };
  if (dayNumber(today) - dayNumber(b.transferDate) > MAX_TRANSFER_AGE_DAYS) {
    return { ok: false, code: "TOO_OLD", error: `التحويل أقدم من ${MAX_TRANSFER_AGE_DAYS} يوم. كلّم المبيعات مباشرة.` };
  }
  return { ok: true, cents: a.cents };
}

/** موعد مهمة المالية: بعد 240 دقيقة عمل (9–5 بتوقيت القاهرة، الجمعة إجازة) من لحظة الإبلاغ. */
export function reviewDueAt(from: Date, minutes: number = REVIEW_SLA_MINUTES): Date {
  let t = new Date(from.getTime());
  for (let i = 0; i < 24 * 4 * 30; i++) {
    if (workingMinutesBetween(from, t) >= minutes) return t;
    t = new Date(t.getTime() + 15 * 60_000);
  }
  return t;
}

export const confirmBodySchema = z.object({
  amount: z.string().optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  paymentDate: isoDate.optional(),
  note: z.string().trim().max(500).optional().nullable(),
});
export const rejectBodySchema = z.object({ reason: z.string().trim().min(REASON_MIN, "اكتب سبب الرفض عشان العميل يفهم").max(500) });

export type ConfirmDecision =
  | { ok: true; cents: bigint; differs: boolean }
  | { ok: false; code: "BAD_AMOUNT" | "NOTE_REQUIRED"; error: string };

/** قرار التأكيد: لو المبلغ المؤكَّد غير المُبلَّغ، لازم ملاحظة بتشرح الفرق (بيتحفظ في السجل). */
export function decideConfirm(reportedCents: bigint, input: { amount?: string; note?: string | null }): ConfirmDecision {
  let cents = reportedCents;
  if (input.amount !== undefined) {
    const a = parsePaymentAmount(input.amount);
    if (!a.ok) return { ok: false, code: "BAD_AMOUNT", error: a.error };
    cents = a.cents;
  }
  const differs = cents !== reportedCents;
  if (differs && (input.note ?? "").trim().length < REASON_MIN) {
    return { ok: false, code: "NOTE_REQUIRED", error: "المبلغ المؤكَّد مختلف عن المُبلَّغ. اكتب ملاحظة بتشرح الفرق." };
  }
  return { ok: true, cents, differs };
}

export const canDecide = (status: string): boolean => status === "pending";

export interface TransferReportRow {
  id: number;
  reportNumber: string;
  contactId: number;
  portalCustomerId: number;
  reportedByName: string;
  amount: string;
  transferDate: string;
  method: ReportMethod;
  reference: string;
  note: string | null;
  status: ReportStatus;
  taskId: number | null;
  paymentId: number | null;
  paymentNumber?: string | null;
  confirmedAmount: string | null;
  reviewNote: string | null;
  rejectReason: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** اللي العميل بيشوفه: من غير مهمة داخلية ولا اسم موظف المالية ولا ملاحظته الداخلية. */
export function toPortalView(r: TransferReportRow) {
  return {
    id: r.id,
    reportNumber: r.reportNumber,
    amount: r.amount,
    transferDate: r.transferDate,
    method: r.method,
    reference: r.reference,
    note: r.note,
    status: r.status,
    reportedByName: r.reportedByName,
    confirmedAmount: r.status === "confirmed" ? r.confirmedAmount : null,
    rejectReason: r.status === "rejected" ? r.rejectReason : null,
    reviewedAt: r.reviewedAt,
    createdAt: r.createdAt,
  };
}

/** نص إشعار العميل بالقرار. */
export function customerNotice(r: Pick<TransferReportRow, "reportNumber" | "status" | "rejectReason" | "confirmedAmount" | "amount">): { title: string; body: string } {
  if (r.status === "confirmed") {
    return { title: "اتأكد تحويلك", body: `التحويل ${r.reportNumber} اتأكد وتسجّل في حسابك بمبلغ ${r.confirmedAmount ?? r.amount} جنيه.` };
  }
  return { title: "محتاجين نراجع تحويلك", body: `التحويل ${r.reportNumber} مااتأكدش: ${r.rejectReason ?? ""}. لو دفعت فعلًا كلّم المبيعات.` };
}
