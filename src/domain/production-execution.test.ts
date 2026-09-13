import { describe, expect, it } from "vitest";
import { validateBatchQuantities } from "./production-execution";

describe("production batch balance", () => {
  const base = { producedQty: 100, acceptedQty: 90, reworkQty: 5, scrapQty: 5, plannedQty: 100 };

  it("accepts a balanced batch", () => {
    expect(() => validateBatchQuantities({ ...base, closing: true })).not.toThrow();
  });

  it("rejects an unbalanced closing batch", () => {
    expect(() => validateBatchQuantities({ ...base, scrapQty: 2, closing: true })).toThrow(
      "لا يمكن إغلاق الدفعة",
    );
  });
});
