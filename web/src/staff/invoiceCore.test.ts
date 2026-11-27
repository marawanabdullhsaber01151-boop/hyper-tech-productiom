import { describe, expect, it } from "vitest";
import { INVOICEABLE, VERIFY_STATES, isInvoiceable, shortList } from "./invoiceCore";
import { integrityLines } from "./InvoicesPanel";

describe("قواعد الفاتورة في الواجهة", () => {
  it("نفس حالات السيرفر: المعتمد والمشحون والمسدد بس", () => {
    expect([...INVOICEABLE]).toEqual(["confirmed", "shipped", "paid"]);
    for (const s of ["draft", "pending_approval", "cancelled"]) expect(isInvoiceable(s)).toBe(false);
  });
  it("القائمة القصيرة بتقص بعد الحد", () => {
    expect(shortList(["a", "b"])).toBe("a, b");
    expect(shortList(["1", "2", "3", "4", "5", "6", "7"], 3)).toBe("1, 2, 3 +4");
  });
  it("أحكام التحقق الخمسة", () => expect([...VERIFY_STATES]).toEqual(["valid", "tampered", "wrong_token", "unknown", "unverifiable"]));
  it("نص الفحص: سطر لكل نوع مشكلة وفاضي لو سليم", () => {
    const ok = { keyConfigured: true, keyId: "ab", total: 3, ok: true, badSeals: [], otherKey: [], gaps: { missing: [], duplicates: [], malformed: [] } };
    expect(integrityLines(ok)).toEqual([]);
    const bad = { ...ok, ok: false, badSeals: ["INV-000002"], otherKey: ["INV-000001"], gaps: { missing: ["INV-000003"], duplicates: ["INV-000004"], malformed: ["x"] } };
    expect(integrityLines(bad)).toHaveLength(5);
    expect(integrityLines(bad).join(" ")).toContain("INV-000003");
  });
});
