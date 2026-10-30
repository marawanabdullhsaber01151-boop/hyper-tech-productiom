import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// "engines.node": ">=20" من غير حد أعلى بيخلّي Vercel يقفز لأحدث Node أول ما ينزل (حصل: 24 ← 26)،
// ولو الحزمة بتتبني بشكل مختلف بين الإصدارات (الميزانية فشلت 120.0KB) بيقع النشر من غير ما نغيّر حاجة.
// الحل: حد أعلى صريح، وتغيير إصدار Node الرئيسي بيبقى قرار مقصود (غيّر الرقم هنا وفي package.json مع بعض).
describe("إصدار Node مثبّت بحد أعلى", () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { engines?: { node?: string } };

  it("engines.node فيه حد أدنى وحد أعلى", () => {
    const range = pkg.engines?.node ?? "";
    expect(range).toMatch(/>=\s*20/);
    expect(range).toMatch(/<\s*\d+/);
  });

  it("الحد الأعلى بيمنع Node 26 (اللي اتجرّب وكسر الميزانية على Vercel)", () => {
    const upper = Number((pkg.engines?.node ?? "").match(/<\s*(\d+)/)?.[1] ?? "999");
    expect(upper).toBeLessThanOrEqual(25);
  });
});
