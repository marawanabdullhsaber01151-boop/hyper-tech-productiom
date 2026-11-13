/** @format */
// دفتر الأستاذ مزدوج القيد (الخطوة 48): قواعد نقية من غير قاعدة بيانات.
// المبالغ بالقروش (BigInt) من money.ts، مفيش number للفلوس.
import { MoneyError, centsToString, toCents } from "./money";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type Side = "debit" | "credit";

export const TYPE_LABEL: Record<AccountType, string> = {
  asset: "أصول",
  liability: "التزامات",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصروفات وتكلفة",
};

/** الجانب الطبيعي للنوع. الحسابات المقابلة (مجمع الإهلاك، مردودات المبيعات) بتتخزن بجانبها الصريح. */
export const normalSideOf = (type: AccountType): Side => (type === "asset" || type === "expense" ? "debit" : "credit");

export interface AccountLite { id: number; code: string; name: string; type: AccountType; normalSide: Side; isPostable: boolean; isActive: boolean }

/* ---------------- السنة المالية والفترات ---------------- */

/** الفترات شهور ميلادي دايمًا. السنة المالية «تسمية» بس بتتحسب من إعداد شهر البداية، فتغييره عمره ما بيبوّظ قيد. */
export interface PeriodRef { year: number; month: number; startsOn: string; endsOn: string }

const pad = (n: number) => String(n).padStart(2, "0");
export const isIsoDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export function periodOf(isoDate: string): PeriodRef {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, startsOn: `${year}-${pad(month)}-01`, endsOn: `${year}-${pad(month)}-${pad(last)}` };
}

/** تسمية السنة المالية: «2026» لو بتبدأ يناير، وإلا «2025/2026» (بدأت 2025 وانتهت 2026). */
export function fiscalYearLabel(isoDate: string, startMonth: number): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  if (!Number.isInteger(startMonth) || startMonth < 2 || startMonth > 12) return String(y);
  const startYear = m >= startMonth ? y : y - 1;
  return `${startYear}/${startYear + 1}`;
}

/* ---------------- القيد ---------------- */

export interface EntryLineInput { accountId: number; debit?: string | number | null; credit?: string | number | null; memo?: string | null }
export interface EntryInput { entryDate: string; description: string; lines: readonly EntryLineInput[] }

export type EntryIssue =
  | "BAD_DATE" | "NO_DESCRIPTION" | "TOO_FEW_LINES" | "TOO_MANY_LINES"
  | "BAD_AMOUNT" | "LINE_ZERO" | "LINE_BOTH_SIDES"
  | "ACCOUNT_UNKNOWN" | "ACCOUNT_NOT_POSTABLE" | "ACCOUNT_INACTIVE" | "UNBALANCED";

export const ISSUE_TEXT: Record<EntryIssue, string> = {
  BAD_DATE: "تاريخ القيد غير صحيح",
  NO_DESCRIPTION: "اكتب بيان القيد",
  TOO_FEW_LINES: "القيد لازم يكون فيه سطرين على الأقل (مدين ودائن)",
  TOO_MANY_LINES: "القيد فيه سطور أكتر من اللازم (الحد 200)",
  BAD_AMOUNT: "في مبلغ غير صحيح (أرقام موجبة بحد أقصى خانتين عشريتين)",
  LINE_ZERO: "في سطر من غير مبلغ",
  LINE_BOTH_SIDES: "السطر الواحد إما مدين أو دائن مش الاتنين",
  ACCOUNT_UNKNOWN: "في حساب مش موجود في الدليل",
  ACCOUNT_NOT_POSTABLE: "في حساب رئيسي (للتجميع بس) ولا يتسجّل عليه قيد",
  ACCOUNT_INACTIVE: "في حساب موقوف",
  UNBALANCED: "القيد غير متوازن: مجموع المدين لازم يساوي مجموع الدائن",
};

export const MAX_LINES = 200;
const DECIMAL = /^\d{1,12}(?:\.\d{1,2})?$/;

function cents(v: string | number | null | undefined): bigint | "bad" {
  if (v === null || v === undefined || String(v).trim() === "") return 0n;
  const s = String(v).trim();
  if (!DECIMAL.test(s)) return "bad";
  try { return toCents(s); } catch (e) { if (e instanceof MoneyError) return "bad"; throw e; }
}

export interface CheckedLine { accountId: number; debitCents: bigint; creditCents: bigint; memo: string | null }
export interface EntryCheck { issues: EntryIssue[]; lines: CheckedLine[]; totalDebit: string; totalCredit: string; total: string }

