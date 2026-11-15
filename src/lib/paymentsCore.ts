/** @format */
// قواعد التحصيل النقية (50): التوزيع على الفواتير، فحص التخصيص، وسطور القيد. من غير قاعدة بيانات.
import { centsDecimal } from "./ledgerAutoCore";
import type { EntryLineInput } from "./ledgerCore";
import { toCents } from "./money";

export const PAYMENT_METHODS = ["cash", "bank"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const SOURCE_CUSTOMER_PAYMENT = "customer_payment";
export const SOURCE_PAYMENT_ALLOCATION = "payment_allocation";
/** الأوامر اللي عليها مديونية فعلًا (الفاتورة اتأكدت). */
export const INVOICED_STATUSES: readonly string[] = ["confirmed", "shipped", "paid"];
export const PAYMENT_ACCOUNT_CODES = { cash: "1110", bank: "1120", receivable: "1130", advances: "2160" } as const;
export const cashAccountCode = (m: PaymentMethod): string => (m === "bank" ? PAYMENT_ACCOUNT_CODES.bank : PAYMENT_ACCOUNT_CODES.cash);

export interface OpenInvoice { orderId: number; orderNumber: string; date: string; totalCents: bigint; paidCents: bigint }
export const outstandingCents = (i: Pick<OpenInvoice, "totalCents" | "paidCents">): bigint => {
  const v = i.totalCents - i.paidCents;
  return v > 0n ? v : 0n;
};

export interface AllocationLine { orderId: number; cents: bigint }

/** توزيع تلقائي: الأقدم الأول (تاريخ الأمر ثم رقمه)، وكل فاتورة بحد أقصى المتبقي عليها. الباقي (لو فاضل) بدون تخصيص. */
export function fifoAllocate(invoices: readonly OpenInvoice[], amountCents: bigint): { lines: AllocationLine[]; unallocatedCents: bigint } {
  const sorted = [...invoices].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.orderId - b.orderId));
  const lines: AllocationLine[] = [];
  let left = amountCents;
  for (const inv of sorted) {
    if (left <= 0n) break;
    const room = outstandingCents(inv);
    if (room <= 0n) continue;
    const take = room < left ? room : left;
    lines.push({ orderId: inv.orderId, cents: take });
    left -= take;
  }
  return { lines, unallocatedCents: left };
}

export type AllocationIssue = "EMPTY" | "BAD_AMOUNT" | "DUPLICATE_ORDER" | "UNKNOWN_ORDER" | "EXCEEDS_INVOICE" | "EXCEEDS_PAYMENT";

/** فحص تخصيص يدوي: كل سطر على فاتورة مفتوحة للعميل نفسه، من غير تكرار، ومش أكتر من المتبقي عليها ولا من المتاح في التحصيل. */
export function checkAllocations(lines: readonly AllocationLine[], open: ReadonlyMap<number, OpenInvoice>, availableCents: bigint): AllocationIssue[] {
  const issues = new Set<AllocationIssue>();
  if (lines.length === 0) issues.add("EMPTY");
  const seen = new Set<number>();
  let sum = 0n;
  for (const l of lines) {
    if (l.cents <= 0n) issues.add("BAD_AMOUNT");
    if (seen.has(l.orderId)) issues.add("DUPLICATE_ORDER");
    seen.add(l.orderId);
    const inv = open.get(l.orderId);
    if (!inv) issues.add("UNKNOWN_ORDER");
    else if (l.cents > outstandingCents(inv)) issues.add("EXCEEDS_INVOICE");
    sum += l.cents;
  }
  if (sum > availableCents) issues.add("EXCEEDS_PAYMENT");
  return [...issues];
}

export const ALLOCATION_ISSUE_TEXT: Record<AllocationIssue, string> = {
  EMPTY: "اختار فاتورة واحدة على الأقل",
  BAD_AMOUNT: "مبلغ التخصيص لازم يكون أكبر من صفر",
  DUPLICATE_ORDER: "نفس الفاتورة اتكررت",
  UNKNOWN_ORDER: "فاتورة مش مفتوحة أو مش بتاعة العميل ده",
  EXCEEDS_INVOICE: "المبلغ أكبر من المتبقي على الفاتورة",
  EXCEEDS_PAYMENT: "مجموع التخصيص أكبر من المتاح في التحصيل",
};

/** قيد التحصيل: مدين الخزينة/البنك بالكامل، دائن العملاء بالمخصّص، ودائن الدفعات المقدمة بالباقي. */
export function paymentEntryLines(a: { cashId: number; receivableId: number; advancesId: number; amountCents: bigint; allocatedCents: bigint; memo: string }): EntryLineInput[] {
  const lines: EntryLineInput[] = [{ accountId: a.cashId, debit: centsDecimal(a.amountCents), memo: a.memo }];
  if (a.allocatedCents > 0n) lines.push({ accountId: a.receivableId, credit: centsDecimal(a.allocatedCents), memo: a.memo });
  const rest = a.amountCents - a.allocatedCents;
  if (rest > 0n) lines.push({ accountId: a.advancesId, credit: centsDecimal(rest), memo: a.memo });
  return lines;
}

/** تخصيص جزء كان واقف كدفعة مقدمة: مدين الدفعات المقدمة، دائن العملاء. */
export function advanceApplyLines(a: { receivableId: number; advancesId: number; cents: bigint; memo: string }): EntryLineInput[] {
  const amount = centsDecimal(a.cents);
  return [{ accountId: a.advancesId, debit: amount, memo: a.memo }, { accountId: a.receivableId, credit: amount, memo: a.memo }];
}

export type PaymentInputCheck = { ok: true; cents: bigint } | { ok: false; error: string };
/** مبلغ التحصيل: موجب، لحد خانتين عشريتين. */
export function parsePaymentAmount(raw: string): PaymentInputCheck {
  const s = String(raw).trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return { ok: false, error: "المبلغ لازم يكون رقم موجب بحد أقصى خانتين عشريتين" };
  const cents = toCents(s);
  return cents > 0n ? { ok: true, cents } : { ok: false, error: "المبلغ لازم يكون أكبر من صفر" };
}
