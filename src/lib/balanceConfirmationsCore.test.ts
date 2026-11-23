import { describe, expect, it } from "vitest";
import {
  MAX_SNAPSHOT_LINES, REPLY_DAYS, addDays, buildSnapshot, canTransition, cancelBodySchema, checkAsOf, directionOf, disputeBodySchema,
  isActive, isOverdue, replyDueDate, requestBodySchema, resolveBodySchema, taskDedupeKey, toPortalView, customerNotice,
  type ConfirmStatus, type ConfirmationRow,
} from "./balanceConfirmationsCore";
import type { Movement } from "./receivablesCore";

const inv = (id: number, date: string, cents: bigint): Movement => ({ kind: "invoice", id, date, number: `INV-${id}`, cents, note: null });
const pay = (id: number, date: string, cents: bigint): Movement => ({ kind: "payment", id, date, number: `PAY-${id}`, cents, note: null });
const num = (s: string) => Math.round(Number(s) * 100);

describe("لقطة الرصيد", () => {
  it("المعادلة: افتتاحي + مدين − دائن = الرصيد", () => {
    const s = buildSnapshot([inv(1, "2026-10-01", 100000n), pay(1, "2026-10-05", 30000n), inv(2, "2026-10-09", 5050n)], "2026-11-01");
    const debit = s.lines.reduce((a, l) => a + num(l.debit), 0);
    const credit = s.lines.reduce((a, l) => a + num(l.credit), 0);
    expect(Number(s.openingCents) + debit - credit).toBe(Number(s.balanceCents));
    expect(s.balanceCents).toBe(75050n);
  });
  it("حركات بعد تاريخ الرصيد مبتدخلش", () => {
    const s = buildSnapshot([inv(1, "2026-10-01", 1000n), inv(2, "2026-11-05", 9999n)], "2026-11-01");
    expect(s.balanceCents).toBe(1000n);
    expect(s.lines).toHaveLength(1);
  });
  it("رصيد سالب (دفعة مقدمة) بيتكتب بعلامة صح من غير تشوه", () => {
    const s = buildSnapshot([inv(1, "2026-10-01", 1000n), pay(1, "2026-10-02", 1150n)], "2026-11-01");
    expect(s.balanceCents).toBe(-150n);
    expect(s.lines[1]!.balance).toBe("-1.50");
    expect(s.lines[1]!.balance).not.toContain(".-");
  });
  it("حركات أقدم من 180 يوم بتتحوّل لرصيد افتتاحي", () => {
    const s = buildSnapshot([inv(1, "2025-01-01", 5000n), inv(2, "2026-10-20", 100n)], "2026-11-01");
    expect(s.openingCents).toBe(5000n);
    expect(s.lines).toHaveLength(1);
    expect(s.balanceCents).toBe(5100n);
  });
  it("أكتر من 300 حركة: بتتقص والمعادلة تفضل صح", () => {
    const ms: Movement[] = [];
    for (let i = 1; i <= MAX_SNAPSHOT_LINES + 25; i++) ms.push(inv(i, "2026-10-15", 100n));
    const s = buildSnapshot(ms, "2026-11-01");
    expect(s.lines).toHaveLength(MAX_SNAPSHOT_LINES);
    const debit = s.lines.reduce((a, l) => a + num(l.debit), 0);
    expect(Number(s.openingCents) + debit).toBe(Number(s.balanceCents));
    expect(s.balanceCents).toBe(BigInt((MAX_SNAPSHOT_LINES + 25) * 100));
  });
  it("مفيش حركات: رصيد صفر", () => {
    const s = buildSnapshot([], "2026-11-01");
    expect(s.balanceCents).toBe(0n);
    expect(s.lines).toEqual([]);
  });
});

describe("التواريخ والمهلة", () => {
  it("addDays بيعدّي الشهور والسنين", () => {
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("المهلة 14 يوم", () => {
    expect(REPLY_DAYS).toBe(14);
    expect(replyDueDate("2026-11-10")).toBe("2026-11-24");
  });
  it("التأخير للطلب المفتوح بس", () => {
    expect(isOverdue("open", "2026-11-01", "2026-11-02")).toBe(true);
    expect(isOverdue("open", "2026-11-02", "2026-11-02")).toBe(false);
    expect(isOverdue("agreed", "2026-11-01", "2026-11-02")).toBe(false);
  });
  it("تاريخ الرصيد: مستقبل ومن أكتر من سنة مرفوضين", () => {
    const f = checkAsOf("2026-11-05", "2026-11-04");
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.code).toBe("FUTURE_DATE");
    const o = checkAsOf("2025-01-01", "2026-11-04");
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.code).toBe("TOO_OLD");
    expect(checkAsOf("2026-11-04", "2026-11-04").ok).toBe(true);
  });
});

