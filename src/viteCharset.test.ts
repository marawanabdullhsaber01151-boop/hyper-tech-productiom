import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("ناتج البناء ثابت: esbuild بيسيب العربي UTF-8", () => {
  it("vite.config فيه esbuild.charset = utf8 (من غيرها العربي بيتحوّل \\uXXXX وحجم الحزمة بيقفز)", () => {
    const cfg = read("web/vite.config.ts");
    expect(cfg).toMatch(/esbuild:\s*\{\s*charset:\s*"utf8"\s*\}/);
    expect(cfg).toContain('minify: "esbuild"');
  });

  it("سكربت الميزانية بيطبع عدد \\uXXXX لكل ملف عند التجاوز (للتشخيص)", () => {
    expect(read("web/scripts/check-budgets.ts")).toContain("uXXXX=");
  });
});
