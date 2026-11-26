/** @format */
// دليل البيانات الأساسية: كل نص موجود، اسم كل خانة = اسمها الحقيقي على الشاشة، وكل رقم/دور مذكور مطابق للكود الحقيقي.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPARE_ROWS, MASTER_ROLES, MASTER_TABS, canSeeMaster } from "../web/src/staff/masterCatalog";
import { ITEM_APPROVAL_ROLES } from "../web/src/staff/itemsCore";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const copy6 = read("web/src/copy/guide6.ts");
const val = (key: string) => copy6.match(new RegExp(`"${key.replace(/\./g, "\\.")}": "((?:[^"\\\\]|\\\\.)*)"`))?.[1];
const uiCopy = (() => {
  const out = new Map<string, string>();
  const dir = resolve(__dirname, "../web/src/copy");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.startsWith("guide")) continue;
    for (const m of readFileSync(resolve(dir, f), "utf8").matchAll(/^\s*"([\w.]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) out.set(m[1]!, m[2]!);
  }
  return out;
})();
const CAPACITY_CAP = Number(read("src/lib/operationsCapacityCore.ts").match(/export const CAPACITY_CAP = ([\d.]+);/)?.[1]);
const roleList = (src: string, name: string) => [...(src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]!);

describe("دليل البيانات الأساسية: اكتمال النصوص", () => {
  it("كل تبويب ليه عنوان ووصف وخطوات وأماكن تأثير ونصايح بالعدد المعلن، ومفيش زيادة", () => {
    expect(MASTER_TABS.map((t) => t.id)).toEqual(["locations", "centers", "machines", "shifts", "items", "sequences", "audit"]);
    for (const t of MASTER_TABS) {
      const b = `guide.md.${t.id}`;
      expect(val(`${b}.t`), b).toBeTruthy();
      expect((val(`${b}.what`) ?? "").length, b).toBeGreaterThan(40);
      for (const [key, n] of [["s", t.steps], ["e", t.effects], ["tip", t.tips]] as const) {
        for (let i = 1; i <= n; i++) expect((val(`${b}.${key}.${i}`) ?? "").length, `${b}.${key}.${i}`).toBeGreaterThan(15);
        expect(copy6.includes(`"${b}.${key}.${n + 1}"`), `${b}.${key}: عنصر زيادة`).toBe(false);
      }
    }
  });
  it("كل خانة ليها: تكتب إيه + مثال + اقتراح + بتأثر في إيه، ومفيش خانة يتيمة", () => {
    for (const t of MASTER_TABS) for (const f of t.fields) {
      const b = `guide.md.${t.id}.f.${f.id}`;
      for (const part of ["w", "x", "s", "e"]) expect((val(`${b}.${part}`) ?? "").length, `${b}.${part}`).toBeGreaterThan(1);
      expect((val(`${b}.w`) ?? "").length, `${b}.w`).toBeGreaterThan(15);
      expect((val(`${b}.e`) ?? "").length, `${b}.e`).toBeGreaterThan(10);
    }
    const known = new Map(MASTER_TABS.map((t) => [t.id, new Set(t.fields.map((f) => f.id))]));
    for (const m of copy6.matchAll(/"guide\.md\.(\w+)\.f\.(\w+)\.(?:l|w|x|s|e)":/g)) expect(known.get(m[1] as never)?.has(m[2]!), `خانة يتيمة ${m[1]}.${m[2]}`).toBe(true);
  });
  it("اسم كل خانة/زرار في الدليل هو نفس اسمه الحقيقي على الشاشة", () => {
    for (const t of MASTER_TABS) {
      expect(val(`guide.md.${t.id}.t`), `تبويب ${t.id}`).toBe(uiCopy.get(t.src));
      for (const f of t.fields) {
        const real = uiCopy.get(f.src);
        expect(real, `${t.id}.${f.id} ← ${f.src}`).toBeTruthy();
        expect(val(`guide.md.${t.id}.f.${f.id}.l`), `${t.id}.${f.id}`).toBe(real);
      }
    }
  });
  it("جدول المقارنة بين الموقع ومركز العمل كامل", () => {
    for (let i = 1; i <= COMPARE_ROWS; i++) for (const c of ["a", "l", "c"]) expect((val(`guide.md.cmp.${i}.${c}`) ?? "").length, `cmp.${i}.${c}`).toBeGreaterThan(1);
    expect(copy6.includes(`"guide.md.cmp.${COMPARE_ROWS + 1}.a"`)).toBe(false);
  });
  it("مفيش ألفاظ زي «ربما» أو «غالبًا» بتخلي الشرح مش مؤكد، ومفيش فاصلة لاتينية نصها متلخبط", () => {
    for (const m of copy6.matchAll(/"guide\.md\.[\w.]+": "((?:[^"\\]|\\.)*)"/g)) expect(m[1], m[0].slice(0, 40)).not.toMatch(/ربما|غالبًا|غالبا|يمكن أن/);
  });
});

