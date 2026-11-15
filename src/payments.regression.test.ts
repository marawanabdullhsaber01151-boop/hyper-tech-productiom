/** @format */
// التحصيلات (50): الصلاحيات، ترتيب الأقفال، والحراسة. قراية الملفات كنص عشان الاختبار ميحتاجش قاعدة بيانات.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("التحصيلات: المسارات والصلاحيات", () => {
  const r = read("src/routes/payments.ts");
  it("القراءة والكتابة للإدارة العليا بس، وكل الكتابة في معاملة", () => {
    expect(r).toContain("requireRole(...PERMISSIONS.finance.view)");
    expect(r).toContain("requireRole(...PERMISSIONS.finance.write)");
    for (const route of ['router.post("/payments"', 'router.post("/payments/:id/allocate"', 'router.post("/payments/:id/void"']) {
      const at = r.indexOf(route);
      expect(at).toBeGreaterThan(-1);
      expect(r.slice(at, at + 160)).toContain("...write");
    }
    expect(r.match(/db\s*\.transaction\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(r).toContain("PAY_ALLOCATION_EXCEEDS");
  });
  it("مفيش حذف تحصيل ولا تعديل تخصيص من أي مسار", () => {
    expect(r).not.toMatch(/router\.(delete|put|patch)\(/);
    expect(r).not.toContain("delete(paymentAllocations");
  });
  it("مركّب في التطبيق", () => {
    expect(read("src/main.ts")).toContain("apiRouter.use(paymentsRouter)");
  });
});

describe("التحصيلات: ترتيب الأقفال والقواعد", () => {
  const lib = read("src/lib/payments.ts");
  it("قفل التحصيلات الأول، وبعدين صفوف الأوامر، وبعدين التدقيق قبل القيد", () => {
    expect(lib).toContain("pg_advisory_xact_lock(${PAYMENT_LOCK})");
    const create = lib.slice(lib.indexOf("export async function createPayment"), lib.indexOf("export async function allocatePayment"));
    expect(create.indexOf("lockCustomerOrders")).toBeLessThan(create.indexOf("settleStatuses"));
    expect(create.indexOf('"payments.created"')).toBeLessThan(create.indexOf("postJournalEntry("));
  });
  it("القيد المحاسبي بالترحيل التلقائي وللأمام بس، والعكس بالظبط عند الإلغاء", () => {
    expect(read("src/lib/payments.ts")).toContain("getAutoPostingStart(tx)");
    expect(lib).toContain("reverseLines(");
    expect(lib).toContain('status = \'posted\' and ((source_type = ${SOURCE_CUSTOMER_PAYMENT}');
  });
  it("المدفوع بيتحوّل من مشحون بس، والرجوع لمشحون عند الإلغاء", () => {
    expect(lib).toContain('o.status !== "shipped"');
    expect(lib).toContain('o.status === "paid"');
  });
  it("القفل الموحّد: التدقيق قبل الدفتر في كل مسار قيد", () => {
    const l = read("src/lib/ledger.ts");
    expect(l).toContain("export async function lockLedger");
    expect(l.indexOf("AUDIT_CHAIN_LOCK")).toBeLessThan(l.indexOf("LEDGER_LOCK})`);"));
    expect(l).toContain("await lockLedger(tx)");
    expect(read("src/lib/ledgerAuto.ts")).toContain("await lockLedger(tx)");
    expect(read("src/lib/governance.ts")).toContain("export const AUDIT_CHAIN_LOCK");
  });
});

describe("التحصيلات: القيد التلقائي ميتعكسش يدويًا والضريبة مقفولة", () => {
  it("عكس قيد تحصيل من الدفتر ممنوع", () => {
    const l = read("src/routes/ledger.ts");
    expect(l).toContain("orig.sourceType === SOURCE_CUSTOMER_PAYMENT");
    expect(l).toContain("orig.sourceType === SOURCE_PAYMENT_ALLOCATION");
  });
  it("الهجرة 0103: ترجرات مجموع التخصيص وعدم التعديل والترقيم", () => {
    const m = read("migrations/0103_customer_payments.sql");
    expect(m).toContain("PAY_ALLOCATION_EXCEEDS");
    expect(m).toContain("PAY_ALLOCATION_IMMUTABLE");
    expect(m).toContain("'customer_payment','RC-'");
  });
  it("الضريبة مقفولة افتراضيًا", () => {
    const s = read("src/domain/settings-registry.ts");
    expect(s).toMatch(/key: "tax\.vat_enabled"[^\n]*default: "off"/);
  });
});
