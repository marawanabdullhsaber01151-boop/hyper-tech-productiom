/** @format */
// الفاتورة الإلكترونية الداخلية (56): الإصدار والقراءة والتحقق. كل الكتابة جوه معاملة المتصل (الرقم والفاتورة والتدقيق مع بعض).
// الفاتورة لقطة من أمر البيع وقت الإصدار؛ بعدها الأمر بيتقفل في القاعدة (هجرة 0109) فالفاتورة والأمر مبيفترقوش.
import { sql } from "drizzle-orm";
import { writeAuditEvent } from "./governance";
import { nextPhase0Number } from "./phase0";
import { taxConfig } from "../domain/settings-registry";
import { todayCairo } from "./operationsCapacityCore";
import {
  SEAL_VERSION, canInvoice, findGaps, keyIdOf, sealKeyProblem, sealOf, tokenOf, verifyVerdict, vatInclusive,
  type InvoiceData, type InvoiceLine, type VerifyState,
} from "./invoiceSealCore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = any;

export class InvoiceError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface InvoiceActor { userId: number; username: string; ip?: string | null; userAgent?: string | null }

export interface InvoiceRow extends InvoiceData {
  id: number;
  orderId: number;
  contactId: number | null;
  seal: string;
  sealKeyId: string;
  issuedByName: string;
  issuedAt: string;
}

const SELECT = sql`
  select i.id, i.invoice_number as "invoiceNumber", i.order_id as "orderId", i.order_number as "orderNumber", i.contact_id as "contactId",
         i.customer_name as "customerName", i.issue_date::text as "issueDate", i.subtotal::text as subtotal, i.tax_rate::text as "taxRate",
         i.tax_amount::text as "taxAmount", i.total::text as total, i.lines, i.seal, i.seal_key_id as "sealKeyId",
         i.issued_by_name as "issuedByName", i.issued_at::text as "issuedAt"
  from sales_invoices i`;

/** المفتاح من البيئة. بيرمي 503 برسالة واضحة لو مش متضبط أو ضعيف (الإصدار ممنوع من غيره). */
export function requireSealKey(env: Record<string, string | undefined> = process.env): string {
  const key = env.INVOICE_SEAL_KEY;
  const problem = sealKeyProblem(key);
  if (problem === "missing") throw new InvoiceError(503, "SEAL_KEY_MISSING", "مفتاح ختم الفاتورة مش متضبط على السيرفر (INVOICE_SEAL_KEY)، فمينفعش نصدر فواتير دلوقتي");
  if (problem === "short") throw new InvoiceError(503, "SEAL_KEY_WEAK", "مفتاح ختم الفاتورة قصير (لازم 32 حرف على الأقل)");
  return key!.trim();
}

/** المفتاح لو صالح، وإلا null (للقراءة والتحقق من غير ما نرمي). */
export function optionalSealKey(env: Record<string, string | undefined> = process.env): string | null {
  return sealKeyProblem(env.INVOICE_SEAL_KEY) ? null : env.INVOICE_SEAL_KEY!.trim();
}

const asLines = (v: unknown): InvoiceLine[] => (Array.isArray(v) ? (v as InvoiceLine[]) : []);
const rowOf = (r: Record<string, unknown>): InvoiceRow => ({ ...(r as unknown as InvoiceRow), lines: asLines(r.lines) });

export async function issueInvoice(tx: Exec, orderId: number, actor: InvoiceActor, key: string): Promise<InvoiceRow> {
  const orderRes = (await tx.execute(sql`
    select o.id, o.order_number as "orderNumber", o.status, o.contact_id as "contactId", o.subtotal::text as subtotal, o.total::text as total,
           c.name as "customerName"
    from sales_orders o left join contacts c on c.id = o.contact_id where o.id = ${orderId} for update of o`)) as { rows: Array<Record<string, string | number | null>> };
  const order = orderRes.rows[0];
  if (!order) throw new InvoiceError(404, "ORDER_NOT_FOUND", "أمر البيع غير موجود");
  if (!canInvoice(String(order.status))) throw new InvoiceError(409, "NOT_INVOICEABLE", "الفاتورة بتتصدر للأمر المعتمد أو المشحون أو المسدد بس");
  if (!order.contactId || !order.customerName) throw new InvoiceError(422, "NO_CUSTOMER", "الأمر من غير عميل، حدد العميل الأول");
  const existing = (await tx.execute(sql`select invoice_number as n from sales_invoices where order_id = ${orderId}`)) as { rows: Array<{ n: string }> };
  if (existing.rows[0]) throw new InvoiceError(409, "ALREADY_INVOICED", `الأمر ده ليه فاتورة بالفعل: ${existing.rows[0].n}`);

  const items = (await tx.execute(sql`
    select description, qty::text as qty, unit_price::text as "unitPrice", total::text as total
    from sales_order_items where order_id = ${orderId} order by id`)) as { rows: InvoiceLine[] };
  if (!items.rows.length) throw new InvoiceError(422, "NO_ITEMS", "الأمر من غير أصناف");

  const issueDate = todayCairo(new Date());
  const period = (await tx.execute(sql`select status from gl_periods where starts_on <= ${issueDate}::date and ends_on >= ${issueDate}::date limit 1`)) as { rows: Array<{ status: string }> };
  if (period.rows[0] && period.rows[0].status !== "open") throw new InvoiceError(422, "PERIOD_CLOSED", "الفترة المحاسبية دي مقفولة ومينفعش تصدر فيها فاتورة");

  const settings = (await tx.execute(sql`select key, value from system_settings where key in ('tax.vat_enabled', 'tax.vat_rate')`)) as { rows: Array<{ key: string; value: string }> };
  const tax = taxConfig(Object.fromEntries(settings.rows.map((r) => [r.key, r.value])));
  const vat = tax.enabled ? vatInclusive(String(order.total), tax.ratePercent) : { taxRate: "0.00", taxAmount: "0.00" };

  const invoiceNumber = await nextPhase0Number(tx, "sales_invoice");
  const data: InvoiceData = {
    invoiceNumber, orderNumber: String(order.orderNumber), issueDate, customerName: String(order.customerName),
    subtotal: String(order.subtotal), taxRate: vat.taxRate, taxAmount: vat.taxAmount, total: String(order.total), lines: items.rows,
  };
  const seal = sealOf(data, key);
  const ins = (await tx.execute(sql`
    insert into sales_invoices (invoice_number, order_id, order_number, contact_id, customer_name, issue_date, subtotal, tax_rate, tax_amount, total, lines, seal, seal_key_id, seal_version, issued_by, issued_by_name)
    values (${invoiceNumber}, ${orderId}, ${data.orderNumber}, ${order.contactId}, ${data.customerName}, ${issueDate}::date, ${data.subtotal}::numeric, ${data.taxRate}::numeric, ${data.taxAmount}::numeric, ${data.total}::numeric,
            ${JSON.stringify(data.lines)}::jsonb, ${seal}, ${keyIdOf(key)}, ${SEAL_VERSION}, ${actor.userId}, ${actor.username})
    returning id`)) as { rows: Array<{ id: number }> };
  const id = ins.rows[0]!.id;
  await writeAuditEvent({
    executor: tx, actorUserId: actor.userId, actorName: actor.username, actionKey: "invoices.issued", resourceType: "sales_invoice", resourceId: id,
    afterData: { invoiceNumber, orderNumber: data.orderNumber, total: data.total, taxAmount: data.taxAmount, sealKeyId: keyIdOf(key) },
    ipAddress: actor.ip ?? null, userAgent: actor.userAgent ?? null,
  });
  const out = await getInvoice(tx, id);
  return out!;
}

