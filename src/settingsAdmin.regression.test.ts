import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_SETTINGS_PATH, SETTINGS_REDIRECT_TARGET } from "./lib/legacyRedirects";

const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
function sources(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(resolve(root, dir))) {
    if (n === "node_modules" || n === "dist") continue;
    const rel = `${dir}/${n}`;
    if (rel === "public/v2") continue; // ناتج البناء (بيتولّد من web/src)، مش مصدر
    if (statSync(resolve(root, rel)).isDirectory()) sources(rel, out);
    else if (/\.(ts|tsx|js|html|mjs)$/.test(n)) out.push(rel);
  }
  return out;
}

describe("الإعدادات بعد 40ب", () => {
  it("الصفحة القديمة وملفاتها اتمسحت", () => {
    for (const f of ["public/settings.html", "public/JS/settings.js", "public/CSS/settings.css"]) expect(existsSync(resolve(root, f))).toBe(false);
  });
  it("الرابط القديم بيتحوّل لمركز الإعدادات الجديد", () => {
    expect(LEGACY_SETTINGS_PATH).toBe("/settings.html");
    expect(SETTINGS_REDIRECT_TARGET).toBe("/v2/staff/settings");
    expect(read("src/main.ts")).toContain("app.get(LEGACY_SETTINGS_PATH");
  });
  it("مفيش كود بيشاور على settings.html (ماعدا ملف التحويل)", () => {
    const offenders: string[] = [];
    for (const dir of ["src", "web/src", "public", "scripts"]) {
      for (const f of sources(dir)) {
        if (["src/lib/legacyRedirects.ts", "src/settingsAdmin.regression.test.ts"].includes(f)) continue;
        if (/settings\.html/.test(read(f))) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  }, 60_000);
  it("التبويبات والمسار الجديد متسجّلة", () => {
    const s = read("web/src/staff/Settings.tsx");
    for (const id of ['"users"', '"delivery"', '"about"']) expect(s).toContain(id);
    expect(read("web/src/app/App.tsx")).toContain('"/staff/account"');
    expect(read("web/src/staff/Header.tsx")).toContain("/staff/account");
  });
  it("شاشات الإدارة بتقرا القوائم من غير {data:} (شكل الرد)", () => {
    for (const f of ["web/src/staff/SettingsAdmin.tsx", "web/src/staff/Account.tsx"]) {
      expect(read(f)).not.toMatch(/api\.(get|post|put|patch|delete)<\{\s*data:/);
      expect(read(f)).not.toContain(".data?.data");
    }
  });
  it("حذف المستخدم والتعديل بيعدّوا على صلاحية السيرفر (settings.manageUsers)", () => {
    const r = read("src/routes/settings.ts");
    expect(r).toContain('requirePermission("settings.manageUsers")');
  });
  it("صفحة حسابي متاحة لكل الموظفين (من غير RoleGuard)", () => {
    const line = read("web/src/app/App.tsx").split("\n").find((l) => l.includes('"/staff/account"')) ?? "";
    expect(line).not.toContain("RoleGuard");
  });
});
