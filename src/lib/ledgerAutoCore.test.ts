import { describe, expect, it } from "vitest";
import { checkAutoPostingChange, isIsoDay, isTracked, revenueDelta, salesEntryLines, salesTargetCents, stockAccountCode, valueReceipt } from "./ledgerAutoCore";
import { lineTotalCents } from "./money";

describe("الإيراد المفروض حسب الحالة", () => {
  it("مؤكد وشُحن ودُفع = الإجمالي، والباقي صفر", () => {
    for (const s of ["confirmed", "shipped", "paid"]) expect(salesTargetCents(s, "1200.50")).toBe(120050n);
    for (const s of ["draft", "pending_approval", "cancelled"]) expect(salesTargetCents(s, "1200.50")).toBe(0n);
  });
});

describe("الفرق (التقارب)", () => {
  it("متساوي = لا قيد، أكبر = فاتورة، أصغر = إشعار دائن", () => {
    expect(revenueDelta(100n, 100n)).toBeNull();
    expect(revenueDelta(150n, 100n)).toEqual({ kind: "invoice", cents: 50n });
    expect(revenueDelta(0n, 100n)).toEqual({ kind: "credit", cents: 100n });
  });
  it("التسلسل مؤكد ← تعديل بنود ← إلغاء بيرجع المسجّل لصفر بالظبط", () => {
    let current = 0n;
    for (const target of [100000n, 120050n, 120050n, 90000n, 0n]) {
      const d = revenueDelta(target, current);
      if (d) current += d.kind === "invoice" ? d.cents : -d.cents;
      expect(current).toBe(target);
    }
  });
});

describe("سطور القيد", () => {
  it("فاتورة: مدين العملاء دائن المبيعات، وإشعار الدائن بالعكس، ومتوازنين", () => {
    const inv = salesEntryLines({ kind: "invoice", cents: 120050n }, 1, 2, "S-1");
    expect(inv).toEqual([{ accountId: 1, debit: "1200.50", memo: "S-1" }, { accountId: 2, credit: "1200.50", memo: "S-1" }]);
    const cr = salesEntryLines({ kind: "credit", cents: 5n }, 1, 2, "S-1");
    expect(cr[0]).toEqual({ accountId: 2, debit: "0.05", memo: "S-1" });
    expect(cr[1]).toEqual({ accountId: 1, credit: "0.05", memo: "S-1" });
  });
});

describe("نطاق التتبّع", () => {
  it("مقفول لو مفيش تاريخ تشغيل، ويتتبّع من التاريخ، والاستمرارية أهم", () => {
    expect(isTracked("2026-11-20", null, true)).toBe(false);
    expect(isTracked("2026-11-19", "2026-11-20", false)).toBe(false);
    expect(isTracked("2026-11-20", "2026-11-20", false)).toBe(true);
    expect(isTracked("2026-11-19", "2026-11-20", true)).toBe(true);
  });
});

describe("قيمة الاستلام", () => {
  it("بتجمّع حسب حساب المخزون وبتتجاهل الصفري، وبتقرّب كل سطر مرة", () => {
    const v = valueReceipt([
      { category: "raw_material", qty: "10", unitPrice: "2.50" },
      { category: "finished_good", qty: "1.5", unitPrice: "3.33" },
      { category: null, qty: "2", unitPrice: "1.00" },
      { category: "raw_material", qty: "5", unitPrice: "0" },
    ], lineTotalCents);
    expect(v.byAccount.get("1150")).toBe(2500n + 200n);
    expect(v.byAccount.get("1170")).toBe(500n);
    expect(v.totalCents).toBe(3200n);
    expect(stockAccountCode("wip")).toBe("1160");
    expect(stockAccountCode("???")).toBe("1150");
  });
});

describe("تاريخ التشغيل", () => {
  it("بيتقفل لو فيه قيود تلقائية، وبيرفض الماضي والتاريخ الغلط", () => {
    expect(checkAutoPostingChange("2026-11-20", "2026-11-14", 3)).toEqual({ ok: false, code: "LOCKED" });
    expect(checkAutoPostingChange("2026-11-01", "2026-11-14", 0)).toEqual({ ok: false, code: "PAST" });
    expect(checkAutoPostingChange("2026-02-30", "2026-11-14", 0)).toEqual({ ok: false, code: "BAD_DATE" });
    expect(checkAutoPostingChange("2026-11-14", "2026-11-14", 0)).toEqual({ ok: true });
    expect(checkAutoPostingChange(null, "2026-11-14", 0)).toEqual({ ok: true });
    expect(isIsoDay("2026-13-01")).toBe(false);
  });
});
