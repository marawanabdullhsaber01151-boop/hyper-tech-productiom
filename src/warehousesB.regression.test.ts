/** @format */
// المخازن - المرحلة ب: الهجرة 0111، حراسة مسارات المخازن، قفل المشتريات على الخامات، وحقن المخازن في السايدبار (من غير قاعدة بيانات).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getNavForRole } from "./lib/departments";
import { purchasableProblem } from "./lib/warehouseCore";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const mig = read("migrations/0111_warehouse_keepers_receipt_wh.sql");
const routes = read("src/routes/warehouses.ts");
const purchases = read("src/routes/purchases.ts");
const movements = read("src/routes/movements.ts");
const nav = read("src/routes/nav.ts");
const main = read("src/main.ts");

describe("الهجرة 0111", () => {
  it("بعد 0110 مباشرة وفيها Rollback", () => {
    const files = readdirSync(resolve(root, "migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const i = files.indexOf("0111_warehouse_keepers_receipt_wh.sql");
    expect(i).toBeGreaterThan(0);
    expect(files[i - 1]).toMatch(/^0110_/);
    expect(mig).toMatch(/Rollback:/);
  });
  it("متوافقة للخلف: عمود الاستلام بيقبل null وكل الأوامر IF NOT EXISTS", () => {
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS "warehouse_id" integer REFERENCES "warehouses"\("id"\)(?! NOT NULL)/);
    expect(mig).toMatch(/CREATE TABLE IF NOT EXISTS "warehouse_keepers"/);
    const code = mig.split("\n").filter((l) => !l.startsWith("--")).join("\n");
    expect(code).not.toMatch(/DROP |TRUNCATE|DELETE FROM/i);
  });
  it("مفيش تعيين مكرر، وحذف المخزن أو المستخدم بيمسح التعيين بس", () => {
    expect(mig).toMatch(/UNIQUE \("warehouse_id", "user_id"\)/);
    expect(mig).toMatch(/"warehouse_id" integer NOT NULL REFERENCES "warehouses"\("id"\) ON DELETE CASCADE/);
    expect(mig).toMatch(/"user_id" integer NOT NULL REFERENCES "system_users"\("id"\) ON DELETE CASCADE/);
  });
});

describe("مسارات /warehouses", () => {
  it("متركّبة في main وكل مسار فيه requireAuth + requireRole", () => {
    expect(main).toContain("warehousesRouter");
    const defs = routes.match(/router\.(get|post|patch|put|delete)\(/g) ?? [];
    expect(defs.length).toBe(6);
    for (const m of routes.matchAll(/router\.(?:get|post|patch|put|delete)\("[^"]+",([^)]*?)async/g)) {
      expect(m[1]).toContain("requireAuth");
      expect(m[1]).toContain("requireRole(");
    }
  });
  it("الإنشاء والتعديل والأمناء للإدارة بس، والقراءة لأدوار العرض", () => {
    expect(routes).toMatch(/router\.post\("\/warehouses", requireAuth, requireRole\(\.\.\.WAREHOUSE_MANAGE_ROLES\)/);
    expect(routes).toMatch(/router\.patch\("\/warehouses\/:id", requireAuth, requireRole\(\.\.\.WAREHOUSE_MANAGE_ROLES\)/);
    expect(routes).toMatch(/router\.put\("\/warehouses\/:id\/keepers", requireAuth, requireRole\(\.\.\.WAREHOUSE_MANAGE_ROLES\)/);
    expect(routes).toMatch(/router\.get\("\/warehouses", requireAuth, requireRole\(\.\.\.WAREHOUSE_VIEW_ROLES\)/);
  });
  it("القراءة بتتحقق من النوع المسموح ونطاق الأمين، وكل تغيير بيتسجّل في السجل", () => {
    expect(routes).toContain("kindsFor(role)");
    expect(routes).toContain("inScope(scope");
    for (const k of ["warehouses.created", "warehouses.updated", "warehouses.keepers"]) expect(routes).toContain(k);
  });
  it("الاسم المكرر 409 وأخطاء المخزن (WH_*) بتعدّي على errorHandler", () => {
    expect(routes).toContain("23505");
    expect(routes).toMatch(/next\(e\)/);
  });
  it("الأمناء لازم يكونوا أمناء مخازن نشطين", () => {
    expect(routes).toMatch(/storekeeper/);
    expect(routes).toMatch(/active/);
  });
});

describe("المشتريات للخامات بس وبمخزن خامات", () => {
  it("purchasableProblem: الخامة بس", () => {
    expect(purchasableProblem("raw_material", "حبيبات")).toBeNull();
    expect(purchasableProblem("finished_good", "كيس")).toMatch(/مش خامة/);
    expect(purchasableProblem("wip", "نص مصنّع")).toMatch(/مش خامة/);
    expect(purchasableProblem("", "؟")).not.toBeNull();
  });
  it("أمر الشراء والاستلام بيرفضوا غير الخامات", () => {
    expect((purchases.match(/purchasableProblem\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("الاستلام: مخزن موجود ونوعه خام ونشط وفي نطاق الأمين، ويتخزن على الاستلام", () => {
    const rc = purchases.split('"/purchases/:id/receive"')[1]!.split("router.")[0]!;
    expect(rc).toContain("defaultWarehouseId(tx");
    expect(rc).toMatch(/kind !== "raw"/);
    expect(rc).toMatch(/\.active/);
    expect(rc).toContain("inScope(");
    expect(rc).toContain("warehouseId: wh.id");
  });
  it("الفحص بيدخل المقبول المخزن اللي اتستلمت فيه", () => {
    expect(purchases).toMatch(/applyStockMovement\(tx, \{[^}]*warehouseId: receipt\.warehouseId/);
  });
});

describe("الحركة اليدوية", () => {
  it("الأمين المحدد بيلزمه مخزن في نطاقه، والحذف بيعكس على نفس المخزن", () => {
    expect(movements).toContain("inScope(");
    expect(movements).toContain("warehouseId");
    expect(movements).toContain("bumpBalance");
  });
});

describe("السايدبار", () => {
  it("/nav بيحقن مخازن النطاق وزرار مخزن جديد للإدارة بس", () => {
    expect(nav).toContain("warehouse-mgmt");
    expect(nav).toContain("canManageWarehouses");
    expect(nav).toContain("new=1");
    expect(nav).toContain("active");
  });
  it("كل دور بيشوف نوعه بس", () => {
    const kinds = (role: string) => (getNavForRole(role as never).find((d) => d.id === "warehouse-mgmt")?.subFunctions.map((s) => s.id) ?? []);
    expect(kinds("chairman")).toEqual(["wh-raw", "wh-wip", "wh-finished"]);
    expect(kinds("buyer")).toEqual(["wh-raw"]);
    expect(kinds("production_manager")).toEqual(["wh-raw", "wh-wip"]);
    expect(kinds("sales_manager")).toEqual(["wh-finished"]);
    expect(kinds("online_seller")).toEqual(["wh-finished"]);
    expect(kinds("hr")).toEqual([]);
    expect(kinds("accountant")).toEqual([]);
  });
  it("القوايم مطوية والصفحات بتفتح نفس الصفحة بنوعها", () => {
    const d = getNavForRole("chairman").find((x) => x.id === "warehouse-mgmt")!;
    for (const s of d.subFunctions) {
      expect(s.collapsible).toBe(true);
      expect(s.pages[0]!.href).toMatch(/^\/v2\/staff\/warehouses\?kind=(raw|wip|finished)&wh=all$/);
    }
  });
});
