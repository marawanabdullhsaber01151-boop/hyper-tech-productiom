/** @format */
/**
 * اختبارات ارتداد للمرحلة ١ (غلاف الموظفين): صفحة دخول واحدة، وكل الباقي بيحوّل عليها.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "v2") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(html|js|ts|tsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("المرحلة ١ — دخول واحد", () => {
  it("public/login.html اتحذف ومفيش أي مرجع ليه (portal-login.html صفحة تانية ومش مقصودة)", () => {
    expect(existsSync(resolve(root, "public/login.html"))).toBe(false);
    const hits: string[] = [];
    for (const dir of ["public", "src", "web/src", "scripts", "e2e"]) {
      for (const file of walk(resolve(root, dir))) {
        // أي ملف اختبار بيذكر الاسم في نصه مستثنى (ده الملف نفسه)
        if (/regression\.test\.ts$/.test(file)) continue;
        if (/(^|[^-A-Za-z])login\.html/.test(readFileSync(file, "utf8"))) hits.push(file);
      }
    }
    expect(hits).toEqual([]);
  });

  it("الصفحات القديمة بتحوّل لـ/v2/login مع next، ومعالجة الدخول القديمة اتشالت", () => {
    const auth = read("public/JS/auth.js");
    expect(auth).toContain('const loginPage = "/v2/login"');
    expect(auth).toContain("loginUrlWithNext()");
    expect(auth).not.toContain("verifyTotp");
    expect(auth).not.toContain('"/auth/login"');
    expect(read("web/src/admin/session.ts")).toContain('STAFF_LOGIN_URL = "/v2/login"');
  });

  it("الشِل متوصّل: /login بره الغلاف، و/admin و/staff جوّاه", () => {
    const app = read("web/src/app/App.tsx");
    expect(app).toContain('path: "/login"');
    expect(app).toContain("<StaffShell");
    expect(app).toContain('p.startsWith("/admin/")');
    expect(app).toContain('path: "/staff"');
  });

  it("الدخول بيتحقق من next (open-redirect) وبيحفظ الجلسة بنفس مفتاح الصفحات القديمة", () => {
    expect(read("web/src/staff/Login.tsx")).toContain("safeNext(");
    expect(read("web/src/auth/staffSession.ts")).toContain('"hyper_erp_session"');
  });

  it("خطوة رمز التحقق بتتفرّق بـtype guard صريح (مش \"in\" لوحدها — LoginOk فيه index signature)", () => {
    const login = read("web/src/staff/Login.tsx");
    expect(login).toContain("r is TotpRequired");
    expect(login).toContain("isTotpStep(r)");
    expect(login).not.toContain('"requiresTotp" in r');
  });

  it("/nav بيرجّع user:{name,role,roleLabel}، والقفل بيرجّع retryAfterSeconds", () => {
    const nav = read("src/routes/nav.ts");
    expect(nav).toContain("roleLabel: roleLabel(role)");
    const auth = read("src/routes/auth.ts");
    expect(auth.match(/retryAfterSeconds/g)?.length).toBe(2);
  });

  it("مفيش قيمة CSS ثابتة (لون/اتجاه فيزيائي) في ستايل الغلاف", () => {
    const css = read("web/src/staff/StaffShell.css");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(css).not.toMatch(/(^|[\s;{])(left|right|margin-left|margin-right|padding-left|padding-right)\s*:/m);
  });
});
