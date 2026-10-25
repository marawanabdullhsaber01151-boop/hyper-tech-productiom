import { describe, expect, it } from "vitest";
import { allowedMoves, draftFromNeeds, draftTotal, groupNeeds, lateDays, poCounts, primaryMove, receiptCheck, remaining, toPayload, validateDraft, type Need, type PoRow } from "./purchasingCore";

const need = (id: number, over: Partial<Need> = {}): Need => ({ source: "ops", id, number: `OC-${id}`, inventoryItemId: id * 10, name: `خامة ${id}`, unit: "كجم", qty: "50", reason: null, supplierId: 5, supplierName: "مورد", createdAt: "2026-10-20T00:00:00Z", orderable: true, ...over });
const po = (over: Partial<PoRow> = {}): PoRow => ({ id: 1, poNumber: "PO-000001", supplierId: 5, supplierName: "مورد", status: "approved", expectedDate: null, createdAt: "2026-10-20T00:00:00Z", itemsCount: 1, orderedQty: "10", receivedQty: "0", total: "100", ...over });

describe("انتقالات الأمر حسب الدور", () => {
  it("المشتري يبعت للاعتماد بس، والمعتمد يعتمد من المسودة", () => {
    expect(primaryMove("draft", "buyer")).toBe("pending_approval");
    expect(primaryMove("draft", "purchasing_manager")).toBe("approved");
    expect(primaryMove("pending_approval", "buyer")).toBeNull();
    expect(primaryMove("pending_approval", "chairman")).toBe("approved");
    expect(primaryMove("approved", "buyer")).toBe("sent");
    expect(primaryMove("received", "chairman")).toBeNull();
  });
  it("الإلغاء بعد الاعتماد للمعتمدين بس", () => {
    expect(allowedMoves("approved", "buyer")).toEqual(["sent"]);
    expect(allowedMoves("approved", "chairman")).toEqual(["sent", "cancelled"]);
    expect(allowedMoves("draft", "buyer")).toEqual(["pending_approval", "cancelled"]);
    expect(allowedMoves("???", "chairman")).toEqual([]);
  });
});

describe("الاحتياجات", () => {
  it("بتتجمّع بالمورد، ومن غير مورد في الآخر، وغير القابل للطلب بيتشال", () => {
    const g = groupNeeds([need(1, { supplierId: null, supplierName: null }), need(2), need(3, { supplierId: 6, supplierName: "تاني" }), need(4, { orderable: false, inventoryItemId: null }), need(5)]);
    expect(g.map((x) => x.key)).toEqual(["5", "6", "none"]);
    expect(g[0]!.rows.map((r) => r.id)).toEqual([2, 5]);
  });
  it("المسودة من الاحتياج بتحتفظ بالمصدر", () => {
    const l = draftFromNeeds([need(2, { qty: "12.500" })]);
    expect(l[0]).toMatchObject({ inventoryItemId: "20", qty: "12.5", price: "" });
    expect(l[0]!.requisition).toEqual({ source: "ops", id: 2, number: "OC-2" });
  });
});

describe("مراجعة المسودة", () => {
  const ok = { supplierId: "5", expectedDate: "", notes: "", lines: [{ inventoryItemId: "20", qty: "10", price: "2.5" }] };
  it("مسودة سليمة", () => expect(validateDraft(ok).ok).toBe(true));
  it("بتمسك المورد والبنود والصنف والكمية والسعر والتكرار", () => {
    expect(validateDraft({ ...ok, supplierId: "" }).supplier).toBe(true);
    expect(validateDraft({ ...ok, lines: [] }).items).toBe(true);
    const v = validateDraft({ ...ok, lines: [{ inventoryItemId: "", qty: "1", price: "" }, { inventoryItemId: "3", qty: "0", price: "" }, { inventoryItemId: "4", qty: "1", price: "x" }, { inventoryItemId: "4", qty: "1", price: "" }] });
    expect(v.lines).toEqual(["pick", "qty", "price", "dup"]);
    expect(v.ok).toBe(false);
  });
  it("السعر فاضي مقبول في المسودة (بيتحوّل صفر)", () => {
    expect(validateDraft({ ...ok, lines: [{ inventoryItemId: "20", qty: "1", price: "" }] }).ok).toBe(true);
    expect(toPayload({ ...ok, lines: [{ inventoryItemId: "20", qty: "٣", price: "" }] }).items[0]).toEqual({ inventoryItemId: 20, qty: "3", unitPrice: "0" });
  });
  it("الإجمالي وحمولة الإرسال", () => {
    expect(draftTotal([{ inventoryItemId: "1", qty: "10", price: "2.5" }, { inventoryItemId: "2", qty: "0.5", price: "3" }])).toBe(26.5);
    const p = toPayload({ ...ok, expectedDate: "2026-11-01", notes: " ملحوظة ", lines: [{ ...ok.lines[0]!, requisition: { source: "plan", id: 7, number: "PR-7" } }] });
    expect(p).toEqual({ supplierId: 5, expectedDate: "2026-11-01", notes: "ملحوظة", items: [{ inventoryItemId: 20, qty: "10", unitPrice: "2.5", requisition: { source: "plan", id: 7 } }] });
  });
});

describe("الاستلام", () => {
  const items = [{ id: 1, qty: "100", receivedQty: "30" }, { id: 2, qty: "5", receivedQty: "0" }];
  it("المتبقي", () => {
    expect(remaining(items[0]!)).toBe(70);
    expect(remaining({ qty: "5", receivedQty: "9" })).toBe(0);
  });
  it("بيتجاهل الفاضي ويرفض الأكتر من المتبقي والغلط", () => {
    expect(receiptCheck(items, { 1: "70", 2: "" }).lines).toEqual([{ itemId: 1, qty: "70" }]);
    expect(receiptCheck(items, { 1: "71" }).errors).toEqual({ 1: "over" });
    expect(receiptCheck(items, { 2: "abc" }).errors).toEqual({ 2: "qty" });
    expect(receiptCheck(items, {}).none).toBe(true);
    expect(receiptCheck(items, { 1: "٥" }).lines).toEqual([{ itemId: 1, qty: "5" }]);
  });
});

describe("المؤشرات والتأخير", () => {
  it("التأخير بالأيام للمعتمد والمرسل والجزئي بس", () => {
    expect(lateDays(po({ expectedDate: "2026-10-10" }), "2026-10-20")).toBe(10);
    expect(lateDays(po({ expectedDate: "2026-10-25" }), "2026-10-20")).toBe(0);
    expect(lateDays(po({ status: "draft", expectedDate: "2026-10-10" }), "2026-10-20")).toBe(0);
    expect(lateDays(po({ status: "received", expectedDate: "2026-10-10" }), "2026-10-20")).toBe(0);
  });
  it("العدّادات وقيمة المفتوح", () => {
    const c = poCounts([po({ status: "pending_approval" }), po({ total: "50" }), po({ status: "received" }), po({ status: "sent", expectedDate: "2026-10-01" })], "2026-10-20");
    expect(c).toEqual({ pending: 1, open: 3, late: 1, openValue: 250 });
    expect(poCounts([po({ total: undefined })]).openValue).toBeNull();
  });
});
