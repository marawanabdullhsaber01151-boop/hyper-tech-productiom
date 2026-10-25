import { describe, it, expect, vi } from "vitest";
import { errorHandler, findPostgresError } from "./errorHandler";

// تسجيل الأخطاء بيروح لقاعدة البيانات — في الاختبار بنعزله.
vi.mock("../lib/errorEvents", () => ({ recordErrorEvent: vi.fn() }));

/**
 * ✅ حراسة مباشرة ضد أول وأخطر بغّ لقيناه في المراجعة الأولى: أخطاء
 * النطاق المقصودة (throw Object.assign(new Error(...), { status: 404 }))
 * كانت بتترجم دايمًا لـ500 عام بدل الكود الصح ورسالتها الحقيقية.
 */
function mockReqRes() {
  const req: any = { originalUrl: "/api/v1/test", method: "GET" };
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  const next = vi.fn();
  return { req, res, next };
}

describe("errorHandler", () => {
  it("يحترم status code الأخطاء المقصودة (404) ويرجّع رسالتها زي ما هي", () => {
    const { req, res, next } = mockReqRes();
    const err = Object.assign(new Error("جهة الاتصال غير موجودة"), { status: 404 });
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: "جهة الاتصال غير موجودة" }) }),
    );
  });

  it("يحترم status code 422 (تجاوز الحد الائتماني)", () => {
    const { req, res, next } = mockReqRes();
    const err = Object.assign(new Error("تجاوز الحد الائتماني"), { status: 422 });
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("يحترم status code 400 (قيمة غير صالحة)", () => {
    const { req, res, next } = mockReqRes();
    const err = Object.assign(new Error("قيمة تعديل الرصيد غير صالحة"), { status: 400 });
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("خطأ عام (بدون status صريح) يترجع 500 مع مرجع تتبّع", () => {
    const { req, res, next } = mockReqRes();
    errorHandler(new Error("شيء غير متوقع"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error.reference).toMatch(/^ERR-/);
  });

  it("خطأ Postgres unique violation (23505) يترجع 409", () => {
    const { req, res, next } = mockReqRes();
    const pgErr = { code: "23505", message: "duplicate key" };
    errorHandler(pgErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("خطأ Postgres foreign key violation (23503) يترجع 400", () => {
    const { req, res, next } = mockReqRes();
    const pgErr = { code: "23503", message: "fk violation" };
    errorHandler(pgErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("status خارج مدى 4xx/5xx معقول (زي 999) يُعامل كخطأ عام مش domain error", () => {
    const { req, res, next } = mockReqRes();
    const err = Object.assign(new Error("weird"), { status: 999 });
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("خطأ postgres مغلّف في cause (زي drizzle) بيتعرف عليه: 23505 يرجع 409", () => {
    const { req, res, next } = mockReqRes();
    const wrapped = Object.assign(new Error("Failed query"), { cause: { code: "23505", detail: "dup" } });
    errorHandler(wrapped, req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("23503 المغلّف بيرجع 400 مش 500", () => {
    const { req, res, next } = mockReqRes();
    const wrapped = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("fk"), { code: "23503" }) });
    errorHandler(wrapped, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("findPostgresError بيتجاهل الأكواد اللي مش بتاعت postgres", () => {
    expect(findPostgresError({ code: "ECONNRESET" })).toBeNull();
    expect(findPostgresError(new Error("x"))).toBeNull();
    expect(findPostgresError({ cause: { cause: { code: "23505" } } })?.code).toBe("23505");
  });
});
