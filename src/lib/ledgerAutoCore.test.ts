import { describe, expect, it } from "vitest";
import { checkAutoPostingChange, cogsEntryLines, isIsoDay, isTracked, reversalFromNet, revenueDelta, salesEntryLines, salesTargetCents, stockAccountCode, valueCogs, valueReceipt, weightedAvgCost } from "./ledgerAutoCore";
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

describe("متوسط التكلفة المرجّح", () => {
  it("أول شراء: السعر نفسه. بعد كده: متوسط مرجّح بـ4 خانات", () => {
    expect(weightedAvgCost("0", "0", "10", "5.00")).toBe("5.0000");
    expect(weightedAvgCost("10", "5.0000", "10", "7.00")).toBe("6.0000");
    expect(weightedAvgCost("3", "10.0000", "1", "11.00")).toBe("10.2500");
    expect(weightedAvgCost("1", "1.0000", "2", "1.00")).toBe("1.0000");
  });
  it("مخزون قديم من غير تكلفة مبيتخلطش: التكلفة بتبدأ من سعر الشراء", () => {
    expect(weightedAvgCost("50", "0", "10", "8.00")).toBe("8.0000");
  });
  it("كمية أو سعر صفر مبيغيّرش المتوسط، وقيمة غلط بتتفشل", () => {
    expect(weightedAvgCost("10", "5.0000", "0", "9.00")).toBe("5.0000");
    expect(weightedAvgCost("10", "5.0000", "4", "0")).toBe("5.0000");
    expect(() => weightedAvgCost("10", "5", "-1", "2")).toThrow();
  });
  it("التقريب نصف لأعلى", () => {
    expect(weightedAvgCost("1", "1.0000", "2", "1.0001")).toBe("1.0001");
    expect(weightedAvgCost("2", "1.0000", "1", "1.0001")).toBe("1.0000");
  });
});

describe("تكلفة البضاعة المباعة", () => {
  const cents = (q: string, p: string) => lineTotalCents(q, p);
  it("بتتجمّع حسب حساب المخزون، والبند من غير تكلفة غير مقيَّم مش صفر", () => {
    const v = valueCogs([
      { category: "finished_good", qty: "10", avgCost: "12.5000" },
      { category: "raw_material", qty: "4", avgCost: "2.2500" },
      { category: "finished_good", qty: "5", avgCost: "0" },
    ], cents);
    expect(v.totalCents).toBe(13400n);
    expect(v.byAccount.get("1170")).toBe(12500n);
    expect(v.byAccount.get("1150")).toBe(900n);
    expect(v.unvalued).toBe(1);
  });
  it("القيد متوازن: مدين 5150 = مجموع دائن المخزون", () => {
    const v = valueCogs([{ category: "finished_good", qty: "3", avgCost: "10.3333" }, { category: "raw_material", qty: "1", avgCost: "0.5000" }], cents);
    const ids = new Map([["1170", 7], ["1150", 8]]);
    const lines = cogsEntryLines(v, 99, ids, "SO-1");
    const d = lines.reduce((a, l) => a + Number(l.debit ?? 0), 0);
    const c = lines.reduce((a, l) => a + Number(l.credit ?? 0), 0);
    expect(Math.round(d * 100)).toBe(Math.round(c * 100));
    expect(lines[0].accountId).toBe(99);
  });
  it("العكس بالظبط: كل حساب بيتقلب، والصفر بيتخطى", () => {
    const lines = reversalFromNet(new Map([[99, 13400n], [7, -12500n], [8, -900n], [5, 0n]]), "SO-1");
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.accountId === 99)).toEqual({ accountId: 99, credit: "134.00", memo: "SO-1" });
    expect(lines.find((l) => l.accountId === 7)).toEqual({ accountId: 7, debit: "125.00", memo: "SO-1" });
  });
});
