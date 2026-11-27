/** @format */
import { describe, expect, it } from "vitest";
import {
  TOKEN_LEN, canInvoice, canonicalString, findGaps, keyIdOf, parseInvoiceNumber, safeEqual, sealKeyProblem, sealOf, tokenOf, vatInclusive, verifyUrl, verifyVerdict,
  type InvoiceData,
} from "./invoiceSealCore";

const KEY = "k".repeat(40);
const inv = (over: Partial<InvoiceData> = {}): InvoiceData => ({
  invoiceNumber: "INV-000001", orderNumber: "SO-0001", issueDate: "2026-11-26", customerName: "شركة النور", subtotal: "250.00", taxRate: "14.00", taxAmount: "30.70", total: "250.00",
  lines: [{ description: "علبة 500جم", qty: "10.000", unitPrice: "25.00", total: "250.00" }], ...over,
});

describe("مفتاح الختم", () => {
  it("فاضي أو ناقص أو قصير = مرفوض، و32+ حرف مقبول", () => {
    expect(sealKeyProblem(undefined)).toBe("missing");
    expect(sealKeyProblem("   ")).toBe("missing");
    expect(sealKeyProblem("x".repeat(31))).toBe("short");
    expect(sealKeyProblem("x".repeat(32))).toBeNull();
  });
  it("بصمة المفتاح ثابتة، 8 حروف، ومش هي المفتاح", () => {
    expect(keyIdOf(KEY)).toBe(keyIdOf(` ${KEY} `));
    expect(keyIdOf(KEY)).toMatch(/^[0-9a-f]{8}$/);
    expect(keyIdOf(KEY)).not.toBe(keyIdOf("z".repeat(40)));
  });
});

describe("الختم", () => {
  it("ثابت لنفس الفاتورة ومفتاح مختلف = ختم مختلف", () => {
    expect(sealOf(inv(), KEY)).toBe(sealOf(inv(), KEY));
    expect(sealOf(inv(), KEY)).toMatch(/^[0-9a-f]{64}$/);
    expect(sealOf(inv(), KEY)).not.toBe(sealOf(inv(), "z".repeat(40)));
  });
  it("أي تغيير في أي حقل بيغيّر الختم", () => {
    const base = sealOf(inv(), KEY);
    const changes: Array<Partial<InvoiceData>> = [
      { invoiceNumber: "INV-000002" }, { orderNumber: "SO-0002" }, { issueDate: "2026-11-27" }, { customerName: "شركة تانية" },
      { subtotal: "251.00" }, { taxRate: "0.00" }, { taxAmount: "0.00" }, { total: "251.00" },
      { lines: [{ description: "علبة 500جم", qty: "11.000", unitPrice: "25.00", total: "250.00" }] },
      { lines: [{ description: "علبة 500جم", qty: "10.000", unitPrice: "25.00", total: "250.00" }, { description: "x", qty: "1", unitPrice: "1", total: "1" }] },
    ];
    for (const c of changes) expect(sealOf(inv(c), KEY), JSON.stringify(c)).not.toBe(base);
  });
  it("صيغ الأرقام المختلفة لنفس القيمة بتدّي نفس الختم (القاعدة بترجّع 250 و250.00 بنفس المعنى)", () => {
    expect(sealOf(inv({ total: "250" }), KEY)).toBe(sealOf(inv({ total: "250.00" }), KEY));
    expect(sealOf(inv({ lines: [{ description: "علبة 500جم", qty: "10", unitPrice: "25", total: "250" }] }), KEY)).toBe(sealOf(inv(), KEY));
  });
  it("المسافات حوالين الاسم والوصف مبتأثرش", () => {
    expect(canonicalString(inv({ customerName: "  شركة النور " }))).toBe(canonicalString(inv()));
  });
});

