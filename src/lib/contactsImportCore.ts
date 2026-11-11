/** @format */
// استيراد جهات الاتصال بالجملة (الخطوة 46): نقي من غير قاعدة بيانات.
// الجدول بيوصل من المتصفح (نص CSV/Excel اتفكّ لصفوف وخلايا)، والسيرفر هو اللي بيفهم العناوين ويطبّع ويكشف التكرار.
import { normalizeArabicName, nameSimilarity } from "./applicationMatching";
import { normalizeEmail, normalizePhone } from "./identityNormalization";
import { phoneKey } from "./contactsCore";

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_COLUMNS = 30;
export const MAX_CELL = 300;

export interface ImportRow {
  name: string;
  company: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  notes: string;
}
export type ImportField = keyof ImportRow;
export const IMPORT_FIELDS: readonly ImportField[] = ["name", "company", "phone", "email", "address", "city", "notes"];

/** أسماء الأعمدة المقبولة (عربي وإنجليزي) بعد التبسيط. */
export const FIELD_SYNONYMS: Record<ImportField, readonly string[]> = {
  name: ["الاسم", "اسم", "اسمالعميل", "اسمالمورد", "اسمجهةالاتصال", "المسؤول", "الشخص", "name", "fullname", "contact", "contactname", "customer", "customername", "supplier"],
  company: ["الشركه", "شركه", "اسمالشركه", "المؤسسه", "المصنع", "النشاط", "company", "companyname", "business", "organization"],
  phone: ["التليفون", "تليفون", "الهاتف", "هاتف", "الموبايل", "موبايل", "المحمول", "محمول", "رقمالتليفون", "رقمالهاتف", "رقمالموبايل", "واتساب", "phone", "mobile", "tel", "telephone", "cell", "whatsapp"],
  email: ["الايميل", "ايميل", "البريد", "البريدالالكتروني", "الايميلالالكتروني", "email", "mail", "emailaddress"],
  address: ["العنوان", "عنوان", "address", "street"],
  city: ["المدينه", "مدينه", "المحافظه", "محافظه", "city", "governorate", "region"],
  notes: ["ملاحظات", "ملاحظه", "notes", "note", "comment", "comments", "remarks"],
};

/** تبسيط عنوان العمود: حروف صغيرة، من غير مسافات/علامات/تشكيل، وتوحيد الألف والتاء المربوطة والياء. */
export function headerKey(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const SYN_INDEX = (() => {
  const m = new Map<string, ImportField>();
  for (const f of IMPORT_FIELDS) for (const s of FIELD_SYNONYMS[f]) m.set(headerKey(s), f);
  return m;
})();

export interface HeaderMap { map: Array<ImportField | null>; unknown: string[] }

/** أول عمود لكل حقل بيكسب، والباقي المكرر بيتجاهل (بيتحسب مجهول). */
export function mapHeaders(headers: readonly string[]): HeaderMap {
  const used = new Set<ImportField>();
  const unknown: string[] = [];
  const map = headers.map((h) => {
    const f = SYN_INDEX.get(headerKey(h)) ?? null;
    if (f && !used.has(f)) { used.add(f); return f; }
    if (h.trim()) unknown.push(h.trim());
    return null;
  });
  return { map, unknown };
}

export type TableError = "EMPTY" | "NO_NAME_COLUMN" | "TOO_MANY_ROWS" | "TOO_MANY_COLUMNS";

export interface RawRow { line: number; raw: ImportRow }

/** أول صف عناوين. السطر = رقم الصف في الملف (العناوين = 1). الصفوف الفاضية بتتشال. */
export function rowsFromTable(table: readonly (readonly string[])[]): { error: TableError | null; headers: HeaderMap; rows: RawRow[] } {
  const none: HeaderMap = { map: [], unknown: [] };
  if (table.length === 0) return { error: "EMPTY", headers: none, rows: [] };
  if (table.some((r) => r.length > MAX_IMPORT_COLUMNS)) return { error: "TOO_MANY_COLUMNS", headers: none, rows: [] };
  const headers = mapHeaders(table[0]!);
  if (!headers.map.includes("name")) return { error: "NO_NAME_COLUMN", headers, rows: [] };
  const rows: RawRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!;
    const raw: ImportRow = { name: "", company: "", phone: "", email: "", address: "", city: "", notes: "" };
    let any = false;
    cells.forEach((c, idx) => {
      const f = headers.map[idx];
      const v = (c ?? "").replace(/\s+/g, " ").trim();
      if (v) any = true;
      if (f) raw[f] = v;
    });
    if (any) rows.push({ line: i + 1, raw });
  }
  if (rows.length === 0) return { error: "EMPTY", headers, rows };
  if (rows.length > MAX_IMPORT_ROWS) return { error: "TOO_MANY_ROWS", headers, rows: [] };
  return { error: null, headers, rows };
}

