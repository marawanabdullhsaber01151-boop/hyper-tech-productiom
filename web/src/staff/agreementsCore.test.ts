import { describe, expect, it } from "vitest";
import { agreementIssues, agreementPayload, agreementTone, emptyAgreement } from "./agreementsCore";
import { summarize } from "./quotesCore";

describe("agreementsCore", () => {
  const ok = { customerId: "5", recipeId: "7", unitPrice: "12.5", validFrom: "2026-11-01", validUntil: "2026-12-31", note: "" };
  it("سليم", () => expect(agreementIssues(ok)).toEqual([]));
  it("فاضي", () => expect(agreementIssues(emptyAgreement("2026-11-10", "2027-11-10"))).toEqual(["customer", "product", "price"]));
  it("ترتيب التواريخ وسعر صفر", () => {
    expect(agreementIssues({ ...ok, validUntil: "2026-10-01" })).toEqual(["order"]);
    expect(agreementIssues({ ...ok, unitPrice: "0" })).toEqual(["price"]);
    expect(agreementIssues({ ...ok, validFrom: "" })).toEqual(["from"]);
  });
  it("الحمولة", () => {
    expect(agreementPayload({ ...ok, note: " x " })).toEqual({ portalCustomerId: 5, bomRecipeId: 7, unitPrice: "12.5", validFrom: "2026-11-01", validUntil: "2026-12-31", note: "x" });
    expect(agreementTone("active")).toBe("success");
  });
});

describe("ملخص تحويل العروض", () => {
  it("بيتجاهل المسودات والملغي وبيحسب النسبة من اللي خلص مصيره", () => {
    const s = summarize([
      { status: "ordered", total: "1000.50" }, { status: "ordered", total: "500" },
      { status: "declined", total: "70" }, { status: "expired", total: "80" },
      { status: "sent", total: "200" }, { status: "draft", total: "9999" }, { status: "cancelled", total: "9999" },
    ]);
    expect(s).toEqual({ open: 1, ordered: 2, declined: 1, expired: 1, conversionPct: 50, orderedValue: 1500.5, openValue: 200 });
  });
  it("من غير نتايج النسبة null", () => {
    expect(summarize([{ status: "sent", total: "10" }]).conversionPct).toBeNull();
    expect(summarize([]).conversionPct).toBeNull();
  });
});
