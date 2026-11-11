import { describe, expect, it } from "vitest";
import { agreementIssues, agreementShown, overlaps, pickAgreement, sendBlocked } from "./priceAgreementCore";

const A = (o: Partial<{ id: number; bomRecipeId: number; status: string; validFrom: string; validUntil: string }> = {}) => ({ id: 1, bomRecipeId: 7, status: "active", validFrom: "2026-11-01", validUntil: "2026-12-31", ...o });

describe("حالة الاتفاقية", () => {
  it("شغالة، قادمة، منتهية، مقفولة", () => {
    expect(agreementShown(A(), "2026-11-10")).toBe("active");
    expect(agreementShown(A(), "2026-10-31")).toBe("upcoming");
    expect(agreementShown(A(), "2027-01-01")).toBe("expired");
    expect(agreementShown(A({ status: "ended" }), "2026-11-10")).toBe("ended");
  });
  it("يوم البداية ويوم النهاية شغالين", () => {
    expect(agreementShown(A(), "2026-11-01")).toBe("active");
    expect(agreementShown(A(), "2026-12-31")).toBe("active");
  });
});

describe("تحقق الاتفاقية", () => {
  const ok = { unitPrice: "12.5", validFrom: "2026-11-01", validUntil: "2026-12-31", today: "2026-11-10" };
  it("سليمة", () => expect(agreementIssues(ok)).toEqual([]));
  it("سعر صفر أو غلط", () => {
    expect(agreementIssues({ ...ok, unitPrice: "0" })).toEqual(["BAD_PRICE"]);
    expect(agreementIssues({ ...ok, unitPrice: "x" })).toEqual(["BAD_PRICE"]);
  });
  it("تواريخ غلط وترتيب ومدة", () => {
    expect(agreementIssues({ ...ok, validFrom: "2026-02-30" })).toEqual(["BAD_FROM"]);
    expect(agreementIssues({ ...ok, validUntil: "2026-10-01" })).toEqual(["ORDER"]);
    expect(agreementIssues({ ...ok, validFrom: "2026-01-01", validUntil: "2026-11-09" })).toEqual(["PAST_UNTIL"]);
    expect(agreementIssues({ ...ok, validUntil: "2029-01-01" })).toEqual(["TOO_LONG"]);
  });
  it("بداية في الماضي مسموحة طالما النهاية لسه ما فاتتش", () => {
    expect(agreementIssues({ ...ok, validFrom: "2026-10-01" })).toEqual([]);
  });
});

describe("التداخل والاختيار", () => {
  it("التداخل بالحدود الشاملة", () => {
    expect(overlaps({ validFrom: "2026-01-01", validUntil: "2026-01-31" }, { validFrom: "2026-01-31", validUntil: "2026-02-10" })).toBe(true);
    expect(overlaps({ validFrom: "2026-01-01", validUntil: "2026-01-30" }, { validFrom: "2026-01-31", validUntil: "2026-02-10" })).toBe(false);
  });
  it("بيختار الشغالة النهارده لنفس المنتج بس", () => {
    const list = [A({ id: 1 }), A({ id: 2, bomRecipeId: 8 }), A({ id: 3, status: "ended" }), A({ id: 4, validFrom: "2027-01-01", validUntil: "2027-02-01" })];
    expect(pickAgreement(list, 7, "2026-11-10")?.id).toBe(1);
    expect(pickAgreement(list, 9, "2026-11-10")).toBeNull();
    expect(pickAgreement(list, 7, "2027-01-15")?.id).toBe(4);
  });
});

describe("حد الإرسال", () => {
  it("صفر = مفيش حد، وفوق الحد للمدير بس", () => {
    expect(sendBlocked({ totalCents: 99_999_999n, limit: 0, isManager: false })).toBe(false);
    expect(sendBlocked({ totalCents: 500_000n, limit: 5000, isManager: false })).toBe(false);
    expect(sendBlocked({ totalCents: 500_001n, limit: 5000, isManager: false })).toBe(true);
    expect(sendBlocked({ totalCents: 500_001n, limit: 5000, isManager: true })).toBe(false);
  });
});
