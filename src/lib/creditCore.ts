/** @format */
// حدود الائتمان (52). منطق نقي من غير قاعدة بيانات.
// الحد فاضي (أو صفر/سالب في بيانات قديمة) = مفيش حد. التعرّض = (المتبقي على العميل - دفعاته المقدمة، ما ينزلش عن صفر) + قيمة الأمر الجديد.
export const CREDIT_POLICIES = ["off", "warn", "block"] as const;
export type CreditPolicy = (typeof CREDIT_POLICIES)[number];
export const DEFAULT_CREDIT_POLICY: CreditPolicy = "warn";
export const CREDIT_OVERRIDE_ACTION = "sales.credit_override";

export const isCreditPolicy = (v: unknown): v is CreditPolicy => typeof v === "string" && (CREDIT_POLICIES as readonly string[]).includes(v);
/** سياسة تالفة أو غير موجودة بترجع للافتراضي (تحذير). */
export const creditPolicyOf = (v: unknown): CreditPolicy => (isCreditPolicy(v) ? v : DEFAULT_CREDIT_POLICY);

export type LimitParse = { ok: true; cents: bigint | null } | { ok: false; error: string };
/** حد جديد: فاضي/null = شيل الحد. غير كده لازم رقم موجب بحد أقصى خانتين عشريتين و12 خانة. */
export function parseCreditLimit(raw: unknown): LimitParse {
  if (raw === null || raw === undefined) return { ok: true, cents: null };
  const s = String(raw).trim();
  if (s === "") return { ok: true, cents: null };
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return { ok: false, error: "الحد لازم يكون رقم موجب بحد أقصى خانتين عشريتين" };
  const [i, f = ""] = s.split(".");
  const cents = BigInt(i!) * 100n + BigInt(f.padEnd(2, "0"));
  if (cents <= 0n) return { ok: false, error: "الحد لازم يكون أكبر من صفر. لو مش عايز حد امسح الخانة" };
  return { ok: true, cents };
}

/** قيمة الحد المخزّنة (numeric كنص) → سنت، أو null لو مفيش حد فعّال. */
export function storedLimitCents(v: string | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v.trim());
  if (!m) return null;
  const cents = BigInt(m[1]!) * 100n + BigInt(((m[2] ?? "") + "00").slice(0, 2));
  return cents > 0n ? cents : null;
}

export type CreditAction = "allow" | "warn" | "approval";
export interface CreditInput { policy: CreditPolicy; limitCents: bigint | null; outstandingCents: bigint; advanceCents: bigint; orderCents: bigint }
export interface CreditVerdict {
  status: "none" | "ok" | "over";
  action: CreditAction;
  limitCents: bigint | null;
  exposureCents: bigint;
  overByCents: bigint;
  availableCents: bigint | null;
}

/** المديونية الصافية قبل الأمر الجديد: المتبقي ناقص الدفعات المقدمة (ما ينزلش عن صفر). */
export const netDebtCents = (outstandingCents: bigint, advanceCents: bigint): bigint => {
  const net = outstandingCents - (advanceCents > 0n ? advanceCents : 0n);
  return net > 0n ? net : 0n;
};

export function evaluateCredit(i: CreditInput): CreditVerdict {
  const order = i.orderCents > 0n ? i.orderCents : 0n;
  const exposure = netDebtCents(i.outstandingCents, i.advanceCents) + order;
  if (i.limitCents === null || i.limitCents <= 0n) return { status: "none", action: "allow", limitCents: null, exposureCents: exposure, overByCents: 0n, availableCents: null };
  const over = exposure > i.limitCents;
  const available = i.limitCents - exposure;
  const action: CreditAction = !over || i.policy === "off" ? "allow" : i.policy === "block" ? "approval" : "warn";
  return { status: over ? "over" : "ok", action, limitCents: i.limitCents, exposureCents: exposure, overByCents: over ? exposure - i.limitCents : 0n, availableCents: available > 0n ? available : 0n };
}

/** هل انتقال الحالة ده بيحوّل الأمر لمديونية جديدة على العميل؟ (من غير مديونية ← مؤكد/مشحون) */
const RECEIVABLE = new Set(["confirmed", "shipped"]);
export const becomesReceivable = (from: string, to: string): boolean => RECEIVABLE.has(to) && !RECEIVABLE.has(from);
/** هل الأمر ده بيتحسب مديونية أصلًا؟ */
export const isReceivableStatus = (s: string): boolean => RECEIVABLE.has(s);

export interface CreditOverviewRow { contactId: number; contactName: string; limitCents: bigint | null; debtCents: bigint; availableCents: bigint | null; over: boolean; overByCents: bigint }
/**
 * كل عميل عليه حد أو مديونية: المديونية الصافية (المتبقي الموجب ناقص الدفعات المقدمة) مقابل الحد.
 * المتجاوزين الأول (الأكتر تجاوزًا)، وبعدهم الباقي بالاسم.
 */
export function buildCreditOverview(a: {
  invoices: ReadonlyArray<{ contactId: number; contactName: string; outstandingCents: bigint }>;
  advances: ReadonlyMap<number, bigint>;
  limits: ReadonlyMap<number, { name: string; limitCents: bigint | null }>;
}): CreditOverviewRow[] {
  const debt = new Map<number, { name: string; cents: bigint }>();
  for (const i of a.invoices) {
    if (i.outstandingCents <= 0n) continue;
    const cur = debt.get(i.contactId) ?? { name: i.contactName, cents: 0n };
    cur.cents += i.outstandingCents;
    debt.set(i.contactId, cur);
  }
  const ids = new Set<number>([...debt.keys(), ...[...a.limits].filter(([, v]) => v.limitCents !== null).map(([id]) => id)]);
  const rows: CreditOverviewRow[] = [];
  for (const id of ids) {
    const d = debt.get(id);
    const lim = a.limits.get(id);
    const limitCents = lim?.limitCents ?? null;
    const net = netDebtCents(d?.cents ?? 0n, a.advances.get(id) ?? 0n);
    const over = limitCents !== null && net > limitCents;
    rows.push({ contactId: id, contactName: lim?.name ?? d?.name ?? "", limitCents, debtCents: net, availableCents: limitCents === null ? null : over ? 0n : limitCents - net, over, overByCents: over ? net - (limitCents as bigint) : 0n });
  }
  return rows.sort((x, y) => (x.over !== y.over ? (x.over ? -1 : 1) : x.over && x.overByCents !== y.overByCents ? (x.overByCents > y.overByCents ? -1 : 1) : x.contactName.localeCompare(y.contactName, "ar")));
}