describe("الانتقالات", () => {
  const all: ConfirmStatus[] = ["open", "agreed", "disputed", "resolved", "cancelled"];
  it("المسموح بس", () => {
    const ok = new Set(["open>agreed", "open>disputed", "open>cancelled", "disputed>resolved", "disputed>cancelled"]);
    for (const a of all) for (const b of all) expect(canTransition(a, b), `${a}>${b}`).toBe(ok.has(`${a}>${b}`));
  });
  it("النشط: مفتوح أو معترض عليه", () => {
    expect(all.filter(isActive)).toEqual(["open", "disputed"]);
  });
  it("الاتجاه", () => {
    expect([directionOf(1n), directionOf(-1n), directionOf(0n)]).toEqual(["owes", "credit", "zero"]);
  });
});

describe("التحقق من المدخلات", () => {
  it("الطلب: عميل صحيح وتاريخ صحيح", () => {
    expect(requestBodySchema.safeParse({ contactId: 5 }).success).toBe(true);
    expect(requestBodySchema.safeParse({ contactId: 0 }).success).toBe(false);
    expect(requestBodySchema.safeParse({ contactId: 5, asOf: "2026-13-40" }).success).toBe(false);
  });
  it("الاعتراض: سبب 3 حروف على الأقل ورقم اختياري بخانتين", () => {
    expect(disputeBodySchema.safeParse({ note: "ab" }).success).toBe(false);
    expect(disputeBodySchema.safeParse({ note: "فاتورة غلط" }).success).toBe(true);
    expect(disputeBodySchema.safeParse({ note: "فاتورة غلط", amount: "-12.5" }).success).toBe(true);
    for (const amount of ["1.234", "abc", "1e3"]) expect(disputeBodySchema.safeParse({ note: "فاتورة غلط", amount }).success, amount).toBe(false);
  });
  it("القفل والإلغاء بيطلبوا نص", () => {
    expect(resolveBodySchema.safeParse({ note: " " }).success).toBe(false);
    expect(cancelBodySchema.safeParse({ reason: "غلط" }).success).toBe(true);
    expect(cancelBodySchema.safeParse({}).success).toBe(false);
  });
});

const row: ConfirmationRow = {
  id: 1, confirmationNumber: "BC-0001", contactId: 2, portalCustomerId: 3, asOf: "2026-11-01", balance: "-150.50", periodFrom: "2026-05-05", opening: "0.00",
  lines: [], note: null, dueDate: "2026-11-15", requestedByName: "موظف المالية", status: "resolved", respondedByName: "عميل", respondedAt: "x",
  customerAmount: null, customerNote: "غلط", taskId: 77, resolutionNote: "اتراجع", resolvedByName: "مدير", resolvedAt: "y", cancelReason: "سبب داخلي", createdAt: "z",
};
describe("اللي العميل بيشوفه", () => {
  it("مفيش مهمة داخلية ولا اسم موظف ولا سبب إلغاء", () => {
    const v = toPortalView(row, "2026-11-10") as Record<string, unknown>;
    for (const k of ["taskId", "requestedByName", "resolvedByName", "cancelReason", "contactId", "portalCustomerId"]) expect(k in v, k).toBe(false);
    expect(v.direction).toBe("credit");
    expect(v.resolutionNote).toBe("اتراجع");
  });
  it("رد المالية مبيظهرش إلا بعد قفل الاعتراض", () => {
    expect(toPortalView({ ...row, status: "disputed" }, "2026-11-10").resolutionNote).toBeNull();
  });
  it("مفتاح المهمة ثابت والإشعار فيه الرقم", () => {
    expect(taskDedupeKey(9)).toBe("balance_confirmation:9");
    expect(customerNotice("requested", row).body).toContain("BC-0001");
  });
});
