import { describe, expect, it } from "vitest";
import { deleteBlocker, isSellerRole, phoneKey } from "./contactsCore";

describe("contactsCore", () => {
  it("البائعين بس هما اللي نطاقهم محدود", () => {
    expect(isSellerRole("online_seller")).toBe(true);
    expect(isSellerRole("offline_seller")).toBe(true);
    expect(isSellerRole("sales_manager")).toBe(false);
  });
  it("مفتاح الهاتف بيوحّد الصيغ المختلفة لنفس الرقم", () => {
    const k = phoneKey("01001234567");
    expect(phoneKey("0100 123 4567")).toBe(k);
    expect(phoneKey("+20 100 123 4567")).toBe(k);
    expect(phoneKey("00201001234567")).toBe(k);
    expect(phoneKey("")).toBe("");
    expect(phoneKey(null)).toBe("");
  });
  it("الحذف بيتمنع لو فيه ارتباطات ويذكرها", () => {
    expect(deleteBlocker({ sales: 0, purchases: 0, stockItems: 0 })).toBeNull();
    const m = deleteBlocker({ sales: 3, purchases: 1, stockItems: 0 })!;
    expect(m).toContain("3 فاتورة مبيعات");
    expect(m).toContain("1 أمر شراء");
    expect(m).not.toContain("صنف مخزون");
  });
});