export async function getInvoice(exec: Exec, id: number): Promise<InvoiceRow | null> {
  const res = (await exec.execute(sql`${SELECT} where i.id = ${id}`)) as { rows: Array<Record<string, unknown>> };
  return res.rows[0] ? rowOf(res.rows[0]) : null;
}

export async function invoiceByOrder(exec: Exec, orderId: number): Promise<InvoiceRow | null> {
  const res = (await exec.execute(sql`${SELECT} where i.order_id = ${orderId}`)) as { rows: Array<Record<string, unknown>> };
  return res.rows[0] ? rowOf(res.rows[0]) : null;
}

export async function listInvoices(exec: Exec, opts: { q?: string; limit: number }): Promise<Array<Omit<InvoiceRow, "lines" | "seal">>> {
  const like = opts.q ? `%${opts.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const res = (await exec.execute(sql`${SELECT}
    where (${like}::text is null or i.invoice_number ilike ${like} or i.order_number ilike ${like} or i.customer_name ilike ${like})
    order by i.id desc limit ${opts.limit}`)) as { rows: Array<Record<string, unknown>> };
  return res.rows.map((r) => {
    const { lines: _l, seal: _s, ...rest } = rowOf(r);
    return rest;
  });
}

/** التحقق العام: من الرقم والتوكن اللي في الـQR. بيرجّع حكم + بيانات محدودة (من غير اسم العميل ولا الأصناف). */
export async function verifyPublic(exec: Exec, invoiceNumber: string, token: string, key: string | null): Promise<{ state: VerifyState; invoice?: { invoiceNumber: string; issueDate: string; total: string; taxAmount: string } }> {
  const res = (await exec.execute(sql`${SELECT} where i.invoice_number = ${invoiceNumber}`)) as { rows: Array<Record<string, unknown>> };
  const row = res.rows[0] ? rowOf(res.rows[0]) : null;
  const recomputed = row && key ? sealOf(row, key) : null;
  const state = verifyVerdict({ found: !!row, storedSeal: row?.seal, token, recomputed });
  return state === "valid" && row
    ? { state, invoice: { invoiceNumber: row.invoiceNumber, issueDate: row.issueDate, total: row.total, taxAmount: row.taxAmount } }
    : { state };
}

export interface IntegrityReport {
  keyConfigured: boolean;
  keyId: string | null;
  total: number;
  gaps: { missing: string[]; duplicates: string[]; malformed: string[] };
  badSeals: string[];
  otherKey: string[];
  ok: boolean;
}

/** فحص السلامة: فجوات الترقيم + إعادة حساب كل ختم (ختم متغيّر = بيانات اتغيّرت، وبصمة مفتاح مختلفة = اتختمت بمفتاح تاني). */
export async function integrityReport(exec: Exec, key: string | null): Promise<IntegrityReport> {
  const res = (await exec.execute(sql`${SELECT} order by i.id`)) as { rows: Array<Record<string, unknown>> };
  const rows = res.rows.map(rowOf);
  const gaps = findGaps(rows.map((r) => r.invoiceNumber));
  const badSeals: string[] = [];
  const otherKey: string[] = [];
  if (key) {
    const kid = keyIdOf(key);
    for (const r of rows) {
      if (r.sealKeyId !== kid) otherKey.push(r.invoiceNumber);
      else if (sealOf(r, key) !== r.seal) badSeals.push(r.invoiceNumber);
    }
  }
  const ok = !!key && !gaps.missing.length && !gaps.duplicates.length && !gaps.malformed.length && !badSeals.length && !otherKey.length;
  return { keyConfigured: !!key, keyId: key ? keyIdOf(key) : null, total: rows.length, gaps, badSeals, otherKey, ok };
}

export { tokenOf };
