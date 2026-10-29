/** @format */
import { describe, expect, it } from "vitest";
import { cairoToday, checkOrderCreate, ORDER_CREATE_ROLES } from "./orderIntakeCore";

const T = "2026-10-28";
const ok = { customerName: "شركة النور", qty: "10", neededBy: "2026-11-01" };

describe("checkOrderCreate", () => {
  it("يقبل أمرًا سليمًا", () => {
    expect(checkOrderCreate(ok, T)).toEqual({ ok: true });
  });
  it("يقبل تسليم النهاردة", () => {
    expect(checkOrderCreate({ ...ok, neededBy: T }, T).ok).toBe(true);
  });
  it("يرفض اسم عميل فاضي أو مسافات", () => {
    const r = checkOrderCreate({ ...ok, customerName: "   " }, T);
    expect(r.ok === false && r.code).toBe("CUSTOMER_REQUIRED");
  });
  it.each(["0", "-1", "abc", "1.2345", "", "1e3"])("يرفض الكمية %s", (qty) => {
    const r = checkOrderCreate({ ...ok, qty }, T);
    expect(r.ok === false && r.code).toBe("QTY_INVALID");
  });
  it("يقبل كمية عشرية حتى 3 خانات", () => {
    expect(checkOrderCreate({ ...ok, qty: "2.125" }, T).ok).toBe(true);
  });
  it("يرفض تاريخ مستحيل أو بصيغة غلط", () => {
    for (const d of ["2026-02-30", "28/10/2026", "2026-13-01", ""]) {
      const r = checkOrderCreate({ ...ok, neededBy: d }, T);
      expect(r.ok === false && r.code).toBe("DATE_INVALID");
    }
  });
  it("يرفض تاريخ في الماضي", () => {
    const r = checkOrderCreate({ ...ok, neededBy: "2026-10-27" }, T);
    expect(r.ok === false && r.code).toBe("DATE_IN_PAST");
  });
  it("يرفض موبايل قصير ويقبل الفاضي", () => {
    const bad = checkOrderCreate({ ...ok, customerPhone: "123" }, T);
    expect(bad.ok === false && bad.code).toBe("PHONE_INVALID");
    expect(checkOrderCreate({ ...ok, customerPhone: "" }, T).ok).toBe(true);
    expect(checkOrderCreate({ ...ok, customerPhone: "010-1234-5678" }, T).ok).toBe(true);
  });
  it("cairoToday بصيغة YYYY-MM-DD وبتوقيت القاهرة", () => {
    expect(cairoToday(new Date("2026-10-27T22:30:00Z"))).toBe("2026-10-28");
    expect(cairoToday(new Date("2026-10-28T10:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("sales_manager خارج صلاحية الإنشاء", () => {
    expect(ORDER_CREATE_ROLES).not.toContain("sales_manager" as never);
  });
});
