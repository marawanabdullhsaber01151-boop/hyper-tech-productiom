import { describe, expect, it, afterEach } from "vitest";
import { buildReport, type HealthCheck } from "./lib/systemHealthCore";
import { composeBrief, BRIEF_MAX_ITEMS } from "./lib/dailyBriefCore";
import { assertCronAuth } from "./lib/cronAuth";
import { ACCESS } from "./lib/accessRegistry";
import { readFileSync } from "node:fs";

const mk = (id: string, status: HealthCheck["status"], message = id, count?: number): HealthCheck => ({
  id, group: "base", title: `بند ${id}`, status, message, ms: 1, ...(count !== undefined ? { count } : {}),
});

describe("ملخص الصباح", () => {
  it("كله سليم ← رسالة طمأنة بعدد البنود", () => {
    const b = composeBrief(buildReport([mk("a", "ok"), mk("b", "ok")]));
    expect(b.status).toBe("ok");
    expect(b.problems).toBe(0);
    expect(b.title).toContain("سليم");
    expect(b.body).toContain("2 بند");
  });

  it("المشاكل قبل الملاحظات، وبترتّب بالأخطر، والعنوان بيسمّي العدد", () => {
    const b = composeBrief(buildReport([mk("w", "warn"), mk("x", "bad", "x"), mk("o", "ok")]));
    expect(b.status).toBe("bad");
    expect(b.problems).toBe(2);
    expect(b.title).toContain("1 مشكلة");
    expect(b.body.indexOf("بند x")).toBeLessThan(b.body.indexOf("بند w"));
    expect(b.body).not.toContain("بند o");
  });

  it("بيحدّد عدد البنود المعروضة وبيعدّ الباقي ويحيل لصفحة الصحة", () => {
    const many = Array.from({ length: BRIEF_MAX_ITEMS + 3 }, (_, i) => mk(`p${i}`, "warn"));
    const b = composeBrief(buildReport(many));
    expect(b.body.split("\n").filter((l) => l.startsWith("•"))).toHaveLength(BRIEF_MAX_ITEMS);
    expect(b.body).toContain("و3 كمان");
  });

  it("الرسالة الطويلة بتتقصّ", () => {
    const b = composeBrief(buildReport([mk("long", "bad", "ي".repeat(400))]));
    expect(b.body).toContain("…");
    expect(b.body.length).toBeLessThan(400);
  });

  it("بيتبعت لأصحاب صلاحية صحة النظام بس", () => {
    expect([...ACCESS.systemHealthRead].sort()).toEqual(["chairman", "executive_manager"]);
    const src = readFileSync("src/lib/dailyBrief.ts", "utf8");
    expect(src).toContain("ACCESS.systemHealthRead");
  });

  it("الـcron مسجّل في vercel.json والمسار مقفول بالسر", () => {
    const v = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string }[] };
    expect(v.crons.map((c) => c.path)).toContain("/api/v1/cron/daily-brief");
    expect(readFileSync("src/routes/health.ts", "utf8")).toMatch(/cron\/daily-brief[\s\S]{0,120}assertCronAuth/);
  });
});

describe("assertCronAuth", () => {
  const OLD = process.env.CRON_SECRET;
  afterEach(() => {
    if (OLD === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = OLD;
  });
  const req = (h?: string) => ({ get: () => h }) as unknown as Parameters<typeof assertCronAuth>[0];

  it("من غير سر مضبوط ← 503", () => {
    delete process.env.CRON_SECRET;
    expect(() => assertCronAuth(req("Bearer x"))).toThrowError(expect.objectContaining({ status: 503 }));
  });
  it("سر غلط أو مفيش هيدر ← 401", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(() => assertCronAuth(req("Bearer nope"))).toThrowError(expect.objectContaining({ status: 401 }));
    expect(() => assertCronAuth(req(undefined))).toThrowError(expect.objectContaining({ status: 401 }));
  });
  it("السر الصح ← عدّى", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(() => assertCronAuth(req("Bearer s3cret"))).not.toThrow();
  });
});
