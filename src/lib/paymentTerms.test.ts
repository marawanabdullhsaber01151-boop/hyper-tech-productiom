import { describe, expect, it } from "vitest";
import { PAYMENT_TERMS, creditDays, dueDateFor, isPaymentTerms } from "./paymentTerms";

describe("شروط الدفع", () => {
  it("القايمة المغلقة والتحقق", () => {
    expect([...PAYMENT_TERMS]).toEqual(["cash", "credit_15", "credit_30", "credit_60"]);
    expect(isPaymentTerms("credit_30")).toBe(true);
    expect(isPaymentTerms("credit_45")).toBe(false);
    expect(isPaymentTerms(null)).toBe(false);
  });
  it("أيام الآجل: نقدي صفر، والمجهول نقدي", () => {
    expect(creditDays("cash")).toBe(0);
    expect(creditDays("credit_15")).toBe(15);
    expect(creditDays("credit_60")).toBe(60);
    expect(creditDays("x")).toBe(0);
    expect(creditDays(undefined)).toBe(0);
  });
  it("تاريخ الاستحقاق بيعدّي الشهر والسنة صح", () => {
    expect(dueDateFor("2026-11-08", "cash")).toBe("2026-11-08");
    expect(dueDateFor("2026-11-08", "credit_30")).toBe("2026-12-08");
    expect(dueDateFor("2026-12-20", "credit_15")).toBe("2027-01-04");
    expect(dueDateFor("2028-02-20", "credit_15")).toBe("2028-03-06");
  });
});