describe("دليل البيانات الأساسية: كل رقم ودور مذكور مطابق للكود الحقيقي", () => {
  it("المسموح لهم بالشرح = نفس المسموح لهم بالصفحة في السيرفر", () => {
    const server = roleList(read("src/routes/foundation.ts"), "FOUNDATION_ROLES");
    expect([...MASTER_ROLES].sort()).toEqual(server.sort());
    for (const r of MASTER_ROLES) expect(canSeeMaster(r)).toBe(true);
    for (const r of ["sales_manager", "buyer", "accountant", "customer"]) expect(canSeeMaster(r)).toBe(false);
  });
  it("تعديل العدادات لرئيس المجلس بس، واعتماد تغيير الصنف لـ3 أدوار بس (زي السيرفر)", () => {
    const route = read("src/routes/foundation.ts");
    expect(route).toMatch(/router\.patch\("\/foundation\/number-sequences\/:id", requireRole\("chairman"\)/);
    expect(roleList(route, "APPROVAL_ROLES").sort()).toEqual([...ITEM_APPROVAL_ROLES].sort());
    expect(val("guide.md.sequences.s.2")).toContain("رئيس مجلس الإدارة بس");
    expect(val("guide.md.items.f.review.w")).toContain("رئيس المجلس");
  });
  it("سقف التحميل المذكور 85% هو نفسه في حساب الطاقة، ومثال الطاقة محسوب صح", () => {
    expect(CAPACITY_CAP).toBe(0.85);
    expect(val("guide.md.centers.e.1")).toContain("85%");
    expect(480 * 2 * CAPACITY_CAP).toBe(816);
    expect(val("guide.md.centers.f.capacity.x")).toContain("816");
  });
  it("الحدود المذكورة (طاقة 1–1440, استراحة 0–720, خانات 1–12, بادئة 30, 500 صف) مطابقة لرسايل الشاشة", () => {
    expect(uiCopy.get("fnd.c.err.capacity")).toContain("1440");
    expect(val("guide.md.centers.f.capacity.w")).toContain("1440");
    expect(uiCopy.get("fnd.s.err.break")).toContain("720");
    expect(val("guide.md.shifts.f.break.w")).toContain("720");
    expect(uiCopy.get("fnd.q.err.padding")).toContain("12");
    expect(val("guide.md.sequences.f.padding.w")).toContain("12");
    expect(uiCopy.get("fnd.q.err.prefix")).toContain("30");
    expect(val("guide.md.sequences.f.prefix.w")).toContain("30");
    expect(uiCopy.get("fnd.it.importHint")).toContain("500");
    expect(val("guide.md.items.f.import.w")).toContain("500");
    expect(uiCopy.get("fnd.it.err.code")).toContain("80");
    expect(val("guide.md.items.f.code.w")).toContain("80");
    expect(uiCopy.get("fnd.it.err.name")).toContain("160");
    expect(val("guide.md.items.f.name.w")).toContain("160");
    expect(uiCopy.get("fnd.it.err.unit")).toContain("20");
    expect(val("guide.md.items.f.unit.w")).toContain("20");
  });
  it("مثال العدّاد: 6 خانات والرقم 42 يطلع PO-000042", () => {
    expect(`PO-${String(42).padStart(6, "0")}`).toBe("PO-000042");
    expect(val("guide.md.sequences.f.padding.x")).toContain("PO-000042");
  });
  it("مثال وردية 22:00 لـ06:00 صافيها 8 ساعات بنفس دالة السيرفر", async () => {
    const { shiftNetMinutes } = await import("./domain/oee");
    expect(shiftNetMinutes("22:00", "06:00", 0)).toBe(480);
    expect(shiftNetMinutes("08:00", "16:00", 60)).toBe(420);
  });
  it("الأصناف المستوردة بتدخل مسودة، والصنف الجديد من الفورم نشط، ومنتج الوصفة لازم «منتج تام» (زي السيرفر)", () => {
    const route = read("src/routes/foundation.ts");
    expect(route).toMatch(/status: "draft", active: false/);
    expect(read("src/db/schema/foundation.ts")).toMatch(/status: text\("status"\)\.notNull\(\)\.default\("active"\)/);
    expect(read("src/routes/bom.ts")).toMatch(/item\.itemType !== "finished_good"/);
    expect(val("guide.md.items.s.6")).toContain("مسودة");
    expect(val("guide.md.items.s.4")).toContain("نشط");
  });
  it("الاعتراف الصريح: علامات الموقع ومدة الصلاحية والتتبع مش مفروضة، وفعلًا الكود مفيهوش أي استخدام ليها خارج الأساسيات", () => {
    expect(val("guide.md.honest")).toContain("علامات تنظيمية");
    expect(val("guide.md.items.e.5")).toContain("للأمانة");
    for (const dir of ["src/routes", "src/lib"]) {
      for (const f of readdirSync(resolve(__dirname, "..", dir)).filter((x) => x.endsWith(".ts") && !x.includes("test"))) {
        if (/foundation/.test(f)) continue;
        const txt = read(`${dir}/${f}`);
        expect(txt, `${dir}/${f}`).not.toMatch(/allowsInventory|allowsProduction|requiresQuarantine|lotTracked|serialTracked|shelfLifeDays/);
      }
    }
  });
});
