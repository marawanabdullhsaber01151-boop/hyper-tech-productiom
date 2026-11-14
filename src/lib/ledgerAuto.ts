/** @format */
// الترحيل التلقائي (49أ). كل الدوال بتتنادى جوه معاملة المتصل نفسها، فالقيد والعملية يتسجّلوا مع بعض أو يتلغوا مع بعض.
// لو الترحيل مقفول (مفيش تاريخ تشغيل) كل الدوال بترجع من غير أي أثر، فالمبيعات والمشتريات بتفضل زي ما هي.
import { eq, inArray, sql } from "drizzle-orm";
import { inventoryItemsTable, salesOrdersTable, systemSettingsTable } from "../db";
import { glAccountsTable } from "../db/schema";
import { LedgerError, postJournalEntry } from "./ledger";
import type { EntryLineInput } from "./ledgerCore";
import {
  AUTO_ACCOUNT_CODES, AUTO_SETTING_KEY, SOURCE_PURCHASE_RECEIPT, SOURCE_SALES_INVOICE,
  isIsoDay, isTracked, revenueDelta, salesEntryLines, salesTargetCents, valueReceipt, centsDecimal,
} from "./ledgerAutoCore";
import { lineTotalCents } from "./money";
import { todayCairo } from "./operationsCapacityCore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = any;
export interface AutoActor { userId: number | null; username: string | null }
const LEDGER_LOCK = 4801;

/** تاريخ بداية الترحيل التلقائي (YYYY-MM-DD) أو null لو مقفول. */
export async function getAutoPostingStart(exec: Exec): Promise<string | null> {
  const [row] = await exec.select({ value: systemSettingsTable.value }).from(systemSettingsTable).where(eq(systemSettingsTable.key, AUTO_SETTING_KEY)).limit(1);
  const v = (row as { value: string } | undefined)?.value?.trim();
  return v && isIsoDay(v) ? v : null;
}

async function accountIdsByCode(exec: Exec, codes: string[]): Promise<Map<string, number>> {
  const rows = (await exec.select({ id: glAccountsTable.id, code: glAccountsTable.code }).from(glAccountsTable).where(inArray(glAccountsTable.code, codes))) as Array<{ id: number; code: string }>;
  const map = new Map(rows.map((r) => [r.code, r.id]));
  for (const c of codes) if (!map.has(c)) throw new LedgerError("AUTO_ACCOUNT_MISSING", `حساب ${c} مش موجود في دليل الحسابات، والترحيل التلقائي محتاجه`);
  return map;
}

/** صافي الإيراد المسجّل لأمر بيع (بالقروش) وعدد قيوده التلقائية. */
async function postedRevenue(exec: Exec, orderId: number, salesAccountId: number): Promise<{ cents: bigint; entries: number }> {
  const res = (await exec.execute(sql`
    select coalesce(sum((l.credit - l.debit) * 100), 0)::numeric(20,0)::text as cents, count(distinct e.id)::int as entries
    from gl_journal_lines l join gl_journal_entries e on e.id = l.entry_id
    where e.source_type = ${SOURCE_SALES_INVOICE} and e.source_id like ${`${orderId}:%`} and l.account_id = ${salesAccountId}`)) as { rows: Array<{ cents: string; entries: number }> };
  const r = res.rows[0] ?? { cents: "0", entries: 0 };
  return { cents: BigInt(r.cents), entries: Number(r.entries) };
}

/**
 * بيقرّب المسجّل في الدفتر من حالة أمر البيع الحالية وإجماليه (ترحيل الفرق بس). بيتنادى بعد أي تغيير على الأمر.
 * forceStatus: للحذف (الأمر لسه موجود بس هيتشال، فبنعامله كملغي).
 */
export async function syncSalesOrderLedger(tx: Exec, orderId: number, actor: AutoActor, opts: { forceStatus?: string } = {}): Promise<{ posted: boolean }> {
  const start = await getAutoPostingStart(tx);
  if (!start) return { posted: false };
  await tx.execute(sql`select pg_advisory_xact_lock(${LEDGER_LOCK})`);
  const [order] = await tx.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, orderId)).limit(1);
  if (!order) return { posted: false };
  const ids = await accountIdsByCode(tx, [AUTO_ACCOUNT_CODES.receivable, AUTO_ACCOUNT_CODES.sales]);
  const salesId = ids.get(AUTO_ACCOUNT_CODES.sales)!;
  const current = await postedRevenue(tx, orderId, salesId);
  if (!isTracked(order.date, start, current.entries > 0)) return { posted: false };
  const target = salesTargetCents(opts.forceStatus ?? order.status, order.total);
  const delta = revenueDelta(target, current.cents);
  if (!delta) return { posted: false };
  const memo = order.orderNumber;
  await postJournalEntry(tx, {
    entryDate: todayCairo(new Date()),
    description: delta.kind === "invoice" ? `فاتورة بيع ${memo}` : `تخفيض/إلغاء فاتورة بيع ${memo}`,
    lines: salesEntryLines(delta, ids.get(AUTO_ACCOUNT_CODES.receivable)!, salesId, memo),
    sourceType: SOURCE_SALES_INVOICE,
    sourceId: `${orderId}:${current.entries + 1}`,
    createdBy: actor.userId,
    createdByName: actor.username,
  });
  return { posted: true };
}

export interface PurchaseReceiptInput {
  receiptId: number;
  receiptNumber: string;
  poNumber: string;
  lines: Array<{ inventoryItemId: number; qty: string; unitPrice: string }>;
}

/** قيد استلام مشتريات بعد الفحص: مدين المخزون (حسب نوع الصنف) دائن الموردين، بقيمة المقبول فقط. */
export async function postPurchaseReceiptEntry(tx: Exec, input: PurchaseReceiptInput, actor: AutoActor): Promise<{ posted: boolean }> {
  const start = await getAutoPostingStart(tx);
  const today = todayCairo(new Date());
  if (!start || today < start) return { posted: false };
  const itemIds = [...new Set(input.lines.map((l) => l.inventoryItemId))];
  if (!itemIds.length) return { posted: false };
  const items = (await tx.select({ id: inventoryItemsTable.id, category: inventoryItemsTable.category }).from(inventoryItemsTable).where(inArray(inventoryItemsTable.id, itemIds))) as Array<{ id: number; category: string }>;
  const cat = new Map(items.map((i) => [i.id, i.category]));
  const valuation = valueReceipt(input.lines.map((l) => ({ category: cat.get(l.inventoryItemId) ?? null, qty: l.qty, unitPrice: l.unitPrice })), lineTotalCents);
  if (valuation.totalCents <= 0n) return { posted: false };
  const codes = [...valuation.byAccount.keys(), AUTO_ACCOUNT_CODES.suppliers];
  const ids = await accountIdsByCode(tx, codes);
  const memo = `${input.poNumber} / ${input.receiptNumber}`;
  const lines: EntryLineInput[] = [...valuation.byAccount.entries()].map(([code, cents]) => ({ accountId: ids.get(code)!, debit: centsDecimal(cents), memo }));
  lines.push({ accountId: ids.get(AUTO_ACCOUNT_CODES.suppliers)!, credit: centsDecimal(valuation.totalCents), memo });
  await postJournalEntry(tx, {
    entryDate: today,
    description: `استلام مشتريات ${memo}`,
    lines,
    sourceType: SOURCE_PURCHASE_RECEIPT,
    sourceId: String(input.receiptId),
    createdBy: actor.userId,
    createdByName: actor.username,
  });
  return { posted: true };
}
