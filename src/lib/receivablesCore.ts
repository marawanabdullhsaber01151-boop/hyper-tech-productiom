/** @format */
// كشف حساب العميل وأعمار الديون (51). منطق نقي من غير قاعدة بيانات.
// الأساس التشغيلي: الفاتورة = أمر بيع مؤكَّد/مشحون (أو مدفوع بتحصيل فعلي)، والتحصيل = تحصيل ساري.
// العمر بيتحسب من تاريخ الفاتورة (شروط الدفع على أوامر الإنتاج مش على أمر البيع، فمفيش «استحقاق» هنا).

export const AGE_BUCKETS = ["b0", "b30", "b60", "b90"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/** عدد الأيام بين تاريخين (YYYY-MM-DD). مش بيرجع سالب: فاتورة بتاريخ مستقبلي = 0. */
export function ageDays(invoiceDate: string, asOf: string): number {
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${invoiceDate}T00:00:00Z`);
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** 0-30 | 31-60 | 61-90 | أكتر من 90. */
export function bucketOf(days: number): AgeBucket {
  if (days <= 30) return "b0";
  if (days <= 60) return "b30";
  if (days <= 90) return "b60";
  return "b90";
}

export const signedDecimal = (c: bigint): string => {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
};

export interface AgingInvoice { contactId: number; contactName: string; orderId: number; orderNumber: string; date: string; outstandingCents: bigint }
export interface AgingRow { contactId: number; contactName: string; buckets: Record<AgeBucket, bigint>; totalCents: bigint; oldestDays: number; invoices: number }

const emptyBuckets = (): Record<AgeBucket, bigint> => ({ b0: 0n, b30: 0n, b60: 0n, b90: 0n });

/** تجميع الفواتير المفتوحة لكل عميل في شرايح الأعمار. الفاتورة المسدّدة (متبقي ≤ 0) بتتخطى. الأكبر دين الأول. */
export function buildAging(invoices: readonly AgingInvoice[], asOf: string): { rows: AgingRow[]; totals: Record<AgeBucket, bigint>; totalCents: bigint } {
  const by = new Map<number, AgingRow>();
  for (const inv of invoices) {
    if (inv.outstandingCents <= 0n) continue;
    const days = ageDays(inv.date, asOf);
    const row = by.get(inv.contactId) ?? { contactId: inv.contactId, contactName: inv.contactName, buckets: emptyBuckets(), totalCents: 0n, oldestDays: 0, invoices: 0 };
    row.buckets[bucketOf(days)] += inv.outstandingCents;
    row.totalCents += inv.outstandingCents;
    row.oldestDays = Math.max(row.oldestDays, days);
    row.invoices += 1;
    by.set(inv.contactId, row);
  }
  const rows = [...by.values()].sort((a, b) => (a.totalCents === b.totalCents ? a.contactId - b.contactId : a.totalCents < b.totalCents ? 1 : -1));
  const totals = emptyBuckets();
  let totalCents = 0n;
  for (const r of rows) {
    for (const b of AGE_BUCKETS) totals[b] += r.buckets[b];
    totalCents += r.totalCents;
  }
  return { rows, totals, totalCents };
}

export type MovementKind = "invoice" | "payment";
export interface Movement { kind: MovementKind; id: number; date: string; number: string; cents: bigint; note: string | null }
export interface StatementLine extends Movement { debitCents: bigint; creditCents: bigint; balanceCents: bigint }

const KIND_ORDER: Record<MovementKind, number> = { invoice: 0, payment: 1 };

/**
 * كشف الحساب: رصيد أول المدة = كل الحركات قبل «من»، وبعدين الحركات في المدة بالترتيب (تاريخ ← فاتورة قبل تحصيل ← رقم)
 * ورصيد جاري بعد كل حركة. الفاتورة مدين، والتحصيل دائن. رصيد موجب = على العميل، وسالب = للعميل (دفعة مقدمة).
 */
export function buildStatement(movements: readonly Movement[], from: string | null, to: string | null): { openingCents: bigint; lines: StatementLine[]; closingCents: bigint; debitCents: bigint; creditCents: bigint } {
  const sorted = [...movements].sort((a, b) => (a.date === b.date ? (KIND_ORDER[a.kind] === KIND_ORDER[b.kind] ? a.id - b.id : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) : a.date < b.date ? -1 : 1));
  const delta = (m: Movement): bigint => (m.kind === "invoice" ? m.cents : -m.cents);
  let opening = 0n;
  const inRange: Movement[] = [];
  for (const m of sorted) {
    if (from && m.date < from) opening += delta(m);
    else if (!to || m.date <= to) inRange.push(m);
  }
  let balance = opening;
  let debit = 0n;
  let credit = 0n;
  const lines = inRange.map((m): StatementLine => {
    const d = m.kind === "invoice" ? m.cents : 0n;
    const c = m.kind === "payment" ? m.cents : 0n;
    balance += d - c;
    debit += d;
    credit += c;
    return { ...m, debitCents: d, creditCents: c, balanceCents: balance };
  });
  return { openingCents: opening, lines, closingCents: balance, debitCents: debit, creditCents: credit };
}