/** كل المشاكل مرة واحدة (مش أول واحدة بس) عشان الشاشة تعرضها كلها. */
export function checkEntry(input: EntryInput, accounts: ReadonlyMap<number, AccountLite>): EntryCheck {
  const issues = new Set<EntryIssue>();
  if (!isIsoDate(input.entryDate)) issues.add("BAD_DATE");
  if (input.description.trim().length < 3) issues.add("NO_DESCRIPTION");
  if (input.lines.length < 2) issues.add("TOO_FEW_LINES");
  if (input.lines.length > MAX_LINES) issues.add("TOO_MANY_LINES");
  const lines: CheckedLine[] = [];
  let dr = 0n;
  let cr = 0n;
  for (const l of input.lines) {
    const d = cents(l.debit);
    const c = cents(l.credit);
    if (d === "bad" || c === "bad") { issues.add("BAD_AMOUNT"); continue; }
    if (d === 0n && c === 0n) issues.add("LINE_ZERO");
    if (d > 0n && c > 0n) issues.add("LINE_BOTH_SIDES");
    const a = accounts.get(l.accountId);
    if (!a) issues.add("ACCOUNT_UNKNOWN");
    else {
      if (!a.isPostable) issues.add("ACCOUNT_NOT_POSTABLE");
      if (!a.isActive) issues.add("ACCOUNT_INACTIVE");
    }
    dr += d;
    cr += c;
    lines.push({ accountId: l.accountId, debitCents: d, creditCents: c, memo: l.memo?.trim() ? l.memo.trim().slice(0, 300) : null });
  }
  if (dr !== cr) issues.add("UNBALANCED");
  return { issues: [...issues], lines, totalDebit: centsToString(dr), totalCredit: centsToString(cr), total: centsToString(dr) };
}

/** قيد عكسي: نفس السطور والجانبين متبدلين. */
export const reverseLines = <T extends { debit: string; credit: string }>(lines: readonly T[]): T[] => lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));

/** JV-YYMM-0001 على أساس تاريخ القيد، بيكمّل من آخر رقم في نفس الشهر. */
export function nextEntryNumber(entryDate: string, lastNumber: string | null): string {
  const prefix = `JV-${entryDate.slice(2, 4)}${entryDate.slice(5, 7)}`;
  const last = lastNumber && lastNumber.startsWith(`${prefix}-`) ? parseInt(lastNumber.split("-").pop() ?? "0", 10) || 0 : 0;
  return `${prefix}-${String(last + 1).padStart(4, "0")}`;
}

/* ---------------- دليل الحسابات ---------------- */

export type AccountIssue = "BAD_CODE" | "BAD_NAME" | "PARENT_TYPE" | "PARENT_POSTABLE";
export const ACCOUNT_ISSUE_TEXT: Record<AccountIssue, string> = {
  BAD_CODE: "كود الحساب أرقام فقط من 3 لـ 8 خانات",
  BAD_NAME: "اسم الحساب حرفين على الأقل",
  PARENT_TYPE: "نوع الحساب لازم يكون زي نوع الحساب الرئيسي",
  PARENT_POSTABLE: "الحساب الرئيسي لازم يكون حساب تجميع (مش حساب عليه قيود)",
};

export function accountIssues(a: { code: string; name: string; type: AccountType; isPostable?: boolean }, parent: { type: AccountType; isPostable: boolean } | null): AccountIssue[] {
  const out: AccountIssue[] = [];
  if (!/^\d{3,8}$/.test(a.code)) out.push("BAD_CODE");
  if (a.name.trim().length < 2) out.push("BAD_NAME");
  if (parent && parent.type !== a.type) out.push("PARENT_TYPE");
  if (parent && parent.isPostable) out.push("PARENT_POSTABLE");
  return out;
}

/* ---------------- ميزان المراجعة ---------------- */

export interface TbInput { accountId: number; code: string; name: string; type: AccountType; normalSide: Side; debit: string; credit: string }
export interface TbRow extends TbInput { balanceDebit: string; balanceCredit: string }
export interface TrialBalance { rows: TbRow[]; totalDebit: string; totalCredit: string; totalBalanceDebit: string; totalBalanceCredit: string; balanced: boolean }

/** رصيد كل حساب في جانبه (مدين أو دائن حسب الصافي). المجموعين لازم يتساووا لو القيود متوازنة. */
export function trialBalance(rows: readonly TbInput[]): TrialBalance {
  let td = 0n, tc = 0n, bd = 0n, bc = 0n;
  const out: TbRow[] = [];
  for (const r of rows) {
    const d = toCents(r.debit);
    const c = toCents(r.credit);
    if (d === 0n && c === 0n) continue;
    const net = d - c;
    const rd = net > 0n ? net : 0n;
    const rc = net < 0n ? -net : 0n;
    td += d; tc += c; bd += rd; bc += rc;
    out.push({ ...r, balanceDebit: centsToString(rd), balanceCredit: centsToString(rc) });
  }
  out.sort((a, b) => a.code.localeCompare(b.code));
  return { rows: out, totalDebit: centsToString(td), totalCredit: centsToString(tc), totalBalanceDebit: centsToString(bd), totalBalanceCredit: centsToString(bc), balanced: td === tc && bd === bc };
}
