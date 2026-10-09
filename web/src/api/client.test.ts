import { describe, expect, it, vi } from "vitest";
import { createSessionStore } from "../auth/session";
import { ApiError, createApiClient } from "./client";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("api client", () => {
  it("بيفكّ { data } ويبعت التوكن", async () => {
    const session = createSessionStore("k1", { allowLocal: false });
    session.save({ token: "abc" });
    const f = vi.fn().mockResolvedValue(json(200, { data: [{ id: 1 }] }));
    const api = createApiClient({ session, fetchImpl: f as never });
    expect(await api.get("/x", { query: { a: 1, b: "", c: undefined } })).toEqual([{ id: 1 }]);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/v1/x?a=1");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer abc" });
  });

  it("anonymous من غير توكن", async () => {
    const session = createSessionStore("k2", { allowLocal: false });
    session.save({ token: "abc" });
    const f = vi.fn().mockResolvedValue(json(200, { data: 1 }));
    await createApiClient({ session, fetchImpl: f as never }).post("/login", { a: 1 }, { anonymous: true });
    expect((f.mock.calls[0]![1] as RequestInit).headers).not.toHaveProperty("Authorization");
  });

  it("رسالة السيرفر العربي بتتعرض في 4xx", async () => {
    const f = vi.fn().mockResolvedValue(json(409, { error: { code: "CONFLICT", message: "الشركة وصلت لأقصى عدد" } }));
    const err = await createApiClient({ fetchImpl: f as never }).post("/x", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: "conflict", status: 409, message: "الشركة وصلت لأقصى عدد", code: "CONFLICT" });
  });

  it("5xx بيستبدل الرسالة برسالة آمنة", async () => {
    const f = vi.fn().mockResolvedValue(json(500, { error: { message: "SELECT * FROM secret" } }));
    const err = await createApiClient({ fetchImpl: f as never }).post("/x", {}).catch((e) => e);
    expect(err.kind).toBe("server");
    expect(err.message).not.toContain("SELECT");
  });

  it("GET بيتعاد مرة لو الشبكة وقعت، وPOST لأ", async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError("x")).mockResolvedValueOnce(json(200, { data: "ok" }));
    expect(await createApiClient({ fetchImpl: f as never }).get("/x")).toBe("ok");
    expect(f).toHaveBeenCalledTimes(2);
    const g = vi.fn().mockRejectedValue(new TypeError("x"));
    const err = await createApiClient({ fetchImpl: g as never }).post("/x", {}).catch((e) => e);
    expect(err.kind).toBe("network");
    expect(g).toHaveBeenCalledTimes(1);
  });

  it("401 على جلسة موجودة بيمسحها وينادي onUnauthorized", async () => {
    const session = createSessionStore("k3", { allowLocal: false });
    session.save({ token: "dead" });
    const onUnauthorized = vi.fn();
    const f = vi.fn().mockResolvedValue(json(401, { error: { message: "x" } }));
    await createApiClient({ session, fetchImpl: f as never, onUnauthorized }).get("/x").catch(() => {});
    expect(session.get()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalled();
  });

  it("أخطاء الحقول من details", async () => {
    const f = vi.fn().mockResolvedValue(json(400, { error: { code: "VALIDATION_ERROR", message: "x", details: [{ path: ["phone"], message: "غلط" }] } }));
    const err = (await createApiClient({ fetchImpl: f as never }).post("/x", {}).catch((e) => e)) as ApiError;
    expect(err.fieldErrors).toEqual({ phone: "غلط" });
  });
});

describe("session store", () => {
  it("rememberMe → local، غير كده session", () => {
    const s = createSessionStore("k4", { allowLocal: true });
    s.save({ token: "a", rememberMe: true });
    expect(localStorage.getItem("k4")).toBeTruthy();
    s.save({ token: "b" });
    expect(localStorage.getItem("k4")).toBeNull();
    expect(sessionStorage.getItem("k4")).toBeTruthy();
    expect(s.get()?.token).toBe("b");
  });
  it("JSON بايظ بيتمسح", () => {
    sessionStorage.setItem("k5", "{bad");
    expect(createSessionStore("k5", { allowLocal: false }).get()).toBeNull();
    expect(sessionStorage.getItem("k5")).toBeNull();
  });
});
