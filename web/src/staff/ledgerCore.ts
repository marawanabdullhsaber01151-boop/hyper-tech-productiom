/** منطق شاشة الحسابات والقيود (نقي، من غير واجهة). المبالغ بالقروش BigInt، مفيش number للفلوس. */

export interface EntryFormLine { key: number; accountId: string; debit: string; credit: string; memo: string }
export interface EntryForm { entryDate: string; description: string; lines: EntryFormLine[] }

const AMOUNT = /^\d{1,12}(?:\.\d{1,2})?$/;

/** «12.5» ← 1250n. فاضي = 0. غير صالح = null. بيقبل الأرقام العربية والفاصلة العربية. */
export function parseCents(raw: string): bigint | null {
  const s = raw
    .trim()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u060C,\u066B]/g, ".");
  if (s === "") return 0n;
  if (!AMOUNT.test(s)) return null;
  const [w = "0", f = ""] = s.split(".");
  return BigInt(w) * 100n + BigInt(f.padEnd(2, "0"));
}

export function formatCents(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
}

export const emptyLine = (key: number): EntryFormLine => ({ key, accountId: "", debit: "", credit: "", memo: "" });
export const emptyForm = (today: string): EntryForm => ({ entryDate: today, description: "", lines: [emptyLine(1), emptyLine(2)] });

export interface Totals { debit: bigint; credit: bigint; diff: bigint; badAmount: boolean }
export function totals(f: EntryForm): Totals {
  let debit = 0n;
  let credit = 0n;
  let badAmount = false;
  for (const l of f.lines) {
    const d = parseCents(l.debit);
    const c = parseCents(l.credit);
    if (d === null || c === null) { badAmount = true; continue; }
    debit += d;
    credit += c;
  }
  return { debit, credit, diff: debit - credit, badAmount };
}

export type FormIssue = "date" | "desc" | "lines" | "amount" | "account" | "zero" | "both" | "unbalanced";

/** كل المشاكل (نفس قواعد السيرفر) عشان الزرار يتقفل والرسالة تبان قبل الإرسال. */
export function formIssues(f: EntryForm): FormIssue[] {
  const out = new Set<FormIssue>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.entryDate)) out.add("date");
  if (f.description.trim().length < 3) out.add("desc");
  if (f.lines.length < 2) out.add("lines");
  const t = totals(f);
  if (t.badAmount) out.add("amount");
  for (const l of f.lines) {
    if (!l.accountId) out.add("account");
    const d = parseCents(l.debit);
    const c = parseCents(l.credit);
    if (d === null || c === null) continue;
    if (d === 0n && c === 0n) out.add("zero");
    if (d > 0n && c > 0n) out.add("both");
  }
  if (!t.badAmount && t.diff !== 0n) out.add("unbalanced");
  return [...out];
}

export function toPayload(f: EntryForm) {
  return {
    entryDate: f.entryDate,
    description: f.description.trim(),
    lines: f.lines.map((l) => ({
      accountId: Number(l.accountId),
      debit: formatCents(parseCents(l.debit) ?? 0n),
      credit: formatCents(parseCents(l.credit) ?? 0n),
      memo: l.memo.trim() || null,
    })),
  };
}

export interface AccountRow { id: number; code: string; name: string; type: string; normalSide: string; parentId: number | null; isPostable: boolean; isActive: boolean; isSystem: boolean }

/** ترتيب الدليل كشجرة مسطّحة: العمق من الأب. */
export function accountTree(rows: readonly AccountRow[]): Array<AccountRow & { depth: number }> {
  const byParent = new Map<number | null, AccountRow[]>();
  for (const r of rows) {
    const k = r.parentId ?? null;
    byParent.set(k, [...(byParent.get(k) ?? []), r]);
  }
  const out: Array<AccountRow & { depth: number }> = [];
  const walk = (parent: number | null, depth: number) => {
    for (const r of [...(byParent.get(parent) ?? [])].sort((a, b) => a.code.localeCompare(b.code))) {
      out.push({ ...r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export const postableAccounts = (rows: readonly AccountRow[]) => rows.filter((a) => a.isPostable && a.isActive).sort((a, b) => a.code.localeCompare(b.code));
