import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("بناء الواجهة production دايمًا", () => {
  const cfg = read("web/vite.config.ts");

  it("vite.config بيضبط NODE_ENV=production في أمر build (مهما كانت قيمة البيئة)", () => {
    expect(cfg).toMatch(/if \(command === "build"\) process\.env\.NODE_ENV = "production";/);
  });

  it("الضبط بيحصل جوّه دالة الإعداد (قبل ما Vite يحدد isProduction) والإعداد لسه بيرجّع نفس الكائن", () => {
    const fn = cfg.indexOf("export default defineConfig(({ command }) => {");
    const set = cfg.indexOf('process.env.NODE_ENV = "production"');
    const ret = cfg.indexOf("return {", fn);
    expect(fn).toBeGreaterThanOrEqual(0);
    expect(set).toBeGreaterThan(fn);
    expect(ret).toBeGreaterThan(set);
    expect(cfg.trimEnd().endsWith("};\n});")).toBe(true);
  });

  it("سكربت الميزانية بيطبع بصمة البيئة وعلامات التطوير", () => {
    const b = read("web/scripts/check-budgets.ts");
    expect(b).toContain("process.env.NODE_ENV");
    expect(b).toContain("lineNumber:");
  });
});
