import { describe, it, expect, vi } from "vitest";
import { parseFiniteAmount, parseIdParam } from "./validate";

/**
 * ✅ الاختبارات دي حراسة مباشرة ضد أخطر بغّ لقيناه في المراجعة الأولى:
 * Number("abc") كانت بترجع NaN من غير أي error، وNaN كانت بتتسجل فعليًا
 * كـ"NaN" (نص) في رصيد عميل أو كمية مخزون حقيقية. أي تعديل مستقبلي في
 * parseFiniteAmount لازم يفضل يمنع السيناريو ده — الاختبارات دي بتضمن كده.
 */
describe("parseFiniteAmount", () => {
  it("يرجّع الرقم زي ما هو لو صالح", () => {
    expect(parseFiniteAmount(42, "قيمة")).toBe(42);
    expect(parseFiniteAmount("42.5", "قيمة")).toBe(42.5);
    expect(parseFiniteAmount(-10, "قيمة")).toBe(-10);
  });

  it("يرمي خطأ 400 لقيمة نصية مش رقمية (السيناريو اللي كان بيسبب NaN)", () => {
    expect(() => parseFiniteAmount("abc", "قيمة تعديل الرصيد")).toThrow(
      "قيمة تعديل الرصيد غير صالحة — لازم تكون رقم",
    );
    try {
      parseFiniteAmount("abc", "قيمة تعديل الرصيد");
    } catch (err: any) {
      expect(err.status).toBe(400);
    }
  });

  it("يرمي خطأ 400 لـ undefined أو null", () => {
    expect(() => parseFiniteAmount(undefined, "قيمة")).toThrow();
    expect(() => parseFiniteAmount(null, "قيمة")).toThrow();
  });

  it("يرمي خطأ 400 لـ Infinity (Number.isFinite بترفضها بس Number() بتقبلها)", () => {
    expect(() => parseFiniteAmount(Infinity, "قيمة")).toThrow();
    expect(() => parseFiniteAmount(-Infinity, "قيمة")).toThrow();
  });

  it("يرمي خطأ لو allowZero:false والقيمة صفر", () => {
    expect(() => parseFiniteAmount(0, "الكمية", { allowZero: false })).toThrow("لا يمكن أن تكون صفر");
  });

  it("يسمح بصفر افتراضيًا (allowZero غير محدد)", () => {
    expect(parseFiniteAmount(0, "قيمة")).toBe(0);
  });

  it("يرمي خطأ لو القيمة أقل من min المحدد", () => {
    expect(() => parseFiniteAmount(-5, "الكمية", { min: 0 })).toThrow("لا يمكن أن تكون أقل من 0");
  });

  it("يقبل القيمة لو مساوية لـ min بالظبط", () => {
    expect(parseFiniteAmount(0, "الكمية", { min: 0 })).toBe(0);
  });

  it("رسالة الخطأ بتتضمن الـ label المخصّص لكل نقطة استخدام", () => {
    expect(() => parseFiniteAmount("x", "الكمية")).toThrow("الكمية غير صالحة");
    expect(() => parseFiniteAmount("x", "سعر الوحدة")).toThrow("سعر الوحدة غير صالحة");
  });
});

describe("parseIdParam", () => {
  function mockRes() {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  }

  it("يرجّع الرقم لو صالح وموجب", () => {
    const res = mockRes();
    expect(parseIdParam("42", res)).toBe(42);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("يرجّع null ويبعت 400 لو مش رقم", () => {
    const res = mockRes();
    expect(parseIdParam("abc", res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("يرجّع null لو صفر أو سالب", () => {
    const res = mockRes();
    expect(parseIdParam("0", res)).toBeNull();
    expect(parseIdParam("-5", mockRes())).toBeNull();
  });

  it("يرجّع null لو رقم عشري (لازم integer)", () => {
    const res = mockRes();
    expect(parseIdParam("4.5", res)).toBeNull();
  });
});
