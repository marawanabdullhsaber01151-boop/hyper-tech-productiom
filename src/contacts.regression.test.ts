import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("جهات الاتصال (v2)", () => {
  const routes = read("src/routes/contacts.ts");
  it("المسارات الثابتة قبل /contacts/:id عشان ما تتحسبش id", () => {
    const byId = routes.indexOf('"/contacts/:id"');
    for (const p of ['"/contacts/overview"', '"/contacts/duplicate-check"', '"/contacts/search"', '"/contacts/:id/activity"']) {
      const i = routes.indexOf(p);
      expect(i, p).toBeGreaterThan(-1);
      expect(i, p).toBeLessThan(byId);
    }
  });
  it("البائع محصور في عملائه في القايمة والتعديل والحذف، وما يقدرش ينقل الملكية", () => {
    expect(routes).toContain("sellerScope(");
    expect((routes.match(/canAccessContact\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(routes).toContain("delete data.ownerUserId");
  });
  it("الحذف بيتمنع لو فيه فواتير أو أوامر شراء أو أصناف، والتعديل والحذف بيتسجلوا في التدقيق", () => {
    expect(routes).toContain("deleteBlocker(");
    expect(routes).toContain('actionKey: "contacts.edit"');
    expect(routes).toContain('actionKey: "contacts.delete"');
  });
  it("أوامر الشراء في النشاط من غير أسعار، ومش بتتبعت للبائع", () => {
    const a = routes.slice(routes.indexOf('"/contacts/:id/activity"'), routes.indexOf('"/contacts/:id",'));
    expect(a).not.toContain("purchaseOrdersTable.total");
    expect(a).toContain("seller");
  });
  it("الصفحة القديمة اتشالت وبقى ليها تحويل، والقايمة بتوجّه للجديدة", () => {
    expect(existsSync(resolve(process.cwd(), "public/contacts.html"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "public/JS/contacts.js"))).toBe(false);
    expect(read("src/main.ts")).toContain("contactsRedirectTarget");
    expect(read("src/lib/departments.ts")).toContain('href: "/v2/staff/contacts"');
    expect(read("src/lib/departments.ts")).not.toContain("contacts.html");
  });
  it("أدوار الواجهة نفس أدوار السيرفر", () => {
    const web = read("web/src/staff/staffRoles.ts");
    const pick = (name: string) => (web.match(new RegExp(`${name} = \\[([^\\]]*)\\]`))?.[1] ?? "").match(/"([a-z_]+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];
    const perms = read("src/lib/permissions.ts");
    const server = (kind: string) => {
      const block = perms.slice(perms.indexOf("contacts: {"));
      const m = block.match(new RegExp(`${kind}: \\[([^\\]]*)\\]`))?.[1] ?? "";
      return (m.match(/"([a-z_]+)"/g) ?? []).map((s) => s.replace(/"/g, ""));
    };
    expect(pick("CONTACT_ROLES").sort()).toEqual(server("view").sort());
    expect(pick("CONTACT_WRITE_ROLES").sort()).toEqual(server("write").sort());
  });
});
