/** @format */
// esbuild لازم يفضل مثبّت بالظبط وDependabot ما يرقّيهوش لوحده (esbuild-plugin-pino بيحدد سقف نسخته؛ ترقية واحدة بتكسر npm ci على Vercel).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("حماية esbuild من الترقية التلقائية", () => {
  it("esbuild مثبّت بنسخة مضبوطة من غير ^ أو ~", () => {
    const pkg = JSON.parse(read("package.json")) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
    const v = pkg.devDependencies?.esbuild ?? pkg.dependencies?.esbuild;
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("Dependabot متقال له يتجاهل esbuild في npm", () => {
    const y = read(".github/dependabot.yml");
    const npmBlock = y.slice(y.indexOf("package-ecosystem: npm"), y.indexOf("package-ecosystem: github-actions"));
    expect(npmBlock).toContain('dependency-name: "esbuild"');
  });
});