export type RowIssue = "NO_NAME" | "BAD_PHONE" | "BAD_EMAIL" | "TOO_LONG";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** تطبيع صف: الهاتف بصيغة +20…، الإيميل صغير، والمشاكل كلها مرة واحدة. */
export function cleanRow(raw: ImportRow): { row: ImportRow; issues: RowIssue[] } {
  const issues = new Set<RowIssue>();
  const row: ImportRow = { ...raw };
  if (row.name.length < 2) issues.add("NO_NAME");
  for (const f of IMPORT_FIELDS) if (row[f].length > MAX_CELL) issues.add("TOO_LONG");
  if (row.phone) {
    const p = normalizePhone(row.phone);
    const digits = p.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) issues.add("BAD_PHONE");
    else row.phone = p;
  }
  if (row.email) {
    const e = normalizeEmail(row.email);
    if (!EMAIL.test(e)) issues.add("BAD_EMAIL");
    else row.email = e;
  }
  return { row, issues: [...issues] };
}

export const ISSUE_TEXT: Record<RowIssue, string> = {
  NO_NAME: "الاسم ناقص (حرفين على الأقل)",
  BAD_PHONE: "رقم التليفون غير صحيح",
  BAD_EMAIL: "الإيميل غير صحيح",
  TOO_LONG: `في خانة أطول من ${MAX_CELL} حرف`,
};

export type RowStatus = "new" | "invalid" | "file_duplicate" | "exists" | "similar";
export type MatchReason = "phone" | "email" | "company_name" | "company" | "name";

export interface ExistingContact { id: number; name: string; company: string | null; phone: string | null; email: string | null }
export interface ImportMatch { id: number; name: string; company: string | null; phone: string | null; reason: MatchReason }

export const SIMILAR_NAME_MIN = 0.8;
const phoneOf = (p: string | null | undefined) => {
  const k = phoneKey(p);
  return k.length >= 7 ? k : "";
};

/** أسباب التطابق بين صف وجهة اتصال. phone/email/company_name = تكرار مؤكد. company/name لوحدهم = تشابه (قرار الموظف). */
export function matchReasons(r: ImportRow, c: { name: string; company: string | null; phone: string | null; email: string | null }): MatchReason[] {
  const out: MatchReason[] = [];
  const rp = phoneOf(r.phone);
  if (rp && rp === phoneOf(c.phone)) out.push("phone");
  if (r.email && c.email && normalizeEmail(c.email) === r.email) out.push("email");
  const rc = normalizeArabicName(r.company);
  const sameCompany = !!rc && rc === normalizeArabicName(c.company);
  const sameName = nameSimilarity(r.name, c.name) >= SIMILAR_NAME_MIN;
  if (sameCompany && sameName) out.push("company_name");
  else if (sameCompany) out.push("company");
  else if (sameName && !(rc && normalizeArabicName(c.company) && rc !== normalizeArabicName(c.company))) out.push("name");
  return out;
}

const HARD: ReadonlySet<MatchReason> = new Set(["phone", "email", "company_name"]);
const RANK: Record<MatchReason, number> = { phone: 0, email: 1, company_name: 2, company: 3, name: 4 };

export interface AnalyzedRow {
  line: number;
  row: ImportRow;
  issues: RowIssue[];
  status: RowStatus;
  /** لو file_duplicate: رقم سطر الصف الأول المطابق في الملف. */
  duplicateOfLine: number | null;
  matches: ImportMatch[];
}

