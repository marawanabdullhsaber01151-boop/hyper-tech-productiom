import { describe, expect, it } from "vitest";
import { availOf, filterStock, kindsOfCategory, needsPicker, parsePageParams, partsText, pickForCategory, pickOptions, stockCounts, stockCsv, whState, type WhItem, type WhStockRow } from "./warehousesCore";

const w = (id: number, kind: WhItem["kind"], over: Partial<WhItem> = {}): WhItem => ({ id, code: `C${id}`, name: `م${id}`, kind, isDefault: false, active: true, notes: null, itemsCount: 0, keepers: [], ...over });
const row = (itemId: number, over: Partial<WhStockRow> = {}): WhStockRow => ({ itemId, itemName: `صنف ${itemId}`, unit: "كجم", minQty: "10", qty: "50", reserved: "5", warehouseId: 1, warehouseName: "B1", ...over });

describe("parsePageParams", () => {
  it("بيقرا النوع والمخزن وطلب الجديد", () => {
    expect(parsePageParams("?kind=raw&wh=all")).toEqual({ kind: "raw", wh: "all", wantNew: false });
    expect(parsePageParams("?kind=wip&wh=7&new=1")).toEqual({ kind: "wip", wh: 7, wantNew: true });
  });
  it("نوع غلط = null، ومخزن غلط = all", () => {
    expect(parsePageParams("?kind=zzz").kind).toBeNull();
    expect(parsePageParams("").kind).toBeNull();
    expect(parsePageParams("?kind=raw&wh=-3").wh).toBe("all");
    expect(parsePageParams("?kind=raw&wh=abc").wh).toBe("all");
    expect(parsePageParams("?kind=raw&wh=0").wh).toBe("all");
  });
});

describe("حالة الصنف والعدادات", () => {
  it("out / low / ok", () => {
    expect(whState({ qty: "0", minQty: "5" })).toBe("out");
    expect(whState({ qty: "5", minQty: "5" })).toBe("low");
    expect(whState({ qty: "6", minQty: "5" })).toBe("ok");
    expect(whState({ qty: "6", minQty: "0" })).toBe("ok");
  });
  it("المتاح بدون أخطاء الكسور", () => {
    expect(availOf({ qty: "0.3", reserved: "0.1" })).toBe(0.2);
  });
  it("العداد بيحسب الصنف مرة واحدة حتى لو في أكتر من مخزن", () => {
    const c = stockCounts([row(1), row(1, { warehouseId: 2 }), row(2, { qty: "0" }), row(3, { qty: "4" })]);
    expect(c).toEqual({ items: 3, low: 1, out: 1 });
  });
});

describe("البحث والتصدير", () => {
  it("البحث بالاسم أو المخزن", () => {
    const rows = [row(1), row(2, { warehouseName: "B2" })];
    expect(filterStock(rows, "b2")).toHaveLength(1);
    expect(filterStock(rows, "  ")).toHaveLength(2);
    expect(filterStock(rows, "صنف 1")).toHaveLength(1);
  });
  it("المجمّع بيعرض الأجزاء", () => {
    const r = row(1, { parts: [{ warehouseId: 1, warehouseName: "B1", qty: "30", reserved: "0" }, { warehouseId: 2, warehouseName: "B2", qty: "20", reserved: "5" }] });
    expect(partsText(r, String)).toBe("B1: 30 • B2: 20");
  });
  it("CSV: صف لكل صنف + حماية الصيغ", () => {
    const csv = stockCsv(["a", "b", "c", "d", "e", "f"], [row(1, { itemName: "=cmd" })], "separate");
    expect(csv).toContain("'=cmd");
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(stockCsv(["h"], [row(1, { parts: [{ warehouseId: 1, warehouseName: "B1", qty: "50", reserved: "5" }] })], "combined")).toContain("B1: 50");
  });
});

describe("اختيار المخزن", () => {
  const all = [w(1, "raw", { isDefault: true }), w(2, "raw"), w(3, "raw", { active: false }), w(4, "wip"), w(5, "finished")];
  it("الاستلام: خامات نشطة بس", () => {
    expect(pickOptions(all, "raw").map((x) => x.id)).toEqual([1, 2]);
  });
  it("بيظهر بس لو أكتر من اختيار", () => {
    expect(needsPicker(pickOptions(all, "finished"))).toBe(false);
    expect(needsPicker(pickOptions(all, "raw"))).toBe(true);
  });
  it("قاعدة التصنيف تطابق السيرفر", () => {
    expect(kindsOfCategory("raw_material")).toEqual(["raw", "wip"]);
    expect(kindsOfCategory("wip")).toEqual(["wip"]);
    expect(kindsOfCategory("finished_good")).toEqual(["wip", "finished"]);
    expect(kindsOfCategory("???")).toEqual(["raw"]);
    expect(pickForCategory(all, "finished_good").map((x) => x.id)).toEqual([4, 5]);
  });
});
