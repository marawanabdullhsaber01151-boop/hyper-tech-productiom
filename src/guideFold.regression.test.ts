/** @format */
// الطي في تبويبات الدليل التلاتة: مفيش نص اتشال (كل مفتاح لسه بيتعرض)، والعناصر الطويلة كلها جوه Fold.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const guide = read("web/src/staff/Guide.tsx");
const mine = read("web/src/staff/GuideMine.tsx");
const master = read("web/src/staff/GuideMaster.tsx");
const fold = read("web/src/staff/GuideFold.tsx");
const copy7 = read("web/src/copy/guide7.ts");

describe("الطي: التبويبات التلاتة", () => {
  it("كل تبويب بيستخدم Fold وأدوات الفتح/القفل، وبيستورد نصوصها", () => {
    for (const [name, src] of [["Guide", guide], ["GuideMine", mine], ["GuideMaster", master]] as const) {
      expect(src, name).toContain("<Fold");
      expect(src, name).toContain("<FoldTools");
      expect(src, name).toContain('import "../copy/guide7"');
    }
  });

  it("الشاشات: كارت الشاشة بقى Fold، والبحث بيفتح النتايج", () => {
    expect(guide).toContain("id={`gd-sc-${s.id}`}");
    expect(guide).toContain("open={needle ? true : undefined}");
    for (const key of ["guide.sc.${s.id}.t", "guide.sc.${s.id}.d", "guide.sc.${s.id}.b.${b.id}.l", "guide.sc.${s.id}.b.${b.id}.e"]) expect(guide, key).toContain(key);
  });

  it("كتالوجي: كل جزء من الشرح لسه بيتعرض جوه الـFold", () => {
    expect(mine).not.toContain('<article class="gd-card gd-man"');
    for (const key of ["guide.man.${m.id}.t", "guide.man.${m.id}.what"]) expect(mine, key).toContain(key);
    expect(mine).toMatch(/entries\.length <= 2/);
  });

  it("البيانات الأساسية: الخانة Fold والأربع صفوف (تكتب/مثال/اقتراح/تأثير) كلها موجودة", () => {
    for (const k of [".w`", ".x`", ".s`", ".e`"]) expect(master, k).toContain(k);
    expect(master).toContain("level={2}");
    expect(master).toContain('id="gd-md-cmp" open');
  });

  it("عنصر الطي بيستخدم details/summary الأصلية، والعنوان جوه summary", () => {
    expect(fold).toContain("<details");
    expect(fold).toContain("<summary>");
    expect(fold).not.toMatch(/useState/);
  });

  it("نصوص guide7 كلها موجودة وبتتستخدم", () => {
    const keys = [...copy7.matchAll(/"(guide\.fold\.[\w]+)":/g)].map((m) => m[1]!);
    expect(keys.length).toBe(6);
    const all = fold + guide + mine + master;
    for (const k of keys) expect(all, k).toContain(k);
  });
});
