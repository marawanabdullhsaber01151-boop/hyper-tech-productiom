/** @format */
/**
 * توحيد بوابة العميل (خطوة 5): الواجهة الجديدة /v2/portal هي الوحيدة. الصفحات القديمة اتمسحت،
 * وأي رابط اتبعت للعملاء قبل كده بيتحوّل، والروابط الجديدة اللي السيرفر بيبعتها بتشاور على الجديد.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPortalActivationUrl } from "./lib/portalConfig";

const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const REMOVED = [
  "public/portal.html",
  "public/portal-login.html",
  "public/portal-activate.html",
  "public/portal-recover.html",
  "public/portal-chat.html",
  "public/chat-staff.html",
  "public/JS/portal.js",
  "public/JS/portal-auth.js",
  "public/JS/portal-chat.js",
  "public/JS/portal-activate.js",
  "public/JS/portal-recover.js",
  "public/JS/portal-chat-fab.js",
  "public/JS/portal-v2-redirect.js",
  "public/JS/chat-common.js",
  "public/JS/chat-push.js",
  "public/JS/chat-staff.js",
  "public/JS/admin-v2-redirect.js",
  "public/CSS/portal.css",
  "public/CSS/chat.css",
  "scripts/set-v2-flag.mjs",
];

function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name === "node_modules" || f.name === "v2") continue;
      sources(rel, out);
    } else if (/\.(ts|tsx|js|html|mjs)$/.test(f.name) && !/\.test\.(ts|tsx)$/.test(f.name)) out.push(rel.replace(/\\/g, "/"));
  }
  return out;
}

describe("توحيد بوابة العميل", () => {
  it("الصفحات والسكربتات القديمة اتمسحت", () => {
    expect(REMOVED.filter((f) => existsSync(resolve(root, f)))).toEqual([]);
  });

  it("مفيش كود بيشاور على الصفحات القديمة (ماعدا ملف التحويل نفسه)", () => {
    const re = /portal-login\.html|portal-activate\.html|portal-recover\.html|portal-chat\.html|["'`/]portal\.html|chat-staff\.html|ui-flags|portal-v2-redirect|admin-v2-redirect/;
    const offenders: string[] = [];
    for (const dir of ["src", "web/src", "public", "scripts"]) {
      for (const f of sources(dir)) {
        if (["src/lib/legacyRedirects.ts", "src/main.ts", "scripts/smoke-check.mjs"].includes(f)) continue;
        if (re.test(read(f))) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  }, 60_000);

  it("التحويل متسجّل في السيرفر", () => {
    const main = read("src/main.ts");
    expect(main).toContain("LEGACY_PORTAL_PATHS");
    expect(main).toContain("chatStaffRedirectTarget");
  });

  it("رابط التفعيل اللي السيرفر بيبعته بيفتح الواجهة الجديدة", () => {
    const url = buildPortalActivationUrl({ protocol: "https", get: () => "x.test" } as never, "tok-123456789");
    expect(new URL(url).pathname).toBe("/v2/portal/activate");
    expect(new URL(url).searchParams.get("token")).toBe("tok-123456789");
  });

  it("الميزات اللي اتنقلت من القديم موجودة في الجديد", () => {
    const routes = read("web/src/portal/routes.tsx");
    expect(routes).toContain("/portal/activation-request");
    expect(read("web/src/portal/screens/PriceInquiries.tsx")).toContain("/portal/price-inquiries");
    expect(read("web/src/portal/screens/ProfileEdit.tsx")).toContain('api.patch');
    expect(read("web/src/portal/screens/Products.tsx")).toContain("Lightbox");
    expect(read("web/src/portal/screens/auth/ActivationRequest.tsx")).toContain("/portal/activation-requests");
  });
});
