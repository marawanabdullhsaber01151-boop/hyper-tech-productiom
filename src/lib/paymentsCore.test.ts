import { describe, expect, it } from "vitest";
import { advanceApplyLines, checkAllocations, fifoAllocate, outstandingCents, parsePaymentAmount, paymentEntryLines, type OpenInvoice } from "./paymentsCore";

const inv = (orderId: number, date: string, total: number, paid = 0): OpenInvoice => ({ orderId, orderNumber: `SO-${orderId}`, date, totalCents: BigInt(total * 100), paidCents: BigInt(paid * 100) });

describe("التوزيع التلقائي (الأقدم الأول)", () => {
  const open = [inv(3, "2026-11-03", 300), inv(1, "2026-11-01", 100), inv(2, "2026-11-02", 200, 50)];
  it("تحصيل جزئي بيتوزّع على الأقدم، وفاتورة بمدفوع سابق بتتحسب بالمتبقي", () => {
    const r = fifoAllocate(open, 20000n);
    expect(r.lines).toEqual([{ orderId: 1, cents: 10000n }, { orderId: 2, cents: 10000n }]);
    expect(r.unallocatedCents).toBe(0n);
  });
  it("أقل من أول فاتورة = تخصيص جزئي لها بس", () => {
    expect(fifoAllocate(open, 4000n).lines).toEqual([{ orderId: 1, cents: 4000n }]);
  });
  it("أكتر من كل المستحق = الباقي دفعة مقدمة", () => {
    const r = fifoAllocate(open, 100000n);
    expect(r.lines.reduce((a, l) => a + l.cents, 0n)).toBe(55000n);
    expect(r.unallocatedCents).toBe(45000n);
  });
  it("مفيش فواتير = كله بدون تخصيص، والمدفوعة بالكامل بتتخطى", () => {
    expect(fifoAllocate([], 500n)).toEqual({ lines: [], unallocatedCents: 500n });
    expect(fifoAllocate([inv(9, "2026-01-01", 100, 100)], 500n).lines).toEqual([]);
    expect(outstandingCents(inv(9, "2026-01-01", 100, 150))).toBe(0n);
  });
  it("التاريخ المتساوي بيترتّب برقم الأمر", () => {
    expect(fifoAllocate([inv(5, "2026-11-01", 10), inv(4, "2026-11-01", 10)], 1000n).lines[0].orderId).toBe(4);
  });
});

describe("فحص التخصيص اليدوي", () => {
  const map = new Map([[1, inv(1, "2026-11-01", 100)], [2, inv(2, "2026-11-02", 200, 150)]]);
  it("سليم", () => {
    expect(checkAllocations([{ orderId: 1, cents: 6000n }, { orderId: 2, cents: 5000n }], map, 11000n)).toEqual([]);
  });
  it("بيكشف كل المشاكل", () => {
    expect(checkAllocations([], map, 100n)).toEqual(["EMPTY"]);
    expect(checkAllocations([{ orderId: 1, cents: 0n }], map, 100n)).toContain("BAD_AMOUNT");
    expect(checkAllocations([{ orderId: 1, cents: 1n }, { orderId: 1, cents: 1n }], map, 100n)).toContain("DUPLICATE_ORDER");
    expect(checkAllocations([{ orderId: 9, cents: 1n }], map, 100n)).toContain("UNKNOWN_ORDER");
    expect(checkAllocations([{ orderId: 2, cents: 5001n }], map, 99999n)).toContain("EXCEEDS_INVOICE");
    expect(checkAllocations([{ orderId: 1, cents: 6000n }], map, 5000n)).toContain("EXCEEDS_PAYMENT");
  });
});

describe("قيد التحصيل", () => {
  const sum = (ls: Array<{ debit?: string; credit?: string }>, k: "debit" | "credit") => ls.reduce((a, l) => a + Math.round(Number(l[k] ?? 0) * 100), 0);
  it("كله مخصّص: مدين خزينة ودائن عملاء بس", () => {
    const l = paymentEntryLines({ cashId: 1, receivableId: 2, advancesId: 3, amountCents: 10000n, allocatedCents: 10000n, memo: "RC-1" });
    expect(l).toHaveLength(2);
    expect(sum(l, "debit")).toBe(sum(l, "credit"));
  });
  it("الباقي دفعة مقدمة، والقيد متوازن", () => {
    const l = paymentEntryLines({ cashId: 1, receivableId: 2, advancesId: 3, amountCents: 10000n, allocatedCents: 6000n, memo: "RC-1" });
    expect(l.find((x) => x.accountId === 3)).toEqual({ accountId: 3, credit: "40.00", memo: "RC-1" });
    expect(sum(l, "debit")).toBe(sum(l, "credit"));
  });
  it("من غير أي تخصيص: كله دفعة مقدمة", () => {
    const l = paymentEntryLines({ cashId: 1, receivableId: 2, advancesId: 3, amountCents: 500n, allocatedCents: 0n, memo: "m" });
    expect(l.map((x) => x.accountId)).toEqual([1, 3]);
  });
  it("تحويل دفعة مقدمة لعملاء", () => {
    expect(advanceApplyLines({ receivableId: 2, advancesId: 3, cents: 4000n, memo: "m" })).toEqual([{ accountId: 3, debit: "40.00", memo: "m" }, { accountId: 2, credit: "40.00", memo: "m" }]);
  });
});

describe("مبلغ التحصيل", () => {
  it("بيقبل الموجب بخانتين، وبيرفض الباقي", () => {
    expect(parsePaymentAmount("1250.50")).toEqual({ ok: true, cents: 125050n });
    for (const bad of ["0", "0.00", "-5", "1.234", "abc", "", "1e3"]) expect(parsePaymentAmount(bad).ok).toBe(false);
  });
});
