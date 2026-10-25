import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findAction } from "./lib/actionRegistry";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("المشتريات — حراس الشكل", () => {
  const route = read("./routes/purchases.ts");
  it("المسارات الثابتة متعرّفة قبل /purchases/:id (غير كده Express يفسّرها رقم)", () => {
    const at = (s: string) => route.indexOf(`"${s}"`);
    expect(at("/purchases/needs")).toBeGreaterThan(-1);
    expect(at("/purchases/suppliers")).toBeGreaterThan(-1);
    expect(at("/purchases/needs")).toBeLessThan(route.indexOf('"/purchases/:id"'));
    expect(at("/purchases/suppliers")).toBeLessThan(route.indexOf('"/purchases/:id"'));
  });
  it("الراوتر متركّب في التطبيق", () => {
    const main = read("./main.ts");
    expect(main).toContain('import purchasesRouter from "./routes/purchases"');
    expect(main).toContain("apiRouter.use(purchasesRouter)");
  });
  it("الاستلام صلاحية مستقلة لأدوار المخزن، والاعتماد محروس بالدور مش بالصلاحية بس", () => {
    expect(findAction("inventory.receivePurchase")?.defaultRoles).toEqual(["chairman", "warehouse_manager", "storekeeper"]);
    expect(route).toContain('requirePermission("inventory.receivePurchase")');
    expect(read("./lib/purchasing.ts")).toContain("PO_APPROVER_ROLES");
  });
  it("الهجرة بتعرّف الجدولين وترقيم PO-", () => {
    const sql = readFileSync(new URL("../migrations/0081_purchase_orders.sql", import.meta.url), "utf8");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "purchase_orders"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "purchase_order_items"');
    expect(sql).toContain("'purchase_order', 'PO-'");
  });
});
