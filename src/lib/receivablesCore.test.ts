/** @format */
import { describe, expect, it } from "vitest";
import { ageDays, bucketOf, buildAging, buildStatement, signedDecimal, type AgingInvoice, type Movement } from "./receivablesCore";

describe("أعمار الديون", () => {
  it("العمر بالأيام ومش بيبقى سالب", () => {
    expect(ageDays("2026-10-01", "2026-10-31")).toBe(30);
    expect(ageDays("2026-11-20", "2026-11-15")).toBe(0);
  });
  it("حدود الشرايح", () => {
    expect([0, 30, 31, 60, 61, 90, 91, 400].map(bucketOf)).toEqual(["b0", "b0", "b30", "b30", "b60", "b60", "b90", "b90"]);
  });
  it("بيجمّع لكل عميل ويتخطى المسدّد ويرتّب بالأكبر", () => {
    const inv = (contactId: number, orderId: number, date: string, c: number): AgingInvoice => ({ contactId, contactName: `C${contactId}`, orderId, orderNumber: `S${orderId}`, date, outstandingCents: BigInt(c) });
    const r = buildAging([inv(1, 1, "2026-11-10", 10000), inv(1, 2, "2026-08-01", 5000), inv(2, 3, "2026-11-01", 20000), inv(2, 4, "2026-09-01", 0), inv(3, 5, "2026-01-01", -100)], "2026-11-15");
    expect(r.rows.map((x) => x.contactId)).toEqual([2, 1]);
    expect(r.rows[1]!.buckets).toEqual({ b0: 10000n, b30: 0n, b60: 0n, b90: 5000n });
    expect(r.rows[1]!.oldestDays).toBe(106);
    expect(r.totalCents).toBe(35000n);
    expect(r.totals.b0).toBe(30000n);
  });
});

describe("كشف الحساب", () => {
  const m = (kind: "invoice" | "payment", id: number, date: string, c: number): Movement => ({ kind, id, date, number: `${kind}${id}`, cents: BigInt(c), note: null });
  const moves = [m("payment", 1, "2026-10-05", 3000), m("invoice", 1, "2026-10-01", 10000), m("invoice", 2, "2026-10-05", 2000), m("payment", 2, "2026-11-01", 9000)];
  it("بيرتّب ويحسب الرصيد الجاري (فاتورة قبل تحصيل في نفس اليوم)", () => {
    const s = buildStatement(moves, null, null);
    expect(s.lines.map((l) => l.number)).toEqual(["invoice1", "invoice2", "payment1", "payment2"]);
    expect(s.lines.map((l) => l.balanceCents)).toEqual([10000n, 12000n, 9000n, 0n]);
    expect(s.closingCents).toBe(0n);
    expect(s.debitCents).toBe(12000n);
    expect(s.creditCents).toBe(12000n);
  });
  it("رصيد أول المدة من الحركات قبل «من»، والحركات بعد «إلى» بره", () => {
    const s = buildStatement(moves, "2026-10-05", "2026-10-31");
    expect(s.openingCents).toBe(10000n);
    expect(s.lines.map((l) => l.number)).toEqual(["invoice2", "payment1"]);
    expect(s.closingCents).toBe(9000n);
  });
  it("تحصيل أكبر من المديونية = رصيد سالب (للعميل)", () => {
    const s = buildStatement([m("invoice", 1, "2026-10-01", 1000), m("payment", 1, "2026-10-02", 2500)], null, null);
    expect(s.closingCents).toBe(-1500n);
    expect(signedDecimal(s.closingCents)).toBe("-15.00");
  });
  it("صيغة الأرقام والتواريخ", () => {
    expect(signedDecimal(5n)).toBe("0.05");
  });
});
