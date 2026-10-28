/** @format */
/**
 * توحيد صفحات الإنتاج: «طلبات الإنتاج» و«التنفيذ والجودة والتتبع» بقوا صفحة /v2/staff/production،
 * والصفحات القديمة اتمسحت وروابطها القديمة بتتحوّل.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_PRODUCTION_PATHS, PRODUCTION_PAGE_REDIRECTS } from "./lib/legacyRedirects";
import { getNavForRole } from "./lib/departments";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("صفحة الإنتاج الموحّدة", () => {
  it("الصفحات والسكربتات القديمة اتمسحت", () => {
    for (const f of ["public/production-requests.html", "public/JS/production-requests.js", "public/CSS/production-requests.css", "public/execution-control.html", "public/JS/execution-control.js"]) {
      expect(existsSync(resolve(root, f))).toBe(false);
    }
  });

  it("الروابط القديمة بتتحوّل لتبويبها، والتحويل قبل الملفات الثابتة", () => {
    expect([...LEGACY_PRODUCTION_PATHS].sort()).toEqual(["/execution-control.html", "/factory-production-manager.html", "/factory-quality-controller.html", "/factory-supervisor.html", "/production-requests.html", "/production.html"]);
    expect(PRODUCTION_PAGE_REDIRECTS["/production-requests.html"]).toBe("/v2/staff/production?tab=requests");
    expect(PRODUCTION_PAGE_REDIRECTS["/execution-control.html"]).toBe("/v2/staff/production?tab=quality");
    const main = read("src/main.ts");
    const at = main.indexOf("LEGACY_PRODUCTION_PATHS, (req");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(main.indexOf("express.static(frontendPath)"));
  });

  it("القايمة بتشاور على الصفحة الجديدة بدل الـ html القديم", () => {
    const hrefs = getNavForRole("chairman").flatMap((d) => d.subFunctions.flatMap((s) => s.pages.map((p) => p.href)));
    expect(hrefs).toContain("/v2/staff/production?tab=requests");
    expect(hrefs).toContain("/v2/staff/production?tab=quality");
    expect(hrefs).not.toContain("production-requests.html");
    expect(hrefs).not.toContain("execution-control.html");
  });

  it("قايمة الطلبات وتفاصيل الطلب مقفولة بدور (كانت مفتوحة لأي حساب مسجّل)", () => {
    const src = read("src/routes/production-requests.ts");
    for (const path of ['"/production-requests",\n  requireAuth,\n  requireRole(...PRODUCTION_REQUEST_VIEW_ROLES)', '"/production-requests/:id",\n  requireAuth,\n  requireRole(...PRODUCTION_REQUEST_VIEW_ROLES)']) {
      expect(src).toContain(path);
    }
  });

  it("فتح وقفل حالة عدم المطابقة بيتسجّلوا في سجل التدقيق جوّه نفس المعاملة", () => {
    const src = read("src/routes/production-execution.ts");
    expect(src).toContain('actionKey: "production.ncr.open"');
    expect(src).toContain('actionKey: "production.ncr.close"');
    expect(src).toContain('.for("update")');
    expect(src).toContain("requireRole(...NCR_CLOSE_ROLES)");
  });

  it("الراوتر الجديد في الويب محمي بأدوار الصفحة", () => {
    expect(read("web/src/app/App.tsx")).toMatch(/path: "\/staff\/production", render: \(\) => <RoleGuard roles=\{PRODUCTION_PAGE_ROLES\}>/);
  });
});
