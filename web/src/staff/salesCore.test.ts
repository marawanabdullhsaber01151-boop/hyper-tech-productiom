import { describe, expect, it } from "vitest";
import {
  allowedNext, buildCsv, csvCell, dateBounds, draftTotal, isOverdue, lineTotal, normNum, overdueDays, primaryNext,
  stockEffects, suggestOrderNumber, sumTotals, toItemsPayload, validateDraft, validQty, type Draft,
} from "./salesCore";

describe("الانتقالات المسموحة (نفس قواعد السيرفر)", () => {
  it("المسودة تتأكد أو تتشحن أو تتدفع أو تتلغي", () => {
    expect(allowedNext("draft")).toEqual(["confirmed", "shipped", "paid", "cancelled"]);
  });
  it("مفيش رجوع لورا", () => {
    expect(allowedNext("shipped")).toEqual(["paid", "cancelled"]);
    expect(allowedNext("paid")).toEqual(["cancelled"]);
  });
  it("الملغية والمنتظرة الاعتماد مفيهاش انتقالات من هنا", () => {
    expect(allowedNext("cancelled")).toEqual([]);
    expect(allowedNext("pending_approval")).toEqual([]);
    expect(allowedNext("غريبة")).toEqual([]);
  });
  it("الخطوة الأساسية", () => {
    expect(primaryNext("draft")).toBe("confirmed");
    expect(primaryNext("confirmed")).toBe("shipped");
    expect(primaryNext("shipped")).toBe("paid");
    expect(primaryNext("paid")).toBeNull();
    expect(primaryNext("cancelled")).toBeNull();
  });
});

describe("أثر الانتقال على المخزون", () => {
  it("التأكيد بيحجز", () => expect(stockEffects("draft", "confirmed")).toEqual(["reserve"]));
  it("الشحن من مؤكدة بيفك الحجز ويخصم", () => expect(stockEffects("confirmed", "shipped")).toEqual(["release", "deduct"]));
  it("الشحن من مسودة بيحجز ويفك ويخصم", () => expect(stockEffects("draft", "shipped")).toEqual(["reserve", "release", "deduct"]));
  it("الدفع بعد الشحن مفيهوش أثر مخزون", () => expect(stockEffects("shipped", "paid")).toEqual([]));
  it("إلغاء المؤكدة بيفك الحجز، وإلغاء المشحونة بيرجّع", () => {
    expect(stockEffects("confirmed", "cancelled")).toEqual(["release"]);
    expect(stockEffects("shipped", "cancelled")).toEqual(["restore"]);
    expect(stockEffects("paid", "cancelled")).toEqual(["restore"]);
    expect(stockEffects("draft", "cancelled")).toEqual([]);
  });
});

describe("الحسابات بأعداد صحيحة", () => {
  it("إجمالي بند بتقريب نصف لفوق زي السيرفر", () => {
    expect(lineTotal("2", "10.5")).toBe("21.00");
    expect(lineTotal("0.333", "10")).toBe("3.33");
    expect(lineTotal("0.005", "1")).toBe("0.01");
    expect(lineTotal("1.5", "0.01")).toBe("0.02");
  });
  it("قيم غير صالحة", () => {
    expect(lineTotal("abc", "1")).toBeNull();
    expect(lineTotal("1.2345", "1")).toBeNull();
    expect(lineTotal("1", "1.234")).toBeNull();
  });
  it("جمع الإجماليات من غير أخطاء الفاصلة العائمة", () => {
    expect(sumTotals(["0.10", "0.20", null, "1.05"])).toBe("1.35");
  });
  it("الكمية لازم أكبر من صفر", () => {
    expect(validQty("0")).toBe(false);
    expect(validQty("0.000")).toBe(false);
    expect(validQty("0.001")).toBe(true);
    expect(validQty("")).toBe(false);
  });
  it("بيقبل الأرقام العربية والفاصلة", () => {
    expect(normNum("١٢٫٥")).toBe("12.5");
    expect(normNum(" 3,5 ")).toBe("3.5");
  });
});

