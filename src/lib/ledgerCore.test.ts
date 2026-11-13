import { describe, expect, it } from "vitest";
import { accountIssues, checkEntry, fiscalYearLabel, nextEntryNumber, normalSideOf, periodOf, reverseLines, trialBalance, type AccountLite } from "./ledgerCore";

const A = (id: number, o: Partial<AccountLite> = {}): AccountLite => ({ id, code: String(1000 + id), name: "حساب", type: "asset", normalSide: "debit", isPostable: true, isActive: true, ...o });
const accts = new Map<number, AccountLite>([[1, A(1)], [2, A(2, { type: "revenue", normalSide: "credit" })], [3, A(3, { isPostable: false })], [4, A(4, { isActive: false })]]);
const E = (lines: Array<[number, string, string]>, o: { entryDate?: string; description?: string } = {}) => ({
  entryDate: o.entryDate ?? "2026-11-12",
  description: o.description ?? "بيع نقدي",
  lines: lines.map(([accountId, debit, credit]) => ({ accountId, debit, credit })),
});

describe("القيد", () => {
  it("متوازن وصحيح", () => {
    const r = checkEntry(E([[1, "100.50", ""], [2, "", "100.50"]]), accts);
    expect(r.issues).toEqual([]);
    expect(r.total).toBe("100.50");
  });
  it("غير متوازن بقرش واحد مرفوض", () => {
    expect(checkEntry(E([[1, "100.01", ""], [2, "", "100.00"]]), accts).issues).toContain("UNBALANCED");
  });
  it("جمع الكسور من غير أخطاء الفاصلة العائمة", () => {
    const r = checkEntry(E([[1, "0.10", ""], [1, "0.20", ""], [2, "", "0.30"]]), accts);
    expect(r.issues).toEqual([]);
  });
  it("سطر واحد، سطر من غير مبلغ، سطر بالجانبين، مبلغ سالب أو بأكتر من خانتين", () => {
    expect(checkEntry(E([[1, "5", ""]]), accts).issues).toContain("TOO_FEW_LINES");
    expect(checkEntry(E([[1, "0", ""], [2, "", "0"]]), accts).issues).toContain("LINE_ZERO");
    expect(checkEntry(E([[1, "5", "5"], [2, "", "0"]]), accts).issues).toContain("LINE_BOTH_SIDES");
    expect(checkEntry(E([[1, "-5", ""], [2, "", "5"]]), accts).issues).toContain("BAD_AMOUNT");
    expect(checkEntry(E([[1, "1.005", ""], [2, "", "1.005"]]), accts).issues).toContain("BAD_AMOUNT");
  });
  it("الحسابات: مجهول، رئيسي، موقوف", () => {
    expect(checkEntry(E([[99, "5", ""], [2, "", "5"]]), accts).issues).toContain("ACCOUNT_UNKNOWN");
    expect(checkEntry(E([[3, "5", ""], [2, "", "5"]]), accts).issues).toContain("ACCOUNT_NOT_POSTABLE");
    expect(checkEntry(E([[4, "5", ""], [2, "", "5"]]), accts).issues).toContain("ACCOUNT_INACTIVE");
  });
  it("تاريخ وبيان", () => {
    expect(checkEntry(E([[1, "5", ""], [2, "", "5"]], { entryDate: "2026-02-30" }), accts).issues).toContain("BAD_DATE");
    expect(checkEntry(E([[1, "5", ""], [2, "", "5"]], { description: " " }), accts).issues).toContain("NO_DESCRIPTION");
  });
  it("العكسي بيبدّل الجانبين", () => {
    expect(reverseLines([{ debit: "5.00", credit: "0.00" }])).toEqual([{ debit: "0.00", credit: "5.00" }]);
  });
});

describe("الفترات والسنة المالية", () => {
  it("الفترة شهر ميلادي بآخر يوم صح", () => {
    expect(periodOf("2026-02-10")).toEqual({ year: 2026, month: 2, startsOn: "2026-02-01", endsOn: "2026-02-28" });
    expect(periodOf("2028-02-10").endsOn).toBe("2028-02-29");
  });
  it("تسمية السنة المالية", () => {
    expect(fiscalYearLabel("2026-11-12", 1)).toBe("2026");
    expect(fiscalYearLabel("2026-11-12", 7)).toBe("2026/2027");
    expect(fiscalYearLabel("2026-03-12", 7)).toBe("2025/2026");
  });
  it("رقم القيد بيكمّل جوه الشهر ويبدأ من أول مع شهر جديد", () => {
    expect(nextEntryNumber("2026-11-12", null)).toBe("JV-2611-0001");
    expect(nextEntryNumber("2026-11-30", "JV-2611-0009")).toBe("JV-2611-0010");
    expect(nextEntryNumber("2026-12-01", "JV-2611-0009")).toBe("JV-2612-0001");
  });
});

describe("الدليل وميزان المراجعة", () => {
  it("جانب النوع الطبيعي", () => {
    expect(normalSideOf("asset")).toBe("debit");
    expect(normalSideOf("revenue")).toBe("credit");
  });
  it("مشاكل الحساب", () => {
    expect(accountIssues({ code: "12", name: "ا", type: "asset" }, null).sort()).toEqual(["BAD_CODE", "BAD_NAME"]);
    expect(accountIssues({ code: "1111", name: "نقدية", type: "asset" }, { type: "liability", isPostable: false })).toEqual(["PARENT_TYPE"]);
    expect(accountIssues({ code: "1111", name: "نقدية", type: "asset" }, { type: "asset", isPostable: true })).toEqual(["PARENT_POSTABLE"]);
  });
  it("الميزان بيتساوى لو القيود متوازنة، ويشيل الحسابات الفاضية", () => {
    const tb = trialBalance([
      { accountId: 1, code: "1110", name: "خزينة", type: "asset", normalSide: "debit", debit: "150.00", credit: "50.00" },
      { accountId: 2, code: "4100", name: "مبيعات", type: "revenue", normalSide: "credit", debit: "0", credit: "100.00" },
      { accountId: 3, code: "5100", name: "x", type: "expense", normalSide: "debit", debit: "0", credit: "0" },
    ]);
    expect(tb.rows.map((r) => r.code)).toEqual(["1110", "4100"]);
    expect(tb.rows[0]!.balanceDebit).toBe("100.00");
    expect(tb.rows[1]!.balanceCredit).toBe("100.00");
    expect(tb.balanced).toBe(true);
  });
  it("لو في خلل بيطلع balanced=false", () => {
    expect(trialBalance([{ accountId: 1, code: "1", name: "x", type: "asset", normalSide: "debit", debit: "10", credit: "0" }]).balanced).toBe(false);
  });
});
