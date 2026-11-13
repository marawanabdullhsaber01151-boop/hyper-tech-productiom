import { describe, expect, it } from "vitest";
import { accountTree, emptyForm, formIssues, formatCents, parseCents, postableAccounts, toPayload, totals, type AccountRow, type EntryForm } from "./ledgerCore";

const F = (rows: Array<[string, string, string]>, o: Partial<EntryForm> = {}): EntryForm => ({
  entryDate: "2026-11-12",
  description: "بيع نقدي",
  lines: rows.map(([accountId, debit, credit], i) => ({ key: i + 1, accountId, debit, credit, memo: "" })),
  ...o,
});

describe("المبالغ", () => {
  it("parseCents بيقبل عربي وفاصلة، وبيرفض الغلط", () => {
    expect(parseCents("12.5")).toBe(1250n);
    expect(parseCents("١٢٫٥٠")).toBe(1250n);
    expect(parseCents("")).toBe(0n);
    expect(parseCents("1.005")).toBeNull();
    expect(parseCents("-5")).toBeNull();
    expect(parseCents("abc")).toBeNull();
  });
  it("formatCents", () => {
    expect(formatCents(1250n)).toBe("12.50");
    expect(formatCents(5n)).toBe("0.05");
    expect(formatCents(-1250n)).toBe("-12.50");
  });
});

describe("نموذج القيد", () => {
  it("متوازن = من غير مشاكل", () => {
    expect(formIssues(F([["1", "100", ""], ["2", "", "100.00"]]))).toEqual([]);
  });
  it("الفرق بيتحسب بالقرش من غير كسور عائمة", () => {
    const t = totals(F([["1", "0.10", ""], ["1", "0.20", ""], ["2", "", "0.30"]]));
    expect(t.diff).toBe(0n);
    expect(formIssues(F([["1", "100.01", ""], ["2", "", "100"]]))).toEqual(["unbalanced"]);
  });
  it("كل المشاكل", () => {
    expect(formIssues(F([["", "5", ""], ["2", "", ""]], { description: "ا" })).sort()).toEqual(["account", "desc", "unbalanced", "zero"]);
    expect(formIssues(F([["1", "5", "5"], ["2", "", "x"]]))).toContain("both");
    expect(formIssues(F([["1", "x", ""], ["2", "", "5"]]))).toContain("amount");
    expect(formIssues({ ...F([["1", "5", ""]]) })).toContain("lines");
  });
  it("الـpayload بمبالغ بخانتين وحساب رقم", () => {
    const p = toPayload(F([["1", "100", ""], ["2", "", "100"]]));
    expect(p.lines[0]).toEqual({ accountId: 1, debit: "100.00", credit: "0.00", memo: null });
    expect(emptyForm("2026-01-01").lines).toHaveLength(2);
  });
});

describe("الدليل", () => {
  const A = (id: number, code: string, parentId: number | null, o: Partial<AccountRow> = {}): AccountRow => ({ id, code, name: code, type: "asset", normalSide: "debit", parentId, isPostable: true, isActive: true, isSystem: false, ...o });
  it("شجرة بعمق، والتجميع مش بيتسجّل عليه", () => {
    const rows = [A(3, "1110", 2), A(1, "1000", null, { isPostable: false }), A(2, "1100", 1, { isPostable: false }), A(4, "1120", 2, { isActive: false })];
    expect(accountTree(rows).map((r) => [r.code, r.depth])).toEqual([["1000", 0], ["1100", 1], ["1110", 2], ["1120", 2]]);
    expect(postableAccounts(rows).map((r) => r.code)).toEqual(["1110"]);
  });
});
