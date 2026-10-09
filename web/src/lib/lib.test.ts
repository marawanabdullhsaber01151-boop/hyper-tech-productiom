import { describe, expect, it } from "vitest";
import { formatPartialCode, normalizeCompanyCode } from "./companyCode";
import { formatDate, formatMoney, formatRelative } from "./format";
import { normalizeEgyptPhone, whatsappLink } from "./phone";

describe("phone", () => {
  it.each([
    ["01012345678", "01012345678"],
    ["+201012345678", "01012345678"],
    ["00201112345678", "01112345678"],
    ["١٠١٢٣٤٥٦٧٨", "01012345678"],
    ["٠١٠١٢٣٤٥٦٧٨", "01012345678"],
    ["1012345678", "01012345678"],
    ["010 1234 5678", "01012345678"],
    ["01312345678", null],
    ["0101234567", null],
    ["", null],
  ])("normalize %s", (i, o) => expect(normalizeEgyptPhone(i)).toBe(o));
  it("رابط واتساب", () => {
    expect(whatsappLink("01055651409", "أهلا")).toBe("https://wa.me/201055651409?text=%D8%A3%D9%87%D9%84%D8%A7");
    expect(whatsappLink("123")).toBeNull();
  });
});

describe("companyCode (نفس خوارزمية السيرفر)", () => {
  // القيم دي اتحسبت بنفس خوارزمية src/lib/companyCode.ts
  it.each(["ABCDEFGY", "0123456T", "7K9M2QXH"])("يقبل %s", (c) => {
    expect(normalizeCompanyCode(c)).toBe(c);
    expect(normalizeCompanyCode(`HT-${c.slice(0, 4)}-${c.slice(4)}`)).toBe(c);
    expect(normalizeCompanyCode(`ht ${c.toLowerCase()}`)).toBe(c);
  });
  it("يرفض حرف فحص غلط أو طول غلط", () => {
    expect(normalizeCompanyCode("ABCDEFGZ")).toBeNull();
    expect(normalizeCompanyCode("ABC")).toBeNull();
    expect(normalizeCompanyCode(null)).toBeNull();
  });
  it("بيصحّح الحروف المتشابهة (O→0, I/L→1, U→V)", () => {
    expect(normalizeCompanyCode("O123456T")).toBe("0123456T");
  });
  it("تنسيق أثناء الكتابة", () => {
    expect(formatPartialCode("")).toBe("");
    expect(formatPartialCode("7k9")).toBe("HT-7K9");
    expect(formatPartialCode("7k9m2q")).toBe("HT-7K9M-2Q");
    expect(formatPartialCode("HT-7K9M-2QXH")).toBe("HT-7K9M-2QXH");
    expect(formatPartialCode("HT7K9M2QXH")).toBe("HT-7K9M-2QXH");
    expect(formatPartialCode("7K9M2QXHZZZ")).toBe("HT-7K9M-2QXH");
  });
});

describe("format", () => {
  it("أرقام لاتينية وفاصلة آلاف", () => {
    expect(formatMoney(183500)).toBe("183,500 ج.م");
    expect(formatMoney(24120.5)).toBe("24,120.5 ج.م");
  });
  it("تواريخ بتوقيت القاهرة", () => {
    expect(formatDate("2026-10-09T22:30:00Z")).toMatch(/10/); // بعد منتصف الليل في القاهرة = 10 أكتوبر
    expect(formatDate("garbage")).toBe("—");
  });
  it("وقت نسبي", () => {
    const now = Date.parse("2026-10-09T10:00:00Z");
    expect(formatRelative(now - 10_000, now)).toBe("دلوقتي");
    expect(formatRelative(now - 3 * 86400_000, now)).toMatch(/3/);
  });
});
