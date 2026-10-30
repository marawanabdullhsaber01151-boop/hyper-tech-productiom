import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * حارس عزل اختبارات e2e: كلها على قاعدة واحدة، فلازم تشتغل بالتتابع،
 * ولا يجوز اختبار يقارن عدّ قايمة عامة قبل/بعد (ملف تاني ممكن يغيّرها في نفس اللحظة).
 */
describe("عزل اختبارات e2e", () => {
  it("ملفات e2e بتشتغل بالتتابع", () => {
    const config = readFileSync("vitest.e2e.config.ts", "utf8");
    expect(config).toMatch(/fileParallelism:\s*false/);
  });

  it("مفيش اختبار e2e بيقارن عدد قايمة عامة قبل وبعد", () => {
    const offenders: string[] = [];
    for (const file of readdirSync("e2e").filter((f) => f.endsWith(".test.ts"))) {
      const text = readFileSync(join("e2e", file), "utf8");
      if (/body\.length\)\.toBe\(\s*before\.body\.length/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
