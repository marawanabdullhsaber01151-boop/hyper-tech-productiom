import { describe, expect, it } from "vitest";
import { agreedPriceIssue, canCancel, canEdit, canSend, defaultValidUntil, effectiveStatus, nextQuoteNumber, orderRefusal, quoteIssues, quoteTotal } from "./priceQuoteCore";

const ok = { lines: [{ bomRecipeId: 1, qty: "100", unitPrice: "12.50" }], validUntil: "2026-11-30", today: "2026-11-10" };

describe("حالة العرض المعروضة", () => {
  it("المرسل بعد تاريخ الصلاحية = منتهي، وفي يوم الصلاحية نفسه لسه شغال", () => {
    expect(effectiveStatus("sent", "2026-11-09", "2026-11-10")).toBe("expired");
    expect(effectiveStatus("sent", "2026-11-10", "2026-11-10")).toBe("sent");
  });
  it("باقي الحالات زي ما هي حتى بعد الصلاحية", () => {
    expect(effectiveStatus("ordered", "2020-01-01", "2026-11-10")).toBe("ordered");
    expect(effectiveStatus("draft", "2020-01-01", "2026-11-10")).toBe("draft");
    expect(effectiveStatus("???", "2030-01-01", "2026-11-10")).toBe("cancelled");
  });
  it("الصلاحيات حسب الحالة", () => {
    expect(canEdit("draft") && canSend("draft")).toBe(true);
    expect(canEdit("sent") || canSend("sent")).toBe(false);
    expect(canCancel("draft") && canCancel("sent")).toBe(true);
    expect(canCancel("ordered") || canCancel("declined")).toBe(false);
  });
});

describe("تاريخ الصلاحية الافتراضي", () => {
  it("النهارده + الأيام، وقيمة غلط ترجع 14", () => {
    expect(defaultValidUntil("2026-11-10", 14)).toBe("2026-11-24");
    expect(defaultValidUntil("2026-12-25", 10)).toBe("2027-01-04");
    expect(defaultValidUntil("2026-11-10", 0)).toBe("2026-11-24");
    expect(defaultValidUntil("2026-11-10", 9999)).toBe("2026-11-24");
  });
});

describe("تحقق العرض", () => {
  it("عرض سليم", () => expect(quoteIssues(ok)).toEqual([]));
  it("كل المشاكل مرة واحدة", () => {
    const r = quoteIssues({ lines: [{ bomRecipeId: 1, qty: "0", unitPrice: "0" }, { bomRecipeId: 1, qty: "5", unitPrice: "abc" }], validUntil: "2026-02-30", today: "2026-11-10" });
    expect(r.sort()).toEqual(["BAD_DATE", "BAD_PRICE", "BAD_QTY", "DUPLICATE_PRODUCT"]);
  });
  it("من غير سطور، وتاريخ فات، وتاريخ بعيد", () => {
    expect(quoteIssues({ ...ok, lines: [] })).toEqual(["NO_LINES"]);
    expect(quoteIssues({ ...ok, validUntil: "2026-11-09" })).toEqual(["PAST_DATE"]);
    expect(quoteIssues({ ...ok, validUntil: "2027-11-10" })).toEqual([]);
    expect(quoteIssues({ ...ok, validUntil: "2027-11-11" })).toEqual(["TOO_FAR"]);
  });
  it("حد السطور ٥٠", () => {
    const lines = Array.from({ length: 51 }, (_, i) => ({ bomRecipeId: i + 1, qty: "1", unitPrice: "1" }));
    expect(quoteIssues({ ...ok, lines })).toEqual(["TOO_MANY"]);
  });
  it("سعر سالب أو بأكتر من 4 خانات مرفوض", () => {
    expect(quoteIssues({ ...ok, lines: [{ bomRecipeId: 1, qty: "1", unitPrice: "-3" }] })).toEqual(["BAD_PRICE"]);
    expect(quoteIssues({ ...ok, lines: [{ bomRecipeId: 1, qty: "1", unitPrice: "1.23456" }] })).toEqual(["BAD_PRICE"]);
  });
});

describe("الإجمالي", () => {
  it("مجموع السطور المقرّبة بالقرش", () => {
    expect(quoteTotal([{ qty: "100", unitPrice: "12.50" }, { qty: "3", unitPrice: "0.335" }])).toBe("1251.01");
    expect(quoteTotal([])).toBe("0.00");
  });
});

describe("رقم العرض", () => {
  it("بيبدأ من 0001 في الشهر الجديد وبيكمّل", () => {
    const now = new Date("2026-11-10T10:00:00Z");
    expect(nextQuoteNumber(now, null)).toBe("QT-2611-0001");
    expect(nextQuoteNumber(now, "QT-2611-0007")).toBe("QT-2611-0008");
    expect(nextQuoteNumber(now, "QT-2610-0099")).toBe("QT-2611-0001");
  });
});

describe("الطلب من العرض", () => {
  const q = { status: "sent", validUntil: "2026-11-20", portalCustomerId: 5 };
  it("مرسل وشغال لصاحبه = مسموح", () => expect(orderRefusal(q, 5, "2026-11-10")).toBeNull());
  it("عميل تاني أو مفيش = مش موجود", () => {
    expect(orderRefusal(q, 6, "2026-11-10")).toBe("NOT_FOUND");
    expect(orderRefusal(null, 5, "2026-11-10")).toBe("NOT_FOUND");
  });
  it("منتهي أو اتطلب أو مش مرسل", () => {
    expect(orderRefusal(q, 5, "2026-11-21")).toBe("EXPIRED");
    expect(orderRefusal({ ...q, status: "ordered" }, 5, "2026-11-10")).toBe("DONE");
    expect(orderRefusal({ ...q, status: "draft" }, 5, "2026-11-10")).toBe("NOT_SENT");
    expect(orderRefusal({ ...q, status: "cancelled" }, 5, "2026-11-10")).toBe("NOT_SENT");
  });
});

describe("السعر المتفق عليه", () => {
  it("من غير اتفاق = حر، ومع اتفاق لازم يتطابق بالقرش", () => {
    expect(agreedPriceIssue(null, "99")).toBeNull();
    expect(agreedPriceIssue("12.50", "12.5")).toBeNull();
    expect(agreedPriceIssue("12.50", "12.51")).toBe("12.50");
    expect(agreedPriceIssue("12.50", "abc")).toBe("12.50");
  });
});
