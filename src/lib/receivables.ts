/** @format */
// استعلامات كشف الحساب وأعمار الديون (51). قراءة بس. نفس تعريف «الفاتورة المفتوحة» بتاع التحصيلات (50).
import { sql } from "drizzle-orm";
import { toCents } from "./money";
import { buildAging, buildStatement, type AgingInvoice, type Movement } from "./receivablesCore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = any;
const signed = (v: string): bigint => (v.startsWith("-") ? -toCents(v.slice(1)) : toCents(v));

/** كل الفواتير المفتوحة (مؤكد/مشحون) لكل العملاء، والمتبقي بعد التحصيلات السارية. */
export async function openInvoicesAll(exec: Exec): Promise<AgingInvoice[]> {
  const res = (await exec.execute(sql`
    select o.id as id, o.contact_id as "contactId", c.name as "contactName", o.order_number as number, o.date::text as date, o.total::text as total,
           coalesce(sum(a.amount) filter (where p.status = 'posted'), 0)::text as paid
    from sales_orders o
    join contacts c on c.id = o.contact_id
    left join payment_allocations a on a.sales_order_id = o.id
    left join customer_payments p on p.id = a.payment_id
    where o.status in ('confirmed','shipped')
    group by o.id, c.name
    order by o.date, o.id`)) as { rows: Array<{ id: number; contactId: number; contactName: string; number: string; date: string; total: string; paid: string }> };
  return res.rows.map((r) => ({ contactId: Number(r.contactId), contactName: r.contactName, orderId: Number(r.id), orderNumber: r.number, date: String(r.date).slice(0, 10), outstandingCents: signed(r.total) - signed(r.paid) }));
}

/** الدفعات المقدمة (تحصيل ساري - المخصّص منه) لكل عميل. */
export async function advancesByContact(exec: Exec): Promise<Map<number, bigint>> {
  const res = (await exec.execute(sql`
    select p.contact_id as "contactId",
           sum(p.amount - coalesce((select sum(a.amount) from payment_allocations a where a.payment_id = p.id), 0))::text as s
    from customer_payments p where p.status = 'posted' group by p.contact_id`)) as { rows: Array<{ contactId: number; s: string }> };
  return new Map(res.rows.map((r) => [Number(r.contactId), signed(r.s)]));
}

export async function agingReport(exec: Exec, asOf: string) {
  const [invoices, advances] = await Promise.all([openInvoicesAll(exec), advancesByContact(exec)]);
  // الفاتورة بتاريخ بعد «اعتبارًا من» مش داخلة في الأعمار (مش مديونية في اليوم ده).
  const aging = buildAging(invoices.filter((i) => i.date <= asOf), asOf);
  let advanceTotal = 0n;
  for (const r of aging.rows) advanceTotal += advances.get(r.contactId) ?? 0n;
  return { ...aging, advances, advanceTotal };
}

/** حركات العميل: فواتيره (مؤكد/مشحون، أو مدفوع بتحصيل فعلي) وتحصيلاته السارية. */
export async function customerMovements(exec: Exec, contactId: number): Promise<Movement[]> {
  const inv = (await exec.execute(sql`
    select o.id, o.order_number as number, o.date::text as date, o.total::text as total
    from sales_orders o
    where o.contact_id = ${contactId}
      and (o.status in ('confirmed','shipped')
           or (o.status = 'paid' and exists (select 1 from payment_allocations a join customer_payments p on p.id = a.payment_id where a.sales_order_id = o.id and p.status = 'posted')))`)) as { rows: Array<{ id: number; number: string; date: string; total: string }> };
  const pay = (await exec.execute(sql`
    select p.id, p.payment_number as number, p.payment_date::text as date, p.amount::text as amount, p.method, p.reference
    from customer_payments p where p.contact_id = ${contactId} and p.status = 'posted'`)) as { rows: Array<{ id: number; number: string; date: string; amount: string; method: string; reference: string | null }> };
  return [
    ...inv.rows.map((r): Movement => ({ kind: "invoice", id: Number(r.id), date: String(r.date).slice(0, 10), number: r.number, cents: signed(r.total), note: null })),
    ...pay.rows.map((r): Movement => ({ kind: "payment", id: Number(r.id), date: String(r.date).slice(0, 10), number: r.number, cents: signed(r.amount), note: r.reference ?? r.method })),
  ];
}

export async function customerStatement(exec: Exec, contactId: number, from: string | null, to: string | null) {
  return buildStatement(await customerMovements(exec, contactId), from, to);
}
