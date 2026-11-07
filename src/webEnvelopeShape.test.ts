/** @format */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * حارس شكل الرد (الخطوة 40أ-إصلاح 4): الـclient (web/src/api/client.ts) بيفك مفتاح `data` مرة واحدة،
 * فمسار السيرفر اللي بيرد `{ data: X }` بيوصل للصفحة `X` مباشرة. ٣ صفحات (الاعتمادات والإعدادات وسجل النشاط)
 * اتكتبت على إن النتيجة `{ data: X }` وبتقرا `.data?.data` فطلعت فاضية في الإنتاج، والاختبارات ما كشفتهاش
 * لأنها بتجرّب الدوال المساعدة بس (الـmock كان بيرجّع نفس الشكل الغلط).
 */
const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) {
    const p = path.join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const files = walk("web/src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));

describe("شكل رد الـAPI في الواجهة", () => {
  it("مفيش api.<verb><{ data: ... }> (الـclient بيفك data بالفعل)", () => {
    const bad = files.filter((f) => /api\.(get|post|put|patch|delete)<\{\s*data\s*:/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
  it("مفيش قراءة .data?.data على نتيجة useQuery في صفحات الموظفين", () => {
    const bad = files.filter((f) => f.includes(`${path.sep}staff${path.sep}`) && /\.data\??\.data\b/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
