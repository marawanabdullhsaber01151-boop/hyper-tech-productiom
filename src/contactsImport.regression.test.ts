/** @format */
// استيراد العملاء (46): قراية الملفات كنص عشان الاختبار ميحتاجش قاعدة بيانات.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("استيراد العملاء", () => {
  const r = read("src/routes/contacts-import.ts");
  it("المساران محميان بصلاحية الإنشاء، والحفظ بمعاملة وتدقيق", () => {
    expect((r.match(/requireAuth, requirePermission\("contacts\.create"\)/g) ?? []).length).toBe(2);
    expect(r).toContain("db.transaction");
    expect(r).toContain('actionKey: "contacts.import"');
  });
  it("الحفظ بيعيد التحليل من الجدول ومبيثقش في حالات جاية من العميل", () => {
    const commit = r.slice(r.indexOf("/contacts/import/commit"));
    expect(commit).toContain("analyze(body.table)");
    expect(commit).toContain("rowsToCreate(r.rows, body.allowSimilarLines)");
  });
  it("البائع بيتخفى عنه بيانات جهات زمايله، والمالك بيتسجل", () => {
    expect(r).toContain("isSellerRole(req.user!.role)");
    expect(r).toContain('"جهة اتصال موجودة"');
    expect(r).toContain("ownerUserId: owner");
  });
  it("الراوتر متركب قبل contactsRouter، والواجهة بتستدعي المسارين", () => {
    const m = read("src/main.ts");
    expect(m.indexOf("contactsImportRouter)")).toBeGreaterThan(0);
    expect(m.indexOf("apiRouter.use(contactsImportRouter)")).toBeLessThan(m.indexOf("apiRouter.use(contactsRouter)"));
    const w = read("web/src/staff/ContactsImport.tsx");
    expect(w).toContain("/contacts/import/preview");
    expect(w).toContain("/contacts/import/commit");
  });
});
