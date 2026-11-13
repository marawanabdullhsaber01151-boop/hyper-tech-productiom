/** @format */
// ترحيل القيود (48): الدالة الوحيدة اللي بتكتب في دفتر الأستاذ. بتتنادى جوه معاملة المتصل (القيود التلقائية في 49).
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { glAccountsTable, glJournalEntriesTable, glJournalLinesTable, glPeriodsTable } from "../db/schema";
import { ISSUE_TEXT, checkEntry, nextEntryNumber, periodOf, type AccountLite, type EntryInput, type EntryIssue } from "./ledgerCore";
import { centsToString } from "./money";

/** executor = tx أو db. ما بنسمّيش النوع عشان drizzle بيغيّره بين المعاملة والاتصال. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = any;

export class LedgerError extends Error {
  status = 422;
  code: string;
  issues: EntryIssue[];
  constructor(code: string, message: string, issues: EntryIssue[] = []) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}

export interface PostInput extends EntryInput {
  sourceType?: string;
  sourceId?: string | null;
  reversalOf?: number | null;
  createdBy: number | null;
  createdByName: string | null;
}

const LEDGER_LOCK = 4801;

/** بيرجّع الفترة (وبيعملها لو لسه ما اتعملتش). */
export async function ensurePeriod(tx: Exec, entryDate: string) {
  const p = periodOf(entryDate);
  await tx.insert(glPeriodsTable).values({ year: p.year, month: p.month, startsOn: p.startsOn, endsOn: p.endsOn }).onConflictDoNothing();
  const [row] = await tx.select().from(glPeriodsTable).where(and(eq(glPeriodsTable.year, p.year), eq(glPeriodsTable.month, p.month))).limit(1);
  return row as typeof glPeriodsTable.$inferSelect;
}

/** يرحّل قيد واحد. بيرمي LedgerError بكل المشاكل لو القيد غلط، والقاعدة نفسها بتمنع غير المتوازن والفترة المقفولة كخط دفاع تاني. */
export async function postJournalEntry(tx: Exec, input: PostInput): Promise<{ id: number; entryNumber: string; total: string }> {
  await tx.execute(sql`select pg_advisory_xact_lock(${LEDGER_LOCK})`);
  const ids = [...new Set(input.lines.map((l) => l.accountId))];
  const rows = ids.length ? await tx.select().from(glAccountsTable).where(inArray(glAccountsTable.id, ids)) : [];
  const accounts = new Map<number, AccountLite>(
    (rows as Array<typeof glAccountsTable.$inferSelect>).map((a) => [a.id, { id: a.id, code: a.code, name: a.name, type: a.type as AccountLite["type"], normalSide: a.normalSide as AccountLite["normalSide"], isPostable: a.isPostable, isActive: a.isActive }]),
  );
  const check = checkEntry(input, accounts);
  if (check.issues.length > 0) throw new LedgerError("LEDGER_INVALID", check.issues.map((i) => ISSUE_TEXT[i]).join(" | "), check.issues);

  const period = await ensurePeriod(tx, input.entryDate);
  if (period.status !== "open") throw new LedgerError("PERIOD_CLOSED", "الفترة دي مقفولة ومينفعش يتسجّل عليها قيد");

  const prefix = nextEntryNumber(input.entryDate, null).slice(0, 7);
  const [last] = await tx.select({ n: glJournalEntriesTable.entryNumber }).from(glJournalEntriesTable).where(like(glJournalEntriesTable.entryNumber, `${prefix}-%`)).orderBy(desc(glJournalEntriesTable.entryNumber)).limit(1);
  const entryNumber = nextEntryNumber(input.entryDate, (last as { n: string } | undefined)?.n ?? null);

  const total = check.total;
  const [entry] = await tx
    .insert(glJournalEntriesTable)
    .values({
      entryNumber,
      entryDate: input.entryDate,
      periodId: period.id,
      description: input.description.trim().slice(0, 500),
      sourceType: input.sourceType ?? "manual",
      sourceId: input.sourceId ?? null,
      reversalOf: input.reversalOf ?? null,
      total,
      createdBy: input.createdBy,
      createdByName: input.createdByName,
    })
    .returning({ id: glJournalEntriesTable.id });
  await tx.insert(glJournalLinesTable).values(
    check.lines.map((l, i) => ({ entryId: entry.id, lineNo: i + 1, accountId: l.accountId, debit: centsToString(l.debitCents), credit: centsToString(l.creditCents), memo: l.memo })),
  );
  return { id: entry.id, entryNumber, total };
}
