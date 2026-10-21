/** @format */
/**
 * توحيد إدارة البوابة في الواجهة الجديدة: الصفحات القديمة اتمسحت ومفيش أي حاجة بتشاور عليها،
 * وكل صفحة بتفتح الواجهة الجديدة بنفس أدوار القايمة (عشان محدش يشوف رابط ويلاقي «ممنوع»).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEPARTMENTS } from "./lib/departments";

const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const REMOVED = [
  "public/portal-customers-admin.html",
  "public/portal-applications-admin.html",
  "public/portal-activation-requests-admin.html",
  "public/portal-orders.html",
  "public/JS/portal-customers-admin.js",
  "public/JS/portal-applications-admin.js",
  "public/JS/portal-activation-requests-admin.js",
  "public/JS/portal-orders.js",
  "public/JS/portal-admin-dialogs.js",
  "public/CSS/portal-customers-admin.css",
];

const rolesOf = (src: string, name: string) => (src.match(new RegExp(`${name} = \\[([^\\]]*)\\]`))?.[1].match(/"([a-z_]+)"/g) ?? []).map((s) => s.replace(/"/g, ""));

describe("توحيد واجهة إدارة البوابة", () => {
  it("الصفحات والسكربتات القديمة اتمسحت", () => {
    expect(REMOVED.filter((f) => existsSync(resolve(root, f)))).toEqual([]);
  });

  it("مفيش صفحة ولا سكربت في public بيشاور على الملفات المحذوفة", () => {
    const names = REMOVED.map((f) => f.split("/").pop()!);
    const offenders: string[] = [];
    for (const dir of ["public", "public/JS"]) {
      for (const f of readdirSync(resolve(root, dir))) {
        if (!/\.(html|js)$/.test(f)) continue;
        const src = read(`${dir}/${f}`);
        for (const n of names) if (src.includes(n)) offenders.push(`${dir}/${f} → ${n}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("القايمة بتفتح الصفحات الجديدة، ومفيش رابط .html لصفحة إدارة بوابة", () => {
    const pages = DEPARTMENTS.flatMap((d) => d.subFunctions.flatMap((s) => s.pages));
    const byId = Object.fromEntries(pages.map((p) => [p.id, p]));
    expect(byId["portal-customers-admin"]?.href).toBe("/v2/admin/portal-customers");
    expect(byId["portal-applications-admin"]?.href).toBe("/v2/admin/portal-applications");
    expect(byId["portal-activation-requests-admin"]?.href).toBe("/v2/admin/portal-activation-requests");
    expect(byId["portal-orders"]?.href).toBe("/v2/admin/portal-orders");
    expect(pages.filter((p) => /^portal-.*admin.*\.html$|^portal-orders\.html$/.test(p.href))).toEqual([]);
  });

  it("أدوار القايمة = أدوار حارس الصفحة في الواجهة الجديدة", () => {
    const pages = DEPARTMENTS.flatMap((d) => d.subFunctions.flatMap((s) => s.pages));
    const session = read("web/src/admin/session.ts");
    const admin = rolesOf(session, "ADMIN_ROLES");
    // SALES_ROLES بتتبني من ADMIN_ROLES + إضافات؛ بنقرأ الإضافات من نفس السطر
    const salesExtra = (session.match(/SALES_ROLES = \[\.\.\.ADMIN_ROLES, ([^\]]*)\]/)?.[1].match(/"([a-z_]+)"/g) ?? []).map((s) => s.replace(/"/g, ""));
    const salesAll = [...new Set([...admin, ...salesExtra])].sort();
    const adminSorted = [...admin].sort();
    for (const id of ["portal-customers-admin", "portal-applications-admin", "portal-activation-requests-admin"]) {
      expect([...pages.find((p) => p.id === id)!.roles].sort()).toEqual(adminSorted);
    }
    expect([...pages.find((p) => p.id === "portal-orders")!.roles].sort()).toEqual(salesAll);
  });

  it("طلبات الأسعار والحد الأدنى والمحافظة اتنقلوا للواجهة الجديدة (ما ضاعتش بحذف القديم)", () => {
    expect(read("web/src/admin/screens/PriceInquiries.tsx")).toContain("/price-inquiries/${target.id}/answer");
    expect(read("web/src/admin/screens/PortalOrders.tsx")).toContain("/price-inquiries/pending");
    const tabs = read("web/src/admin/screens/CompanyTabs.tsx");
    expect(tabs).toContain("/minimum-order");
    expect(tabs).toContain("/city");
  });
});
