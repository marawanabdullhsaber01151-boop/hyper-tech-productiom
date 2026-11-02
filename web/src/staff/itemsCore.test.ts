import { describe, expect, it } from "vitest";
import {
  canApproveItem, changedFields, conversionError, conversionPayload, criticalChanged, exportCsv, filterItems, itemError, itemPayload, itemStats, itemToForm, needsChangeRequest, parseImport, pendingDiff, splitDelimited,
  type ItemRow,
} from "./itemsCore";

const item = (p: Partial<ItemRow> = {}): ItemRow => ({
  id: 1, code: "RM-1", name: "رصاص", itemType: "raw_material", baseUnit: "kg", active: true, lotTracked: true, serialTracked: false, shelfLifeDays: null, minStock: "10.000", notes: null,
  status: "active", version: 1, pendingChangePayload: null, pendingChangeReason: null, pendingChangeRequestedByName: null, pendingChangeRequestedAt: null, ...p,
});

describe("itemsCore: الأدوار والإحصائيات والتصفية", () => {
  it("اعتماد التغيير الحرج لـ3 أدوار بس", () => {
    expect(canApproveItem("operations_manager")).toBe(true);
    expect(canApproveItem("warehouse_manager")).toBe(false);
  });
  it("الإحصائيات والتصفية", () => {
    const rows = [item(), item({ id: 2, code: "FG-1", name: "بطارية", itemType: "finished_good", status: "pending_approval" }), item({ id: 3, code: "X", name: "قديم", status: "retired", active: false })];
    expect(itemStats(rows)).toEqual({ total: 3, active: 1, pending: 1, draft: 0, retired: 1 });
    expect(filterItems(rows, "بطار", "all", "").map((r) => r.id)).toEqual([2]);
    expect(filterItems(rows, "", "retired", "").map((r) => r.id)).toEqual([3]);
    expect(filterItems(rows, "", "all", "raw_material").map((r) => r.id)).toEqual([1, 3]);
  });
});

describe("itemsCore: النموذج والتغييرات الحرجة", () => {
  it("أخطاء النموذج", () => {
    const f = itemToForm(item());
    expect(itemError(f)).toBeNull();
    expect(itemError({ ...f, code: " " })).toBe("code");
    expect(itemError({ ...f, baseUnit: "" })).toBe("unit");
    expect(itemError({ ...f, minStock: "1.2345" })).toBe("minStock");
    expect(itemError({ ...f, shelfLifeDays: "0" })).toBe("shelf");
    expect(itemPayload({ ...f, minStock: "١٢٫٥", shelfLifeDays: "٣٠" })).toMatchObject({ minStock: "12.5", shelfLifeDays: 30 });
  });
  it("الاسم فقط = تعديل مباشر، والوحدة = طلب تغيير", () => {
    const f = itemToForm(item());
    const nameOnly = changedFields(item(), itemPayload({ ...f, name: "رصاص نقي" }));
    expect(nameOnly).toEqual({ name: "رصاص نقي" });
    expect(needsChangeRequest(item(), nameOnly)).toBe(false);
    const unit = changedFields(item(), itemPayload({ ...f, baseUnit: "طن" }));
    expect(criticalChanged(unit)).toEqual(["baseUnit"]);
    expect(needsChangeRequest(item(), unit)).toBe(true);
    expect(needsChangeRequest(item({ status: "draft" }), unit)).toBe(false);
  });
  it("الحد الأدنى بنفس القيمة بصيغة تانية مش تغيير", () => {
    expect(changedFields(item(), itemPayload({ ...itemToForm(item()), minStock: "10" }))).toEqual({});
  });
  it("عرض الفرق للمعتمِد بيتجاهل غير المتغيّر", () => {
    const d = pendingDiff(item({ status: "pending_approval", pendingChangePayload: { baseUnit: "طن", name: "رصاص" } }));
    expect(d).toEqual([{ field: "baseUnit", from: "kg", to: "طن" }]);
  });
});

describe("itemsCore: تحويلات الوحدات", () => {
  it("أخطاء وصياغة", () => {
    expect(conversionError({ fromUnit: "طن", toUnit: "kg", factor: "1000" })).toBeNull();
    expect(conversionError({ fromUnit: "kg", toUnit: "kg", factor: "1" })).toBe("same");
    expect(conversionError({ fromUnit: "kg", toUnit: "g", factor: "0" })).toBe("factor");
    expect(conversionError({ fromUnit: "kg", toUnit: "g", factor: "1.123456789" })).toBe("factor");
    expect(conversionPayload({ fromUnit: " kg ", toUnit: "g", factor: "١٠٠٠" })).toEqual({ fromUnit: "kg", toUnit: "g", factor: "1000" });
  });
});

describe("itemsCore: الاستيراد والتصدير", () => {
  it("CSV بعناوين إنجليزي، وجدول إكسل بتاب وعناوين عربي، ونوع بالعربي", () => {
    expect(parseImport("code,name,baseUnit,minStock\nA1,\"اسم, بفاصلة\",kg,5").rows).toEqual([{ code: "A1", name: "اسم, بفاصلة", baseUnit: "kg", minStock: "5" }]);
    const tab = parseImport("الكود\tالاسم\tالوحدة\tالنوع\tالحد الأدنى\nB1\tحمض\tلتر\tخامة\t١٫٥");
    expect(tab.rows).toEqual([{ code: "B1", name: "حمض", baseUnit: "لتر", itemType: "raw_material", minStock: "1.5" }]);
  });
  it("JSON والأخطاء", () => {
    expect(parseImport('[{"code":"A","name":"ب","baseUnit":"kg"}]').rows.length).toBe(1);
    expect(parseImport("[oops").error).toBe("json");
    expect(parseImport("").error).toBe("empty");
    expect(parseImport("a,b\n1,2").error).toBe("headers");
    expect(parseImport(`code,name,baseUnit\n${Array.from({ length: 501 }, (_, i) => `C${i},n,kg`).join("\n")}`).error).toBe("tooMany");
  });
  it("تقسيم الاقتباس والأسطر", () => {
    expect(splitDelimited('a,"b ""q"" c"\r\nd,e')).toEqual([["a", 'b "q" c'], ["d", "e"]]);
  });
  it("التصدير بـBOM وبيعمل escape", () => {
    const csv = exportCsv([item({ name: 'اسم "x", y' })]);
    expect(csv.startsWith("﻿code,name")).toBe(true);
    expect(csv).toContain('"اسم ""x"", y"');
  });
});
