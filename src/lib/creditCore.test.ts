/** @format */
import { describe, expect, it } from "vitest";
import { becomesReceivable, buildCreditOverview, creditPolicyOf, evaluateCredit, isReceivableStatus, netDebtCents, parseCreditLimit, storedLimitCents } from "./creditCore";

const base = { policy: "block" as const, limitCents: 100_000n, outstandingCents: 60_000n, advanceCents: 0n, orderCents: 30_000n };

describe("تقييم الائتمان", () => {
  it("تحت الحد: مسموح والمتاح بيتحسب", () => {
    const v = evaluateCredit(base);
    expect(v).toMatchObject({ status: "ok", action: "allow", exposureCents: 90_000n, overByCents: 0n, availableCents: 10_000n });
  });
  it("بالظبط على الحد مش تجاوز", () => {
    expect(evaluateCredit({ ...base, orderCents: 40_000n }).status).toBe("ok");
  });
  it("فوق الحد: block = اعتماد، warn = تحذير، off = مسموح", () => {
    const o = { ...base, orderCents: 50_000n };
    expect(evaluateCredit(o)).toMatchObject({ status: "over", action: "approval", overByCents: 10_000n, availableCents: 0n });
    expect(evaluateCredit({ ...o, policy: "warn" }).action).toBe("warn");
    expect(evaluateCredit({ ...o, policy: "off" }).action).toBe("allow");
  });
  it("مفيش حد (null أو صفر) = من غير قيود مهما كانت المديونية", () => {
    expect(evaluateCredit({ ...base, limitCents: null, orderCents: 9_999_999n })).toMatchObject({ status: "none", action: "allow", limitCents: null });
    expect(evaluateCredit({ ...base, limitCents: 0n }).status).toBe("none");
  });
  it("الدفعة المقدمة بتخصم من الدين، بس ما بتخليش التعرّض سالب", () => {
    expect(evaluateCredit({ ...base, advanceCents: 50_000n }).exposureCents).toBe(40_000n);
    expect(evaluateCredit({ ...base, advanceCents: 900_000n }).exposureCents).toBe(30_000n);
    expect(netDebtCents(0n, 5n)).toBe(0n);
    expect(netDebtCents(-100n, 0n)).toBe(0n);
  });
  it("مبلغ أمر سالب أو صفر مش بينقّص التعرّض", () => {
    expect(evaluateCredit({ ...base, orderCents: -500n }).exposureCents).toBe(60_000n);
  });
  it("أمر لوحده أكبر من الحد والعميل مفيش عليه دين = تجاوز", () => {
    expect(evaluateCredit({ ...base, outstandingCents: 0n, orderCents: 100_001n }).status).toBe("over");
  });
});

describe("قراية وفحص الحد", () => {
  it("فاضي/null = شيل الحد", () => {
    expect(parseCreditLimit(null)).toEqual({ ok: true, cents: null });
    expect(parseCreditLimit("  ")).toEqual({ ok: true, cents: null });
  });
  it("أرقام صحيحة", () => {
    expect(parseCreditLimit("1500")).toEqual({ ok: true, cents: 150_000n });
    expect(parseCreditLimit("0.5")).toEqual({ ok: true, cents: 50n });
    expect(parseCreditLimit("99.99")).toEqual({ ok: true, cents: 9_999n });
  });
  it("صفر وسالب وحروف وكسور أكتر من خانتين وأرقام ضخمة بتترفض", () => {
    for (const bad of ["0", "0.00", "-5", "abc", "1.234", "1e5", "1,000", "9999999999999"]) expect(parseCreditLimit(bad).ok).toBe(false);
  });
  it("الحد المخزّن: صفر/فاضي/تالف = مفيش حد", () => {
    expect(storedLimitCents("2500.00")).toBe(250_000n);
    expect(storedLimitCents("0.00")).toBeNull();
    expect(storedLimitCents(null)).toBeNull();
    expect(storedLimitCents("x")).toBeNull();
    expect(storedLimitCents("12.5")).toBe(1_250n);
  });
});

describe("السياسة والانتقالات", () => {
  it("سياسة تالفة = تحذير", () => {
    expect(creditPolicyOf("block")).toBe("block");
    expect(creditPolicyOf("zzz")).toBe("warn");
    expect(creditPolicyOf(undefined)).toBe("warn");
  });
  it("الفحص بيحصل بس لما الأمر يبقى مديونية جديدة", () => {
    expect(becomesReceivable("draft", "confirmed")).toBe(true);
    expect(becomesReceivable("draft", "shipped")).toBe(true);
    expect(becomesReceivable("pending_approval", "confirmed")).toBe(true);
    expect(becomesReceivable("confirmed", "shipped")).toBe(false);
    expect(becomesReceivable("shipped", "paid")).toBe(false);
    expect(becomesReceivable("draft", "cancelled")).toBe(false);
    expect(isReceivableStatus("confirmed")).toBe(true);
    expect(isReceivableStatus("paid")).toBe(false);
  });
});

describe("نظرة الائتمان لكل العملاء", () => {
  const inv = (contactId: number, c: number) => ({ contactId, contactName: `C${contactId}`, outstandingCents: BigInt(c) });
  it("بيجمّع الدين، وبيعلّم المتجاوز، وبيرتّب الأكتر تجاوزًا الأول", () => {
    const rows = buildCreditOverview({
      invoices: [inv(1, 5000), inv(1, 3000), inv(2, 20_000), inv(3, 1000)],
      advances: new Map([[3, 5000n]]),
      limits: new Map([[1, { name: "A", limitCents: 10_000n }], [2, { name: "B", limitCents: 15_000n }], [3, { name: "C", limitCents: 2000n }], [4, { name: "D", limitCents: 9000n }]]),
    });
    expect(rows.map((r) => r.contactId)).toEqual([2, 1, 3, 4]);
    expect(rows[0]).toMatchObject({ over: true, overByCents: 5000n, availableCents: 0n, debtCents: 20_000n });
    expect(rows[1]).toMatchObject({ over: false, debtCents: 8000n, availableCents: 2000n });
    expect(rows[2]).toMatchObject({ over: false, debtCents: 0n, availableCents: 2000n });
    expect(rows[3]).toMatchObject({ debtCents: 0n, availableCents: 9000n });
  });
  it("عميل عليه دين وغير محدد له حد بيظهر من غير متاح ومش متجاوز", () => {
    const rows = buildCreditOverview({ invoices: [inv(9, 700)], advances: new Map(), limits: new Map() });
    expect(rows).toEqual([{ contactId: 9, contactName: "C9", limitCents: null, debtCents: 700n, availableCents: null, over: false, overByCents: 0n }]);
  });
  it("فاتورة مسدّدة بالزيادة ما بتخصمش من دين فاتورة تانية، وحد صفر مفيش", () => {
    const rows = buildCreditOverview({ invoices: [inv(1, -500), inv(1, 100)], advances: new Map(), limits: new Map([[1, { name: "A", limitCents: null }]]) });
    expect(rows[0]!.debtCents).toBe(100n);
    expect(rows[0]!.limitCents).toBeNull();
  });
  it("لا حد ولا دين = مفيش صف", () => {
    expect(buildCreditOverview({ invoices: [], advances: new Map(), limits: new Map([[1, { name: "A", limitCents: null }]]) })).toEqual([]);
  });
});
