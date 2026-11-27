/** @format */
// المخازن - المرحلة أ: حراسة بنيوية للهجرة 0110 ولكل مسار بيحرّك المخزون (مفيش قاعدة بيانات هنا؛ الفحص الحي في scripts/check-warehouses.mjs).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_KINDS, DEFAULT_KIND_OF, ITEM_CATEGORIES } from "./lib/warehouseCore";
import { warehouseGuardOf } from "./lib/warehouseGuard";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const mig = read("migrations/0110_warehouses_balances.sql");
const stock = read("src/lib/stock.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}
const srcFiles = walk("src");

describe("الهجرة 0110", () => {
  it("بعد 0109 مباشرة، وفيها Rollback", () => {
    const files = readdirSync(resolve(root, "migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
    const i = files.indexOf("0110_warehouses_balances.sql");
    expect(i > 0).toBe(true);
    expect(files[i - 1]).toMatch(/^0109_/);
    expect(mig).toContain("Rollback");
  });
  it("قابلة للتكرار: الجداول IF NOT EXISTS، والنقل والمخازن ON CONFLICT، والتريجرات DROP IF EXISTS قبل CREATE", () => {
    expect(mig).toContain('CREATE TABLE IF NOT EXISTS "warehouses"');
    expect(mig).toContain('CREATE TABLE IF NOT EXISTS "stock_balances"');
    expect(mig).toContain('ADD COLUMN IF NOT EXISTS "warehouse_id"');
    expect(mig).toMatch(/INSERT INTO "warehouses"[\s\S]*?ON CONFLICT DO NOTHING/);
    expect(mig).toMatch(/INSERT INTO "stock_balances"[\s\S]*?ON CONFLICT \("item_id", "warehouse_id"\) DO NOTHING/);
    const triggers = [...mig.matchAll(/CREATE TRIGGER (\w+)/g)].map((m) => m[1]);
    expect(triggers.length).toBe(6);
    for (const t of triggers) expect(mig, t).toMatch(new RegExp(`DROP TRIGGER IF EXISTS ${t} ON`));
  });
  it("نقل الأرصدة الحالية بيحصل قبل تركيب أي تريجر (علشان التريجرات ماتتدخلش في النقل)", () => {
    const backfill = mig.indexOf('INSERT INTO "stock_balances"');
    expect(backfill > 0).toBe(true);
    for (const m of mig.matchAll(/CREATE TRIGGER/g)) expect(m.index! > backfill).toBe(true);
  });
  it("قيود الكمية بـ NOT VALID بعد النقل (أرصدة سالبة قديمة مايوقفش الهجرة)", () => {
    for (const c of ["qty", "reserved", "quarantine"]) expect(mig).toMatch(new RegExp(`stock_balances_${c}_nonneg" CHECK \\("[a-z_]+" >= 0\\) NOT VALID`));
    expect(mig.indexOf("NOT VALID") > mig.indexOf('INSERT INTO "stock_balances"')).toBe(true);
  });
  it("مخزن افتراضي واحد لكل نوع، واسم/كود فريد، والنوع من التلاتة بس", () => {
    expect(mig).toContain('"warehouses_one_default_per_kind" ON "warehouses" ("kind") WHERE "is_default"');
    expect(mig).toContain('CHECK ("kind" IN (\'raw\',\'wip\',\'finished\'))');
    expect(mig).toContain('(lower("code"))');
    expect(mig).toContain('("kind", lower("name"))');
    for (const code of ["WH-RAW", "WH-WIP", "WH-FG"]) expect(mig).toContain(`'${code}'`);
  });
  it("قاعدة النوع في SQL = ALLOWED_KINDS في الكود، والافتراضي = DEFAULT_KIND_OF", () => {
    for (const cat of ITEM_CATEGORIES) {
      const kinds = ALLOWED_KINDS[cat];
      const expr = kinds.length === 1 ? `k = '${kinds[0]}'` : `k IN (${kinds.map((k) => `'${k}'`).join(",")})`;
      expect(mig, cat).toContain(`WHEN '${cat}' THEN ${expr}`);
    }
    expect(mig).toContain("ELSE k = 'raw'");
    expect(mig).toContain("WHEN 'wip' THEN 'wip' WHEN 'finished_good' THEN 'finished' ELSE 'raw'");
    expect(DEFAULT_KIND_OF).toEqual({ raw_material: "raw", wip: "wip", finished_good: "finished" });
  });
  it("علم التزامن hyper.stock_sync: كل دالة بتشغّله بترجّع قيمته القديمة، وكل دالة بتتحقق منه الأول", () => {
    const code = mig.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    const fns = code.split("CREATE OR REPLACE FUNCTION ").slice(1).filter((f) => f.includes("hyper.stock_sync"));
    expect(fns.length).toBe(3);
    for (const f of fns) {
      expect(f).toContain("= 'on' THEN RETURN");
      expect(f).toContain("PERFORM set_config('hyper.stock_sync', 'on', true)");
      expect(f).toContain("PERFORM set_config('hyper.stock_sync', prev, true)");
    }
  });
  it("التعديل المباشر القديم على الإجمالي بيتحوّل لفرق على الافتراضي (UPDATE ثم INSERT مش upsert بقيمة سالبة)", () => {
    const shim = mig.split("CREATE OR REPLACE FUNCTION wh_items_stock_guard")[1].split("CREATE OR REPLACE FUNCTION")[0];
    expect(shim).toContain("INSERT INTO stock_balances (item_id, warehouse_id, qty, reserved_qty, quarantine_qty) VALUES (OLD.id, wid, 0, 0, 0)");
    expect(shim).toContain("qty = qty + dq, reserved_qty = reserved_qty + dr, quarantine_qty = quarantine_qty + dk");
    expect(shim).toContain("NEW.qty := sq; NEW.reserved_qty := sr; NEW.quarantine_qty := sk;");
  });
  it("الحركة من غير مخزن بتاخد الافتراضي، والعمود NOT NULL بعد التعبئة", () => {
    expect(mig).toContain("BEFORE INSERT ON \"stock_movements\"");
    expect(mig.indexOf('UPDATE "stock_movements" m SET "warehouse_id"') < mig.indexOf('ALTER COLUMN "warehouse_id" SET NOT NULL')).toBe(true);
  });
  it("كل RAISE EXCEPTION 'WH_…' في الهجرة ليه رسالة عربي (من غير ما يطلع 500)", () => {
    const keys = [...new Set([...mig.matchAll(/RAISE EXCEPTION '(WH_[A-Z_]+)'/g)].map((m) => m[1]))];
    expect(keys.length >= 7).toBe(true);
    for (const k of keys) {
      const g = warehouseGuardOf(new Error(`error: ${k}`));
      expect(g, k).not.toBeNull();
      expect(g!.message).toMatch(/[؀-ۿ]/);
    }
  });
});

describe("رسائل الترجر", () => {
  it("بتتقرا من سلسلة cause (drizzle بيغلّف الرسالة)", () => {
    const wrapped = new Error("Failed query", { cause: new Error('new row for relation "stock_balances" violates check constraint "stock_balances_qty_nonneg"') });
    expect(warehouseGuardOf(wrapped)?.code).toBe("STOCK_NEGATIVE");
    expect(warehouseGuardOf(new Error("ERR whatever"))).toBeNull();
    expect(warehouseGuardOf(null)).toBeNull();
  });
  it("errorHandler بيحوّلها 409 قبل فرع أخطاء النطاق", () => {
    const eh = read("src/middleware/errorHandler.ts");
    expect(eh).toContain("warehouseGuardOf(err)");
    expect(eh.indexOf("warehouseGuardOf(err)") < eh.indexOf("isDomainError(err)")).toBe(true);
  });
});

describe("مسارات حركة المخزون كلها بتعدّي من stock.ts", () => {
  it("تعديل inventory_items.qty المباشر مسموح بس في PATCH الأصناف (التريجر بيحوّله) وتكلفة المتوسط", () => {
    const users = srcFiles.filter((f) => /\.update\(inventoryItemsTable\)/.test(read(f)));
    expect(users.sort()).toEqual(["src/lib/inventoryCost.ts", "src/routes/inventory.ts"]);
    expect(read("src/lib/inventoryCost.ts")).toMatch(/set\(\{ avgCost: next \}\)/);
  });
  it("مفيش كود بيدخل في stock_movements غير applyStockMovement", () => {
    const users = srcFiles.filter((f) => /insert\(stockMovementsTable\)|INSERT INTO stock_movements/.test(read(f)));
    expect(users).toEqual(["src/lib/stock.ts"]);
  });
  it("حذف الحركة بيعكس الأثر على مخزن الحركة نفسها (مش على الإجمالي)", () => {
    const mv = read("src/routes/movements.ts");
    expect(mv).toContain("bumpBalance(tx, item.id, whId");
    expect(mv).not.toMatch(/update\(inventoryItemsTable\)/);
  });
  it("stock.ts: قفل الصنف قبل قراءة الأرصدة، والتوزيع من الدوال النقية، والحركة بتتسجل بمخزنها", () => {
    for (const s of ['.for("update")', "planOut(rows, amount)", "planReserve(rows, toMilli(amount))", "planRelease(rows, toMilli(amount))", "warehouseId: sh.warehouseId", "checkWarehouse("]) expect(stock, s).toContain(s);
    expect(stock.indexOf("lockItem(tx, data.inventoryItemId)") < stock.indexOf("loadRows(tx, item.id)")).toBe(true);
  });
  it("stock.ts مابيعدّلش inventory_items.qty/reserved مباشرة (التريجر هو اللي بيجمّع)", () => {
    expect(stock).not.toMatch(/update\(inventoryItemsTable\)/);
  });
  it("المخزن الصريح لازم يناسب فئة الصنف وينشط للزيادة", () => {
    expect(stock).toContain("kindAllowed(category, w.kind)");
    expect(stock).toContain("forIncrease && !w.active");
  });
});

describe("النسخة الاحتياطية والفحص", () => {
  const backup = read("src/lib/backup.ts");
  it("المخازن قبل الأصناف، والأرصدة بعدها، وفضّي الأرصدة قبل الإدراج (التريجر حط أرصدة افتراضية)", () => {
    const i = (n: string) => backup.indexOf(`name: "${n}"`);
    expect(i("warehouses") < i("inventory_items")).toBe(true);
    expect(i("inventory_items") < i("stock_balances")).toBe(true);
    expect(i("stock_balances") < i("stock_movements")).toBe(true);
    expect(backup).toContain('if (name === "stock_balances") await tx.execute(sql`DELETE FROM stock_balances`)');
    expect(backup).toContain("onConflictDoNothing()");
  });
  it("فحص الصحة بيكشف إجمالي صنف مختلف عن مجموع أرصدته", () => {
    expect(read("src/lib/systemHealth.ts")).toContain('id: "stock_balance_mismatch"');
  });
  it("سكربت الفحص الحي بيعمل ROLLBACK دايمًا", () => {
    const sc = read("scripts/check-warehouses.mjs");
    expect(sc).toContain('await c.query("ROLLBACK")');
  });
});

describe("سكربتات الصيانة ماتمسحش المخازن ولا بتبوّظ الأرصدة", () => {
  it("reset-test-data بيحمي جدول المخازن (من غير الافتراضية أي حركة بتفشل)", () => {
    const sc = read("scripts/reset-test-data.mjs");
    const list = sc.split("const ALWAYS_PROTECTED = [")[1].split("];")[0];
    expect(list).toContain('"warehouses"');
  });
  it("wipe-customers بيعكس أثر الحركات على رصيد مخزن الحركة نفسها، وبيحمي المخازن والأرصدة", () => {
    const sc = read("scripts/wipe-customers.mjs");
    expect(sc).toContain("select inventory_item_id, warehouse_id,");
    expect(sc).toContain("update stock_balances set qty = qty + $1::numeric");
    expect(sc).not.toMatch(/update inventory_items set qty/);
    expect(sc).toMatch(/PROTECTED = new Set\([^)]*"warehouses"[^)]*"stock_balances"/);
  });
});
