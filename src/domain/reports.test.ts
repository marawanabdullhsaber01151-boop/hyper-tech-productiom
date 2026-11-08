import { describe, expect, it } from "vitest";
import { columnsOf, csvRows, exportFileName, inventoryReport, isReportId, needsRange, pct, purchasesReport, reportsFor, salesReport, stockStateOf, totalLabel } from "./reports";

describe("الأدوار والتعريفات", () => {
  it("كل دور بيشوف تقارير قسمه والإدارة العليا بتشوف الكل", () => {
    expect(reportsFor("chairman")).toEqual(["sales", "inventory", "purchases"]);
    expect(reportsFor("executive_manager")).toEqual(["sales", "inventory", "purchases"]);
    expect(reportsFor("sales_manager")).toEqual(["sales"]);
    expect(reportsFor("warehouse_manager")).toEqual(["inventory"]);
    expect(reportsFor("purchasing_manager")).toEqual(["purchases"]);
    expect(reportsFor("storekeeper")).toEqual([]);
  });
  it("المعرّفات والفترة", () => {
    expect(isReportId("sales")).toBe(true);
    expect(isReportId("x")).toBe(false);
    expect(needsRange("inventory")).toBe(false);
    expect(needsRange("sales")).toBe(true);
  });
  it("اسم الملف ASCII وفيه الفترة", () => {
    expect(exportFileName("sales", "2026-11-01", "2026-11-07", "xlsx")).toBe("report-sales_2026-11-01_2026-11-07.xlsx");
    expect(exportFileName("inventory", null, null, "csv")).toBe("report-inventory.csv");
  });
});

describe("تقرير المبيعات (بيانات معروفة)", () => {
  const raw = [
    { orderNumber: "S-1", date: "2026-11-01", customer: "شركة أ", channel: "direct", status: "confirmed", subtotal: "100.10", total: "110.11" },
    { orderNumber: "S-2", date: "2026-11-02", customer: null, channel: "website", status: "paid", subtotal: null, total: "0.10" },
    { orderNumber: "S-3", date: "2026-11-03", customer: "ب", channel: "direct", status: "shipped", subtotal: "0.10", total: "0.20" },
  ];
  it("الإجماليات بالقروش من غير خطأ العشري العائم", () => {
    const r = salesReport(raw);
    expect(r.rows).toHaveLength(3);
    expect(r.totals[0]).toBe(totalLabel(3));
    expect(r.totals[5]).toBe("100.20");
    expect(r.totals[6]).toBe("110.41");
    expect(r.totals).toHaveLength(r.columns.length);
    expect(r.rows[0]).toEqual(["S-1", "2026-11-01", "شركة أ", "مباشر", "مؤكدة", "100.10", "110.11"]);
    expect(r.rows[1]![2]).toBe("—");
    expect(r.rows[1]![3]).toBe("الموقع");
  });
  it("قيمة فاسدة بتتحسب صفر ومبتكسرش التقرير", () => {
    const r = salesReport([{ ...raw[0]!, total: "abc" }]);
    expect(r.totals[6]).toBe("0.00");
  });
  it("تقرير فاضي", () => {
    const r = salesReport([]);
    expect(r.rows).toEqual([]);
    expect(r.totals[6]).toBe("0.00");
  });
});

describe("تقرير المخزون (بيانات معروفة)", () => {
  const raw = [
    { code: "A1", name: "سكر", category: "raw_material", unit: "كجم", qty: "10.5", reservedQty: "1", minQty: "5", unitPrice: "2.10" },
    { code: null, name: "علبة", category: "wip", unit: null, qty: "0", reservedQty: null, minQty: "5", unitPrice: "9.99" },
    { code: "C3", name: "كرتونة", category: "raw_material", unit: "قطعة", qty: "3", reservedQty: "0", minQty: "5", unitPrice: "1.00" },
    { code: "D4", name: "سالب", category: "finished_good", unit: "قطعة", qty: "-2", reservedQty: "0", minQty: null, unitPrice: "5.00" },
  ];
  it("القيمة = الكمية × السعر، والسالب والصفر قيمتهم صفر", () => {
    const r = inventoryReport(raw);
    expect(r.rows[0]![8]).toBe("22.05");
    expect(r.rows[1]![8]).toBe("0.00");
    expect(r.rows[3]![8]).toBe("0.00");
    expect(r.totals[8]).toBe("25.05");
    expect(r.totals[4]).toBe(11.5);
    expect(r.totals).toHaveLength(r.columns.length);
  });
  it("حالة الصنف: نافد / تحت الحد / كافي", () => {
    expect(stockStateOf("0", "5")).toBe("out");
    expect(stockStateOf("-1", null)).toBe("out");
    expect(stockStateOf("5", "5")).toBe("low");
    expect(stockStateOf("6", "5")).toBe("ok");
    expect(stockStateOf("1", null)).toBe("ok");
    expect(stockStateOf("1", "0")).toBe("ok");
  });
  it("عدد الأصناف اللي محتاجة متابعة في الإجماليات", () => {
    expect(inventoryReport(raw).totals[9]).toBe("3 يحتاج متابعة");
    expect(inventoryReport([raw[0]!]).totals[9]).toBe(null);
  });
  it("الفئة والكود والوحدة الفاضية", () => {
    const r = inventoryReport(raw);
    expect(r.rows[1]!.slice(0, 4)).toEqual(["—", "علبة", "تحت التصنيع", "—"]);
  });
});

describe("تقرير المشتريات (بيانات معروفة)", () => {
  it("نسبة الاستلام محدودة بـ100 وصفر لو مفيش مطلوب", () => {
    expect(pct(4000n, 10000n)).toBe(40);
    expect(pct(5000n, 3000n)).toBe(100);
    expect(pct(1n, 0n)).toBe(0);
  });
  it("الإجماليات", () => {
    const r = purchasesReport([
      { poNumber: "P-1", date: "2026-11-01", supplier: "مورد", status: "partially_received", orderedQty: "10", receivedQty: "4", total: "100.50" },
      { poNumber: "P-2", date: "2026-11-02", supplier: null, status: "received", orderedQty: "3", receivedQty: "5", total: "20.25" },
      { poNumber: "P-3", date: "2026-11-03", supplier: "م", status: "approved", orderedQty: "0", receivedQty: "0", total: "0" },
    ]);
    expect(r.rows.map((x) => x[6])).toEqual([40, 100, 0]);
    expect(r.totals[4]).toBe(13);
    expect(r.totals[5]).toBe(9);
    expect(r.totals[6]).toBe(69);
    expect(r.totals[7]).toBe("120.75");
    expect(r.rows[0]![3]).toBe("استلام جزئي");
    expect(r.totals).toHaveLength(columnsOf("purchases").length);
  });
  it("CSV: العناوين ثم الصفوف ثم الإجماليات", () => {
    const r = purchasesReport([]);
    const rows = csvRows(r);
    expect(rows).toHaveLength(2);
    expect(rows[0]![0]).toBe("رقم الأمر");
  });
});
