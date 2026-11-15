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
    expect(ledger).toContain("lockLedger(tx)");
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

describe("49ب: التكلفة والتقييم", () => {
  it("متوسط التكلفة بيتحدّث من استلام المشتريات المفحوصة بس وقبل حركة الزيادة", () => {
    const p = read("src/routes/purchases.ts");
    expect(p).toContain("updateAverageCost(tx,");
    expect(p.indexOf("updateAverageCost(tx,")).toBeLessThan(p.indexOf('movementType: "in"'));
    expect(read("src/lib/stock.ts")).not.toContain("avgCost");
  });
  it("التكلفة بتتحمّل عند الشحن بحساب 5150 وبتتعكس من المسجّل نفسه، من نفس دالة المزامنة", () => {
    const lib = read("src/lib/ledgerAuto.ts");
    expect(lib).toContain("COGS_STATUSES.includes(status)");
    expect(lib).toContain("reversalFromNet(cogs.nets");
    expect(lib).toContain("SOURCE_SALES_COGS");
  });
  it("الهجرة 0102: عمود التكلفة (مش سالب) وحساب 5150 قابل للترحيل", () => {
    const m = read("migrations/0102_inventory_avg_cost.sql");
    expect(m).toContain('"avg_cost" numeric(14,4)');
    expect(m).toContain("inventory_items_avg_cost_nonneg");
    expect(m).toContain("'5150'");
    expect(read("src/db/schema/inventory.ts")).toContain('numeric("avg_cost"');
  });
  it("مسار تقييم المخزون للإدارة العليا، والقيد التلقائي للتكلفة مينفعش يتعكس يدوي", () => {
    const l = read("src/routes/ledger.ts");
    expect(l).toContain('router.get("/ledger/inventory-valuation", ...view');
    expect(l).toContain("orig.sourceType === SOURCE_SALES_COGS");
  });
  it("متوسط التكلفة بيتخفي عن غير الإدارة العليا (زي باقي الحقول الحساسة)", async () => {
    const { maskFields } = await import("./lib/fieldMasking");
    const row = { id: 1, name: "x", avgCost: "5.0000" };
    expect((maskFields("inventory_items", row, "storekeeper") as Record<string, unknown>).avgCost).toBeUndefined();
    expect((maskFields("inventory_items", row, "chairman") as Record<string, unknown>).avgCost).toBe("5.0000");
  });
});
