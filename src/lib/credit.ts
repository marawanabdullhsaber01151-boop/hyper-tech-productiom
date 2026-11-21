/** @format */
// حدود الائتمان (52): التعرّض الحالي للعميل وتقييم أمر بيع جديد. الكتابة (طلب الاعتماد والتدقيق) بتحصل في مسار المبيعات جوه نفس المعاملة.
// قفل العميل (4803، العميل) بيتاخد قبل حساب التعرّض عشان أمرين متزامنين لنفس العميل ما يعدّوش الحد سوا.
// ترتيب الأقفال: مفيش حاجة تانية في النظام بتاخد 4803، فالقفل ده ما بيعملش دورة مع أقفال التحصيلات (4802) أو التدقيق أو الدفتر.
import { sql } from "drizzle-orm";
import { loadSettingValues } from "./settingsStore";
import { creditPolicySetting } from "../domain/settings-registry";
import { openInvoicesFor } from "./payments";
import { outstandingCents } from "./paymentsCore";
import { toCents } from "./money";
import { openInvoicesAll, advancesByContact } from "./receivables";
import { becomesReceivable, buildCreditOverview, creditPolicyOf, evaluateCredit, storedLimitCents, type CreditPolicy, type CreditVerdict } from "./creditCore";
import { signedDecimal } from "./receivablesCore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = any;
export const CREDIT_LOCK = 4803;

const signed = (v: string): bigint => (v.startsWith("-") ? -toCents(v.slice(1)) : toCents(v));

export async function lockCustomerCredit(tx: Exec, contactId: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${CREDIT_LOCK}, ${contactId})`);
}

export async function contactCreditLimit(exec: Exec, contactId: number): Promise<bigint | null> {
  const res = (await exec.execute(sql`select credit_limit::text as l from contacts where id = ${contactId}`)) as { rows: Array<{ l: string | null }> };
  return storedLimitCents(res.rows[0]?.l ?? null);
}

/** المتبقي على العميل (فواتير مؤكدة/مشحونة بعد التحصيلات، من غير الأمر المستثنى، والمتبقي الموجب بس) ودفعاته المقدمة. */
export async function customerExposure(exec: Exec, contactId: number, excludeOrderId: number | null = null): Promise<{ outstandingCents: bigint; advanceCents: bigint }> {
  const invoices = await openInvoicesFor(exec, contactId);
  let outstanding = 0n;
  for (const inv of invoices) {
    if (excludeOrderId !== null && inv.orderId === excludeOrderId) continue;
    const o = outstandingCents(inv);
    if (o > 0n) outstanding += o;
  }
  const adv = (await exec.execute(sql`
    select coalesce(sum(p.amount - coalesce((select sum(a.amount) from payment_allocations a where a.payment_id = p.id), 0)), 0)::text as s
    from customer_payments p where p.contact_id = ${contactId} and p.status = 'posted'`)) as { rows: Array<{ s: string }> };
  return { outstandingCents: outstanding, advanceCents: signed(adv.rows[0]?.s ?? "0") };
}

export async function loadCreditPolicy(exec: Exec): Promise<CreditPolicy> {
  try {
    const values = await loadSettingValues(exec);
    return creditPolicyOf(creditPolicySetting({ "credit.policy": values["credit.policy"] ?? "" }));
  } catch {
    return "warn";
  }
}

export interface OrderCreditCheck { policy: CreditPolicy; verdict: CreditVerdict }

/**
 * بيقيّم أمر بيع لحظة ما بيبقى مديونية (من غير مديونية ← مؤكد/مشحون). null = الفحص مش منطبق (انتقال تاني، أو أمر من غير عميل).
 * لازم يتنادى جوه معاملة المسار، وبياخد قفل العميل.
 */
export async function assessOrderCredit(tx: Exec, a: { contactId: number | null; orderId: number; totalCents: bigint; fromStatus: string; toStatus: string }): Promise<OrderCreditCheck | null> {
  if (a.contactId === null || !becomesReceivable(a.fromStatus, a.toStatus)) return null;
  const policy = await loadCreditPolicy(tx);
  if (policy === "off") return null;
  const limit = await contactCreditLimit(tx, a.contactId);
  if (limit === null) return null;
  await lockCustomerCredit(tx, a.contactId);
  const exp = await customerExposure(tx, a.contactId, a.orderId);
  return { policy, verdict: evaluateCredit({ policy, limitCents: limit, outstandingCents: exp.outstandingCents, advanceCents: exp.advanceCents, orderCents: a.totalCents }) };
}

/** شكل الرد/التدقيق: أرقام بنص عشري. */
export function verdictJson(v: CreditVerdict) {
  return {
    status: v.status,
    limit: v.limitCents === null ? null : signedDecimal(v.limitCents),
    exposure: signedDecimal(v.exposureCents),
    overBy: signedDecimal(v.overByCents),
    available: v.availableCents === null ? null : signedDecimal(v.availableCents),
  };
}

/** أرصدة الائتمان لكل العملاء اللي عليهم حد أو مديونية (للشاشة). */
export async function creditOverviewData(exec: Exec) {
  const [invoices, advances, limits] = await Promise.all([
    openInvoicesAll(exec),
    advancesByContact(exec),
    exec.execute(sql`select id, name, credit_limit::text as l from contacts where credit_limit is not null and type in ('customer','both')`) as Promise<{ rows: Array<{ id: number; name: string; l: string }> }>,
  ]);
  return buildCreditOverview({
    invoices,
    advances,
    limits: new Map(limits.rows.map((r) => [Number(r.id), { name: r.name, limitCents: storedLimitCents(r.l) }])),
  });
}