describe("حكم التحقق", () => {
  const seal = sealOf(inv(), KEY);
  const token = tokenOf(seal);
  it("التوكن جزء من الختم بطول ثابت", () => expect(token).toHaveLength(TOKEN_LEN));
  it("سليمة", () => expect(verifyVerdict({ found: true, storedSeal: seal, token, recomputed: seal })).toBe("valid"));
  it("مفيش فاتورة = unknown", () => expect(verifyVerdict({ found: false, token, recomputed: null })).toBe("unknown"));
  it("توكن غلط = wrong_token حتى لو الفاتورة موجودة", () => expect(verifyVerdict({ found: true, storedSeal: seal, token: "0".repeat(TOKEN_LEN), recomputed: seal })).toBe("wrong_token"));
  it("بيانات اتغيّرت (الختم المحسوب غير المحفوظ) = tampered", () => {
    const other = sealOf(inv({ total: "999.00" }), KEY);
    expect(verifyVerdict({ found: true, storedSeal: seal, token, recomputed: other })).toBe("tampered");
  });
  it("من غير مفتاح مبنقولش «سليمة»: unverifiable", () => expect(verifyVerdict({ found: true, storedSeal: seal, token, recomputed: null })).toBe("unverifiable"));
  it("safeEqual بيرفض الأطوال المختلفة من غير ما يرمي", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
  });
});

describe("ضريبة القيمة المضافة المشمولة", () => {
  it("14% من 114 = 14 بالظبط، والإجمالي مبيتغيّرش", () => expect(vatInclusive("114.00", 14)).toEqual({ taxRate: "14.00", taxAmount: "14.00" }));
  it("تقريب نصف لأعلى: 250 × 14 ÷ 114 = 30.70", () => expect(vatInclusive("250.00", 14).taxAmount).toBe("30.70"));
  it("نسبة صفر أو سالبة = من غير ضريبة", () => {
    expect(vatInclusive("100.00", 0).taxAmount).toBe("0.00");
    expect(vatInclusive("100.00", -5).taxAmount).toBe("0.00");
  });
  it("نسبة بكسر 5.5%", () => expect(vatInclusive("105.50", 5.5)).toEqual({ taxRate: "5.50", taxAmount: "5.50" }));
});

describe("الترقيم", () => {
  it("بيقرا الرقم ويرفض الغلط", () => {
    expect(parseInvoiceNumber("INV-000012")).toBe(12);
    expect(parseInvoiceNumber("INV-12")).toBeNull();
    expect(parseInvoiceNumber("X-000012")).toBeNull();
  });
  it("متسلسل = من غير فجوات", () => expect(findGaps(["INV-000001", "INV-000002", "INV-000003"])).toEqual({ missing: [], duplicates: [], malformed: [] }));
  it("بيلاقي الفجوة والتكرار والشكل الغلط", () => {
    const g = findGaps(["INV-000001", "INV-000004", "INV-000004", "oops"]);
    expect(g.missing).toEqual(["INV-000002", "INV-000003"]);
    expect(g.duplicates).toEqual(["INV-000004"]);
    expect(g.malformed).toEqual(["oops"]);
  });
  it("فاضي = من غير مشاكل", () => expect(findGaps([])).toEqual({ missing: [], duplicates: [], malformed: [] }));
});

describe("الإصدار والرابط", () => {
  it("بس المعتمد والمشحون والمسدد", () => {
    for (const s of ["confirmed", "shipped", "paid"]) expect(canInvoice(s), s).toBe(true);
    for (const s of ["draft", "pending_approval", "cancelled"]) expect(canInvoice(s), s).toBe(false);
  });
  it("رابط التحقق فيه الرقم والتوكن بس (مش الختم الكامل)", () => {
    const seal = sealOf(inv(), KEY);
    const u = new URL(verifyUrl("https://hyper.example", "INV-000001", seal));
    expect(u.pathname).toBe("/v2/verify");
    expect(u.searchParams.get("n")).toBe("INV-000001");
    expect(u.searchParams.get("t")).toBe(seal.slice(0, TOKEN_LEN));
    expect(u.toString()).not.toContain(seal);
  });
});
