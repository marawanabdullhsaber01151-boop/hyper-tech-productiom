/** @format */
// الترحيل التلقائي (49أ): نقط الربط والحراسة. قراية الملفات كنص عشان الاختبار ميحتاجش قاعدة بيانات.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("الترحيل التلقائي: كل طريق بيغيّر أمر البيع بيقرّب الدفتر", () => {
  const sales = read("src/routes/sales.ts");
  it("إنشاء وتعديل وحذف وإضافة بند وحذف بند ورفض/اعتماد كلها بتنادي المزامنة جوه المعاملة", () => {
    expect(sales).toContain('import { syncSalesOrderLedger } from "../lib/ledgerAuto"');
    expect(count(sales, "syncSalesOrderLedger(tx,")).toBeGreaterThanOrEqual(7);
    expect(sales).toContain('{ forceStatus: "cancelled" }');
    // الحذف: المزامنة قبل الحذف الفعلي (الأمر لازم يكون لسه موجود)
    expect(sales.indexOf('forceStatus: "cancelled"')).toBeLessThan(sales.indexOf("await tx.delete(salesOrdersTable)"));
  });
  it("قرار الاعتماد (موافقة ورفض) بيزامن الدفتر", () => {
    const gov = read("src/routes/governance.ts");
    expect(count(gov, "syncSalesOrderLedger(tx, request.resourceId")).toBe(2);
  });
  it("استلام المشتريات بيتقيّد بعد الفحص وبالمقبول بس", () => {
    const p = read("src/routes/purchases.ts");
    expect(p).toContain("postPurchaseReceiptEntry(tx,");
    expect(p).toContain("l.accepted > 0");
    expect(p.indexOf("postPurchaseReceiptEntry(tx,")).toBeLessThan(p.indexOf('actionKey: "purchases.inspect"'));
  });
});

describe("الترحيل التلقائي: الإعداد والعكس اليدوي", () => {
  const ledger = read("src/routes/ledger.ts");
  it("الإعداد للإدارة العليا بس وبيتسجّل في المراجعة وبقفل مشترك مع الترحيل", () => {
    expect(ledger).toContain('router.get("/ledger/auto-posting", ...view');
    expect(ledger).toContain('router.put("/ledger/auto-posting", ...write');
    expect(ledger).toContain("pg_advisory_xact_lock(4801)");
    expect(ledger).toContain("checkAutoPostingChange(");
    expect(ledger).toContain('actionKey: "ledger.auto_posting_changed"');
  });
  it("القيد التلقائي مينفعش يتعكس يدوي (بيتصحح من المستند)", () => {
    expect(ledger).toContain('"AUTO_ENTRY"');
  });
  it("الدوال بتتخطى كل حاجة لو الإعداد مقفول، ومفيش حذف أو تعديل مباشر في جداول الدفتر", () => {
    const lib = read("src/lib/ledgerAuto.ts");
    expect(count(lib, "getAutoPostingStart(")).toBeGreaterThanOrEqual(3);
    expect(lib).not.toMatch(/\.(update|delete)\(\s*gl[A-Z]/);
    expect(lib).toContain("postJournalEntry(");
  });
});
