import { describe, expect, it } from "vitest";
import { apiEnvelope } from "./apiEnvelope";

function response(statusCode: number) {
  const output: unknown[] = [];
  const res: any = {
    statusCode,
    json(payload: unknown) {
      output.push(payload);
      return res;
    },
  };
  return { res, output };
}

describe("api response envelope", () => {
  it("wraps legacy success payloads", () => {
    const { res, output } = response(200);
    apiEnvelope({ path: "/api/v1/items" } as any, res, () => {});
    res.json([{ id: 1 }]);
    expect(output[0]).toEqual({ data: [{ id: 1 }] });
  });

  it("adds an error code to legacy errors", () => {
    const { res, output } = response(404);
    apiEnvelope({ path: "/api/v1/items/1" } as any, res, () => {});
    res.json({ error: { message: "غير موجود" } });
    expect(output[0]).toEqual({
      error: { code: "NOT_FOUND", message: "غير موجود" },
    });
  });

  it("does not change non-api responses", () => {
    const { res, output } = response(200);
    apiEnvelope({ path: "/health" } as any, res, () => {});
    res.json({ status: "ok" });
    expect(output[0]).toEqual({ status: "ok" });
  });
});