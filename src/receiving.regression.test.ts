/** @format */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const route = read("./routes/purchases.ts");
const handler = (start: string, len = 4200) => {
  const i = route.indexOf(start);
  expect(i, `${start} موجود`).toBeGreaterThan(-1);
  return route.slice(i, i + len);
};

describe("خطوة 36 — فحص استلام الخامات", () => {
  it("الاستلام ما بيدخّلش المخزون، ومعاملة واحدة مع تدقيق", () => {
    const h = handler('router.post("/purchases/:id/receive"', 3200);
    expect(h).toContain("db.transaction");
    expect(h).toContain("purchaseReceiptsTable");
    expect(h).toContain("writeAuditEvent");
    expect(h).not.toContain("applyStockMovement");
  });

  it("الفحص: بالأدوار، معاملة وقفل إيصال وأمر، المخزون للمقبول بس، فصل مهام", () => {
    const h = handler('router.post("/purchases/receipts/:id/inspect"', 6500);
    expect(h).toContain("requireRole(...INSPECT_ROLES)");
    expect(h).toContain("db.transaction");
    expect((h.match(/\.for\("update"\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(h).toContain("planInspection");
    expect(h).toContain("violatesSeparation");
    expect(h).toContain("l.accepted > 0");
    expect(h).toContain("applyStockMovement");
    expect(h).toContain("writeAuditEvent");
  });

  it("قايمة الإيصالات قبل /purchases/:id، ومن غير أسعار", () => {
    expect(route.indexOf('"/purchases/receipts"')).toBeGreaterThan(-1);
    expect(route.indexOf('"/purchases/receipts"')).toBeLessThan(route.indexOf('"/purchases/:id"'));
    const h = handler("async function loadReceipts", 2200);
    expect(h).not.toContain("unitPrice");
  });

  it("إلغاء أمر عليه استلام مستني فحص ممنوع", () => {
    expect(handler('router.post("/purchases/:id/status"', 3500)).toContain("pendingByItem(tx, id)");
  });

  it("الهجرة 0089 فيها الجدولين وتسلسل GRN وقيود الحالة", () => {
    const sql = read("../migrations/0089_purchase_receipts.sql");
    for (const s of ["purchase_receipts", "purchase_receipt_lines", "'purchase_receipt'", "pending_inspection", "Rollback"]) expect(sql).toContain(s);
  });
});
