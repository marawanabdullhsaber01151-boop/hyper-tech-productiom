import { describe, expect, it } from "vitest";
import { canManageWarehouses, codeFor, combineStock, inScope, kindsFor, KIND_VIEW_ROLES, nameProblem, normalizeName, scopeFor, WAREHOUSE_VIEW_ROLES, type StockRow } from "./warehouseAccess";
import { toMilli } from "./warehouseCore";

describe("مين يشوف أنهي نوع", () => {
  it("المشتريات خام بس، الإنتاج خام وتحت تشغيل، المبيعات تام بس", () => {
    expect(kindsFor("purchasing_manager")).toEqual(["raw"]);
    expect(kindsFor("buyer")).toEqual(["raw"]);
    expect(kindsFor("production_manager")).toEqual(["raw", "wip"]);
    expect(kindsFor("sales_manager")).toEqual(["finished"]);
    expect(kindsFor("online_seller")).toEqual(["finished"]);
  });
  it("الإدارة ومدير المخازن وأمين المخزن بيشوفوا الأنواع التلاتة", () => {
    for (const r of ["chairman", "executive_manager", "warehouse_manager", "storekeeper", "operations_manager"]) expect(kindsFor(r)).toEqual(["raw", "wip", "finished"]);
  });
  it("الموارد البشرية والأدوار المجهولة مابتشوفش مخازن", () => {
    for (const r of ["hr", "hr_manager", "supervisor", "mystery"]) expect(kindsFor(r)).toEqual([]);
    expect(WAREHOUSE_VIEW_ROLES.includes("hr")).toBe(false);
  });
  it("الاتحاد = كل دور في أي نوع، من غير تكرار", () => {
    const all = Object.values(KIND_VIEW_ROLES).flat();
    expect(new Set(all).size).toBe(WAREHOUSE_VIEW_ROLES.length);
  });
  it("الإدارة بس بتدير المخازن (إنشاء وتعديل وإيقاف)", () => {
    expect(canManageWarehouses("chairman")).toBe(true);
    expect(canManageWarehouses("executive_manager")).toBe(true);
    expect(canManageWarehouses("warehouse_manager")).toBe(true);
    for (const r of ["storekeeper", "purchasing_manager", "sales_manager", "production_manager"]) expect(canManageWarehouses(r)).toBe(false);
  });
});

describe("نطاق أمين المخزن", () => {
  it("اتعيّن على مخزنين: يشوف دول بس", () => {
    const s = scopeFor("storekeeper", [3, 5]);
    expect(inScope(s, 3)).toBe(true);
    expect(inScope(s, 5)).toBe(true);
    expect(inScope(s, 4)).toBe(false);
  });
  it("أمين من غير تعيين: الكل (مايتقفلش لحد ما الإدارة تعيّنه)", () => {
    expect(scopeFor("storekeeper", [])).toBe("all");
  });
  it("باقي الأدوار الكل حتى لو عندها تعيينات", () => {
    expect(scopeFor("warehouse_manager", [1])).toBe("all");
    expect(scopeFor("chairman", [])).toBe("all");
  });
});

describe("الأسماء والأكواد", () => {
  it("الاسم بيتنضّف والمسافات بتتوحّد", () => {
    expect(normalizeName("  مخزن   B1  ")).toBe("مخزن B1");
  });
  it("اسم فاضي أو أطول من 60 مرفوض", () => {
    expect(nameProblem("   ")).not.toBeNull();
    expect(nameProblem("x".repeat(61))).not.toBeNull();
    expect(nameProblem("B1")).toBeNull();
  });
  it("الكود بنوعه ورقمه", () => {
    expect(codeFor("raw", 4)).toBe("WH-RAW-4");
    expect(codeFor("wip", 5)).toBe("WH-WIP-5");
    expect(codeFor("finished", 6)).toBe("WH-FG-6");
  });
});

const row = (itemId: number, name: string, wid: number, wname: string, qty: string, reserved = "0"): StockRow => ({ itemId, itemName: name, unit: "كجم", category: "raw_material", minQty: "0", warehouseId: wid, warehouseName: wname, qty, reserved, quarantine: "0" });

describe("التقرير المجمّع", () => {
  const rows = [row(1, "دقيق", 1, "B1", "10.5", "2"), row(1, "دقيق", 2, "B2", "4.25"), row(2, "سكر", 1, "B1", "7")];
  it("صف لكل صنف بمجموع مخازنه والأجزاء جواه", () => {
    const c = combineStock(rows);
    expect(c.length).toBe(2);
    const flour = c.find((x) => x.itemId === 1)!;
    expect(flour.qty).toBe("14.750");
    expect(flour.reserved).toBe("2.000");
    expect(flour.parts.map((p) => p.warehouseName)).toEqual(["B1", "B2"]);
  });
  it("الثابت: مجموع المجمّع = مجموع المنفصل (من غير كسور عايمة)", () => {
    let s = 4242;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const many: StockRow[] = [];
    for (let i = 0; i < 200; i++) many.push(row(1 + Math.floor(rnd() * 6), `i${i}`, 1 + Math.floor(rnd() * 4), `W${i}`, (Math.floor(rnd() * 100000) / 1000).toFixed(3), (Math.floor(rnd() * 1000) / 1000).toFixed(3)));
    const sep = many.reduce((a, r) => a + toMilli(r.qty), 0);
    const com = combineStock(many).reduce((a, r) => a + toMilli(r.qty), 0);
    expect(com).toBe(sep);
  });
  it("مفيش صفوف: مفيش نتيجة", () => {
    expect(combineStock([])).toEqual([]);
  });
});
