/** @format */
// دفتر الأستاذ (48): قراية الملفات كنص عشان الاختبار ميحتاجش قاعدة بيانات.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("دفتر الأستاذ: الهجرة (ضمانات القاعدة)", () => {
  const m = read("migrations/0100_general_ledger.sql");
  it("4 جداول وقيود المبالغ (غير سالبة ومدين أو دائن مش الاتنين)", () => {
    for (const t of ["gl_accounts", "gl_periods", "gl_journal_entries", "gl_journal_lines"]) expect(m).toContain(`CREATE TABLE IF NOT EXISTS "${t}"`);
    expect(m).toContain('CHECK ("debit" >= 0)');
    expect(m).toContain('CHECK (("debit" = 0) <> ("credit" = 0))');
  });
  it("ترجر التوازن مؤجّل لوقت الـ COMMIT، والفترة المقفولة مرفوضة، والتعديل والحذف ممنوعين", () => {
    expect(m).toContain("CREATE CONSTRAINT TRIGGER gl_lines_balance_check AFTER INSERT ON \"gl_journal_lines\" DEFERRABLE INITIALLY DEFERRED");
    expect(m).toContain("GL_UNBALANCED");
    expect(m).toContain("GL_PERIOD_CLOSED");
    expect(m).toContain("GL_DATE_OUTSIDE_PERIOD");
    expect(m).toContain("BEFORE UPDATE OR DELETE ON \"gl_journal_lines\"");
    expect(m).toContain("BEFORE UPDATE OR DELETE ON \"gl_journal_entries\"");
    expect(m).toContain("NEW.status = 'reversed'");
  });
  it("قيد المصدر فريد (عشان القيود التلقائية ما تتكررش) وعكس واحد لكل قيد", () => {
    expect(m).toContain("gl_entries_source_unique");
    expect(m).toContain("gl_entries_reversal_unique");
  });
  it("الدليل الافتراضي: كل المستويات متسلسلة (الأب قبل الابن) وحساب النقدية والعملاء والمبيعات موجودين", () => {
    expect(m).toContain("'1110','النقدية بالخزينة'");
    expect(m).toContain("'1130','العملاء'");
    expect(m).toContain("'4100','إيرادات المبيعات'");
    expect(m).toContain("'1290','مجمع الإهلاك','asset','credit'");
    expect(m).toContain("'4110','مردودات ومسموحات المبيعات','revenue','debit'");
    expect(m).toContain("ON CONFLICT (\"code\") DO NOTHING");
  });
});

describe("دفتر الأستاذ: السيرفر", () => {
  const svc = read("src/lib/ledger.ts");
  const r = read("src/routes/ledger.ts");
  it("الكتابة في الدفتر من دالة واحدة بس، تتنادى جوه معاملة المتصل", () => {
    expect((svc.match(/\.insert\(glJournalEntriesTable\)/g) ?? []).length).toBe(1);
    expect((svc.match(/\.insert\(glJournalLinesTable\)/g) ?? []).length).toBe(1);
    expect(r).not.toMatch(/\.insert\((glJournalEntriesTable|glJournalLinesTable)\)/);
    expect(r).not.toMatch(/\.delete\(/);
    expect(svc).toContain("pg_advisory_xact_lock");
  });
  it("كل المسارات محمية بصلاحية finance، والكتابة بمعاملة وتدقيق", () => {
    expect(r).toContain("PERMISSIONS.finance.view");
    expect(r).toContain("PERMISSIONS.finance.write");
    for (const k of ["ledger.account_created", "ledger.account_updated", "ledger.entry_posted", "ledger.entry_reversed"]) expect(r).toContain(`actionKey: "${k}"`);
    expect((r.match(/\.transaction\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it("العكس: سبب إجباري، ما يتعكسش مرتين ولا عكسي، وبيستخدم نفس الدالة", () => {
    expect(r).toContain("ALREADY_REVERSED");
    expect(r).toContain("IS_REVERSAL");
    expect(r).toContain(".min(3");
    expect(r).toContain("postJournalEntry(tx, {");
    expect(r).toContain('sourceType: "reversal"');
  });
  it("رسايل الترجرات بتتحوّل لخطأ مفهوم، والراوتر متركب، والسنة المالية من إعداد fiscal_year_start", () => {
    expect(r).toContain("GL_UNBALANCED");
    expect(r).toContain("GL_PERIOD_CLOSED");
    expect(read("src/main.ts")).toContain("apiRouter.use(ledgerRouter)");
    expect(r).toContain('values["fiscal_year_start"]');
  });
});

describe("دفتر الأستاذ: الواجهة", () => {
  it("الصفحة في الراوتر بحارس أدوار المالية، وفي القايمة للإدارة العليا", () => {
    expect(read("web/src/app/App.tsx")).toContain('path: "/staff/ledger"');
    expect(read("web/src/app/App.tsx")).toContain("FINANCE_PAGE_ROLES");
    expect(read("src/lib/departments.ts")).toContain('href: "/v2/staff/ledger"');
  });
  it("الواجهة بتستدعي كل المسارات", () => {
    const w = read("web/src/staff/Ledger.tsx");
    for (const p of ["/ledger/periods", "/ledger/entries", "/ledger/accounts", "/ledger/trial-balance", "/reverse"]) expect(w).toContain(p);
  });
});