describe("التواريخ", () => {
  const now = new Date(2026, 9, 23, 12); // 2026-10-23
  it("الفترات", () => {
    expect(dateBounds("all", now)).toEqual({});
    expect(dateBounds("today", now)).toEqual({ from: "2026-10-23", to: "2026-10-23" });
    expect(dateBounds("week", now)).toEqual({ from: "2026-10-17", to: "2026-10-23" });
    expect(dateBounds("month", now)).toEqual({ from: "2026-10-01", to: "2026-10-23" });
    expect(dateBounds("year", now)).toEqual({ from: "2026-01-01", to: "2026-10-23" });
  });
  it("التأخير بس للمؤكدة والمشحونة", () => {
    expect(isOverdue({ status: "confirmed", dueDate: "2026-10-20" }, now)).toBe(true);
    expect(isOverdue({ status: "shipped", dueDate: "2026-10-22" }, now)).toBe(true);
    expect(isOverdue({ status: "shipped", dueDate: "2026-10-23" }, now)).toBe(false);
    expect(isOverdue({ status: "paid", dueDate: "2026-01-01" }, now)).toBe(false);
    expect(isOverdue({ status: "draft", dueDate: "2026-01-01" }, now)).toBe(false);
    expect(isOverdue({ status: "confirmed", dueDate: null }, now)).toBe(false);
    expect(overdueDays({ dueDate: "2026-10-20" }, now)).toBe(3);
    expect(overdueDays({ dueDate: "2026-11-01" }, now)).toBe(0);
  });
  it("رقم الفاتورة المقترح", () => {
    expect(suggestOrderNumber(new Date(2026, 0, 1))).toMatch(/^INV-2026-\d{6}$/);
  });
});

describe("CSV", () => {
  it("بيحمي من الصيغ ويهرّب علامات التنصيص", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("عادي")).toBe("عادي");
  });
  it("BOM وسطور بـ CRLF", () => {
    const c = buildCsv(["a", "b"], [["1", "2"]]);
    expect(c.charCodeAt(0)).toBe(0xfeff);
    expect(c.slice(1)).toBe("a,b\r\n1,2");
  });
});

describe("مسودة الفاتورة", () => {
  const base: Draft = {
    orderNumber: "INV-1",
    date: "2026-10-23",
    dueDate: "",
    rows: [{ kind: "manual", inventoryItemId: null, description: "خدمة", qty: "2", price: "10.5" }],
  };
  it("صالحة", () => expect(validateDraft(base).ok).toBe(true));
  it("لازم بند", () => expect(validateDraft({ ...base, rows: [] }).items).toBe(true));
  it("الاستحقاق قبل التاريخ مرفوض", () => expect(validateDraft({ ...base, dueDate: "2026-10-01" }).due).toBe(true));
  it("أخطاء البنود", () => {
    const v = validateDraft({
      ...base,
      rows: [
        { kind: "stock", inventoryItemId: null, description: "", qty: "1", price: "" },
        { kind: "manual", inventoryItemId: null, description: "", qty: "1", price: "5" },
        { kind: "manual", inventoryItemId: null, description: "س", qty: "0", price: "5" },
        { kind: "manual", inventoryItemId: null, description: "س", qty: "1", price: "0" },
        { kind: "stock", inventoryItemId: 7, description: "صنف", qty: "3", price: "" },
      ],
    });
    expect(v.rows).toEqual(["pick", "desc", "qty", "price", null]);
    expect(v.ok).toBe(false);
  });
  it("بند المخزون ما يحتاجش سعر", () => {
    expect(validateDraft({ ...base, rows: [{ kind: "stock", inventoryItemId: 1, description: "ص", qty: "1", price: "" }] }).ok).toBe(true);
  });
  it("الإجمالي المتوقع جزئي لو سعر المخزون مجهول", () => {
    const r = draftTotal([
      { kind: "manual", inventoryItemId: null, description: "x", qty: "2", price: "10" },
      { kind: "stock", inventoryItemId: 1, description: "y", qty: "1", price: "", catalogPrice: null },
    ]);
    expect(r).toEqual({ total: "20.00", partial: true });
    expect(draftTotal([{ kind: "stock", inventoryItemId: 1, description: "y", qty: "3", price: "", catalogPrice: "4.50" }])).toEqual({ total: "13.50", partial: false });
  });
  it("الـ payload: بنود المخزون بسعر 0 والباقي بإجماليه", () => {
    expect(
      toItemsPayload([
        { kind: "stock", inventoryItemId: 9, description: " كرتونة ", qty: "2", price: "55" },
        { kind: "manual", inventoryItemId: null, description: "نقل", qty: "1,5", price: "10" },
      ]),
    ).toEqual([
      { inventoryItemId: 9, description: "كرتونة", qty: "2", unitPrice: "0", total: "0.00" },
      { inventoryItemId: null, description: "نقل", qty: "1.5", unitPrice: "10", total: "15.00" },
    ]);
  });
});
