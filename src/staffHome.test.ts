/** @format */
/**
 * لوحة التحكم القديمة (index.html) اتشالت واللوحة الجديدة (v2) مكانها (خطوة 6).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("الرئيسية الموحّدة", () => {
  it("الصفحة القديمة وسكربتها اتمسحوا", () => {
    expect(existsSync(resolve(root, "public/index.html"))).toBe(false);
    expect(existsSync(resolve(root, "public/JS/index.js"))).toBe(false);
  });
  it("السيرفر بيحوّل / و/index.html قبل الملفات الثابتة", () => {
    const main = read("src/main.ts");
    const redirect = main.indexOf("LEGACY_HOME_PATHS, (_req");
    expect(redirect).toBeGreaterThan(0);
    expect(redirect).toBeLessThan(main.indexOf("express.static(frontendPath)"));
  });
  it("الرئيسية الجديدة فيها لوحة التشغيل", () => {
    expect(read("web/src/staff/Home.tsx")).toContain("<Dashboard");
  });
});