function tokens(s: string | null | undefined): string[] {
  return normalizeArabicName(s).split(" ").filter((w) => w.length >= 3);
}

/** كشف التكرار: جوه الملف نفسه، وقدام الموجود في القاعدة (بفهرس كلمات عشان 500 صف × آلاف الجهات ما يبقاش بطيء). */
export function analyzeRows(rows: readonly RawRow[], existing: readonly ExistingContact[]): AnalyzedRow[] {
  const index = new Map<string, number[]>();
  existing.forEach((c, i) => {
    for (const tkn of new Set([...tokens(c.name), ...tokens(c.company)])) {
      const list = index.get(tkn) ?? [];
      list.push(i);
      index.set(tkn, list);
    }
  });
  const byPhone = new Map<string, number[]>();
  const byEmail = new Map<string, number[]>();
  existing.forEach((c, i) => {
    const p = phoneOf(c.phone);
    if (p) byPhone.set(p, [...(byPhone.get(p) ?? []), i]);
    const e = c.email ? normalizeEmail(c.email) : "";
    if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), i]);
  });

  const out: AnalyzedRow[] = [];
  const seen: AnalyzedRow[] = [];
  for (const { line, raw } of rows) {
    const { row, issues } = cleanRow(raw);
    const a: AnalyzedRow = { line, row, issues, status: "new", duplicateOfLine: null, matches: [] };
    out.push(a);
    if (issues.length > 0) { a.status = "invalid"; continue; }

    const prior = seen.find((s) => {
      const r = matchReasons(row, { name: s.row.name, company: s.row.company || null, phone: s.row.phone || null, email: s.row.email || null });
      return r.some((x) => HARD.has(x));
    });
    if (prior) { a.status = "file_duplicate"; a.duplicateOfLine = prior.line; continue; }
    seen.push(a);

    const cand = new Set<number>();
    const rp = phoneOf(row.phone);
    if (rp) for (const i of byPhone.get(rp) ?? []) cand.add(i);
    if (row.email) for (const i of byEmail.get(row.email) ?? []) cand.add(i);
    for (const tkn of new Set([...tokens(row.name), ...tokens(row.company)])) for (const i of index.get(tkn) ?? []) cand.add(i);

    const found: ImportMatch[] = [];
    for (const i of cand) {
      const c = existing[i]!;
      const reasons = matchReasons(row, c);
      if (reasons.length === 0) continue;
      const reason = reasons.reduce((m, r) => (RANK[r] < RANK[m] ? r : m));
      found.push({ id: c.id, name: c.name, company: c.company, phone: c.phone, reason });
    }
    found.sort((x, y) => RANK[x.reason] - RANK[y.reason] || x.id - y.id);
    a.matches = found.slice(0, 3);
    const top = found[0];
    if (top) a.status = HARD.has(top.reason) ? "exists" : "similar";
  }
  return out;
}

export interface ImportSummary { total: number; new: number; invalid: number; fileDuplicate: number; exists: number; similar: number }

export function summarizeRows(rows: readonly Pick<AnalyzedRow, "status">[]): ImportSummary {
  const s: ImportSummary = { total: rows.length, new: 0, invalid: 0, fileDuplicate: 0, exists: 0, similar: 0 };
  for (const r of rows) {
    if (r.status === "new") s.new++;
    else if (r.status === "invalid") s.invalid++;
    else if (r.status === "file_duplicate") s.fileDuplicate++;
    else if (r.status === "exists") s.exists++;
    else s.similar++;
  }
  return s;
}

/** اللي هيتحفظ: الجديد، والمتشابه اللي الموظف وافق عليه بالسطر. التكرار المؤكد والغلط عمره ما بيتحفظ. */
export function rowsToCreate(rows: readonly AnalyzedRow[], allowSimilarLines: readonly number[]): AnalyzedRow[] {
  const allow = new Set(allowSimilarLines);
  return rows.filter((r) => r.status === "new" || (r.status === "similar" && allow.has(r.line)));
}
