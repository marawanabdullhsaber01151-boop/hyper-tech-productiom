/** @format */

import { describe, expect, it } from "vitest";
import {
  MONEY_INPUT_PATTERN,
  MoneyError,
  centsToString,
  lineTotal,
  priceLines,
  sumMoney,
  toCents,
} from "./money";

describe("money — حساب الفلوس بأرقام صحيحة", () => {
  it("يحسب إجمالي السطر ويقرّبه مرة واحدة لأقرب قرش", () => {
    expect(lineTotal("3", "10.50")).toBe("31.50");
    expect(lineTotal("0.5", "0.01")).toBe("0.01"); // 0.005 ⇒ يقرّب لأعلى
    expect(lineTotal("1.333", "3")).toBe("4.00"); // 3.999 ⇒ 4.00
    expect(lineTotal("2", "0.0049")).toBe("0.01"); // 0.0098 ⇒ 0.01
  });

  it("يتفادى أخطاء الفاصلة العائمة المعروفة", () => {
    // بالـ number: 0.1 * 3 = 0.30000000000000004 و 1.005 * 100 = 100.49999999999999
    expect(lineTotal("3", "0.1")).toBe("0.30");
    expect(lineTotal("100", "1.005")).toBe("100.50");
    expect(sumMoney(["0.1", "0.2"])).toBe("0.30");
  });

  it("إجمالي الفاتورة = مجموع السطور المقرَّبة دايمًا (مفيش فرق ٠٫٠١)", () => {
    // ٣ سطور كل واحد 0.333 × 1 ⇒ كل سطر يتقرّب 0.33، والمجموع 0.99 (مش 1.00)
    const { lines, subtotal } = priceLines([
      { qty: "1", unitPrice: "0.333" },
      { qty: "1", unitPrice: "0.333" },
      { qty: "1", unitPrice: "0.333" },
    ]);
    expect(lines.map((l) => l.total)).toEqual(["0.33", "0.33", "0.33"]);
    expect(subtotal).toBe("0.99");
    expect(sumMoney(lines.map((l) => l.total))).toBe(subtotal);
  });

  it("يرفض المدخلات غير الصالحة بدل ما يطلّع NaN", () => {
    for (const bad of ["abc", "", "-5", "1e3", "1,5", "12.12345", " "]) {
      expect(() => toCents(bad)).toThrow(MoneyError);
    }
    expect(() => lineTotal("x", "5")).toThrow(MoneyError);
    expect(MONEY_INPUT_PATTERN.test("0")).toBe(true);
    expect(MONEY_INPUT_PATTERN.test("999999999999.9999")).toBe(true);
    expect(MONEY_INPUT_PATTERN.test("-1")).toBe(false);
  });

  it("يقبل الصفر ويعرضه بقرشين", () => {
    expect(lineTotal("10", "0")).toBe("0.00");
    expect(centsToString(0n)).toBe("0.00");
    expect(centsToString(5n)).toBe("0.05");
    expect(centsToString(123456n)).toBe("1234.56");
  });

  it("خاصية: مجموع السطور المقرَّبة ثابت بغض النظر عن ترتيبها", () => {
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let round = 0; round < 200; round++) {
      const lines = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => ({
        qty: (rand() * 500).toFixed(3),
        unitPrice: (rand() * 90).toFixed(4),
      }));
      const forward = priceLines(lines).subtotal;
      const backward = priceLines([...lines].reverse()).subtotal;
      expect(forward).toBe(backward);
      expect(forward).toBe(sumMoney(priceLines(lines).lines.map((l) => l.total)));
    }
  });
});
