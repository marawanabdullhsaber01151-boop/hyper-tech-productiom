/** @format */
// الشرح التفصيلي لكل صفحة (كتالوجي): كل نص موجود، كل اسم زرار مطابق للشاشة، وكل قيد دور/صلاحية مطابق للسيرفر.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MANUALS, manualCatalog, gateOpen, type Viewer } from "../web/src/staff/guideManual";
import { SCREENS } from "../web/src/staff/guideScreens";
import { DEPARTMENTS } from "./lib/departments";
import { buildNav } from "./lib/guideCore";
import { findAction } from "./lib/actionRegistry";
import { USER_ROLES } from "./lib/roles";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const copy5 = read("web/src/copy/guide5.ts");
const val = (key: string) => copy5.match(new RegExp(`"${key.replace(/\./g, "\\.")}": "((?:[^"\\\\]|\\\\.)*)"`))?.[1];
const uiCopy = (() => {
  const out = new Map<string, string>();
  const dir = resolve(__dirname, "../web/src/copy");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.startsWith("guide")) continue;
    for (const m of readFileSync(resolve(dir, f), "utf8").matchAll(/^\s*"([\w.]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) out.set(m[1]!, m[2]!);
  }
  return out;
})();
const nav = buildNav(DEPARTMENTS);
const view = (role: string, grants: string[] = [], extra: string[] = []): Viewer => ({ roles: [role, ...extra], grants });
const ids = (v: Viewer) => manualCatalog(nav, v).map((e) => e.manual.id);
const steps = (id: string, v: Viewer) => MANUALS.find((m) => m.id === id)!.steps.filter((s) => gateOpen(s, v)).map((s) => s.id);

describe("كتالوجي: اكتمال النصوص", () => {
  it("كل شرح ليه عنوان ووصف، وكل خطوة وجزء ورابط ونصيحة ليهم نص، ومفيش نص يتيم", () => {
    expect(new Set(MANUALS.map((m) => m.id)).size).toBe(MANUALS.length);
    for (const m of MANUALS) {
      expect(val(`guide.man.${m.id}.t`), m.id).toBeTruthy();
      expect((val(`guide.man.${m.id}.what`) ?? "").length, m.id).toBeGreaterThan(40);
      for (const s of m.steps) expect((val(`guide.man.${m.id}.s.${s.id}`) ?? "").length, `${m.id}.s.${s.id}`).toBeGreaterThan(20);
      for (const x of m.parts) { expect(val(`guide.man.${m.id}.p.${x.id}.l`), `${m.id}.p.${x.id}.l`).toBeTruthy(); expect((val(`guide.man.${m.id}.p.${x.id}.e`) ?? "").length, `${m.id}.p.${x.id}.e`).toBeGreaterThan(10); }
      for (const to of m.links) expect((val(`guide.man.${m.id}.k.${to}`) ?? "").length, `${m.id}.k.${to}`).toBeGreaterThan(15);
      for (let i = 1; i <= m.tips; i++) expect((val(`guide.man.${m.id}.tip.${i}`) ?? "").length, `${m.id}.tip.${i}`).toBeGreaterThan(15);
      expect(copy5.includes(`"guide.man.${m.id}.tip.${m.tips + 1}"`), `${m.id}: نصيحة زيادة`).toBe(false);
    }
    const stepsOf = new Map(MANUALS.map((m) => [m.id, new Set(m.steps.map((s) => s.id))]));
    const partsOf = new Map(MANUALS.map((m) => [m.id, new Set(m.parts.map((s) => s.id))]));
    const linksOf = new Map(MANUALS.map((m) => [m.id, new Set(m.links)]));
    for (const mm of copy5.matchAll(/"guide\.man\.(\w+)\.s\.(\w+)":/g)) expect(stepsOf.get(mm[1]!)?.has(mm[2]!), `خطوة يتيمة ${mm[1]}.${mm[2]}`).toBe(true);
    for (const mm of copy5.matchAll(/"guide\.man\.(\w+)\.p\.(\w+)\.(?:l|e)":/g)) expect(partsOf.get(mm[1]!)?.has(mm[2]!), `جزء يتيم ${mm[1]}.${mm[2]}`).toBe(true);
    for (const mm of copy5.matchAll(/"guide\.man\.(\w+)\.k\.(\w+)":/g)) expect(linksOf.get(mm[1]!)?.has(mm[2]!), `رابط يتيم ${mm[1]}.${mm[2]}`).toBe(true);
  });
  it("اسم كل زرار/تبويب في الشرح هو نفس اسمه الحقيقي على الشاشة", () => {
    for (const m of MANUALS) for (const x of m.parts) {
      const real = uiCopy.get(x.src.replace(":", "."));
      expect(real, `${m.id}.${x.id} ← ${x.src} مش موجود في نصوص الواجهة`).toBeTruthy();
      expect(val(`guide.man.${m.id}.p.${x.id}.l`), `${m.id}.${x.id}`).toBe(real);
    }
  });
  it("كل رابط بيشاور على شرح أو شاشة موجودة، وكل شاشة الشرح مربوطة بيها موجودة", () => {
    const screens = new Set(SCREENS.map((s) => s.id));
    const manuals = new Set(MANUALS.map((m) => m.id));
    for (const m of MANUALS) {
      expect(screens.has(m.screen), m.id).toBe(true);
      for (const to of m.links) expect(manuals.has(to) || screens.has(to), `${m.id} → ${to}`).toBe(true);
    }
  });
  it("الأرقام لاتينية، ومفيش علامات تنسيق مكسورة، والتبويب متسجل (lazy)", () => {
    expect(copy5).not.toMatch(/[٠-٩]/);
    expect(read("web/src/staff/Guide.tsx")).toContain('import "../copy/guide5"');
    expect(read("web/src/staff/Guide.tsx")).toContain("<GuideMine live={live} />");
    expect(read("web/src/copy/lazy-dicts.ts")).toContain("guide5: guide5Copy");
    expect(read("web/src/staff/GuideMine.tsx")).toContain('"/guide/mine"');
  });
});

describe("كتالوجي: القيود مطابقة للسيرفر", () => {
  it("كل دور في قيد «only» دور حقيقي", () => {
    const roles = new Set<string>(USER_ROLES);
    for (const m of MANUALS) for (const g of [...m.steps, ...m.parts]) for (const r of g.only ?? []) expect(roles.has(r), `${m.id}: ${r}`).toBe(true);
  });
  it("كل صلاحية ممنوحة في الشرح موجودة في سجل الإجراءات ومحمية بـrequirePermission فعلًا (يعني الاستثناء بيشتغل)", () => {
    const routes = readdirSync(resolve(__dirname, "routes")).filter((f) => f.endsWith(".ts") && !f.includes(".test.")).map((f) => read(`src/routes/${f}`)).join("\n");
    const keys = new Set(MANUALS.flatMap((m) => [...m.steps, ...m.parts].flatMap((g) => g.grant ?? [])));
    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) {
      expect(findAction(key), key).toBeTruthy();
      expect(routes.includes(`requirePermission("${key}")`) || routes.includes(`"${key}"`), `${key} مش محمي في أي مسار`).toBe(true);
    }
  });
  it("/guide/mine موجود ومحتاج تسجيل دخول بس ومربوط بالاستثناءات والتفويضات", () => {
    const r = read("src/routes/guide.ts");
    expect(r).toContain('"/guide/mine", requireAuth');
    expect(r).toContain("permissionOverridesTable");
    expect(r).toContain("delegationsTable");
    expect(r).toMatch(/isNull\(permissionOverridesTable\.revokedAt\)/);
  });
});

describe("كتالوجي: كل دور بيشوف اللي يخصه بس", () => {
  it("رئيس مجلس الإدارة بيشوف كل الشروحات", () => {
    expect(new Set(ids(view("chairman")))).toEqual(new Set(MANUALS.map((m) => m.id)));
  });
  it("مدير المبيعات مفيهوش تكلفة ولا تخطيط ولا نشاط ولا تدقيق، ولا خطوات التنفيذ", () => {
    const got = ids(view("sales_manager"));
    for (const id of ["costing", "planning", "activity", "audit", "pexec", "poee", "pinspect"]) expect(got, id).not.toContain(id);
    expect(got).toContain("tasks");
  });
  it("المشتري: مفيش إنتاج خالص، لكن المهام موجودة", () => {
    const got = ids(view("buyer"));
    for (const id of ["preq", "porders", "pexec", "planning", "costing"]) expect(got, id).not.toContain(id);
    expect(got).toContain("tasks");
  });
  it("أمين المخزن في طلبات الإنتاج: قرار المخزن آه، إنشاء الطلب وقرار الإدارة لأ", () => {
    const v = view("storekeeper");
    expect(ids(v)).toContain("preq");
    const s = steps("preq", v);
    expect(s).toContain("wh");
    expect(s).not.toContain("new");
    expect(s).not.toContain("dir");
  });
  it("المشرف: ينشئ طلب ويسجل تنفيذ ويتقدم بالأمر، لكن مفيش قرار مخزن ولا إلغاء أمر", () => {
    const v = view("supervisor");
    expect(steps("preq", v)).toContain("new");
    expect(steps("preq", v)).not.toContain("wh");
    expect(steps("pexec", v)).toContain("batch");
    expect(steps("porders", v)).toContain("advance");
    expect(steps("porders", v)).not.toContain("cancel");
  });
  it("مدير الإنتاج بيعتمد التخطيط، لكن مدير المخازن بيشوف التخطيط من غير الاعتماد", () => {
    expect(steps("planning", view("production_manager"))).toContain("approve");
    const wm = view("warehouse_manager");
    expect(ids(wm)).toContain("planning");
    expect(steps("planning", wm)).toContain("save");
    expect(steps("planning", wm)).not.toContain("approve");
    expect(steps("planning", wm)).not.toContain("release");
  });
  it("المهام: المدير بيشوف الإسناد وتبويب الفريق، والموظف العادي لأ", () => {
    for (const x of ["target", "team", "move"]) expect(steps("tasks", view("sales_manager"))).toContain(x);
    const s = steps("tasks", view("buyer"));
    expect(s).toContain("new");
    for (const x of ["target", "team", "move"]) expect(s).not.toContain(x);
  });
  it("سجل النشاط للإدارة العليا بس", () => {
    expect(ids(view("chairman"))).toContain("activity");
    expect(ids(view("executive_manager"))).toContain("activity");
    for (const r of ["sales_manager", "production_manager", "buyer", "storekeeper"]) expect(ids(view(r)), r).not.toContain("activity");
  });
  it("مفيش دور بيشوف شرح من غير ولا خطوة (الصفحات الفاضية بتتخبى)", () => {
    for (const role of USER_ROLES) for (const e of manualCatalog(nav, view(role))) expect(e.manual.steps.some((s) => gateOpen(s, view(role))), `${role}/${e.manual.id}`).toBe(true);
  });
});

describe("كتالوجي: الصلاحيات الممنوحة والأدوار المفوّضة", () => {
  it("المشتري من غير صلاحية مايشوفش التنفيذ، ومعاه productionWorkflow.execute بيظهر له كشرح «بصلاحية إضافية»", () => {
    expect(ids(view("buyer"))).not.toContain("pexec");
    const v = view("buyer", ["productionWorkflow.execute"]);
    const e = manualCatalog(nav, v).find((x) => x.manual.id === "pexec");
    expect(e?.via).toBe("grant");
    expect(e?.opens).toEqual([]);
    for (const x of ["batch", "confirm", "downtime", "close"]) expect(steps("pexec", v)).toContain(x);
  });
  it("مدير المبيعات (بيشوف أوامر الإنتاج بس) ومعاه صلاحية الإلغاء: خطوة الإلغاء تظهر، ومن غيرها لأ", () => {
    expect(steps("porders", view("sales_manager"))).not.toContain("cancel");
    expect(steps("porders", view("sales_manager", ["productionWorkflow.cancel"]))).toContain("cancel");
  });
  it("لما الصلاحية تتسحب أو تخلص (مش في قايمة grants) الشرح بيختفي", () => {
    expect(ids(view("buyer", []))).not.toContain("pexec");
    expect(ids(view("buyer", ["productionWorkflow.execute"]))).toContain("pexec");
  });
  it("صلاحية مالهاش علاقة بصفحة (sales.create) مبتفتحش شرح إنتاج", () => {
    expect(ids(view("buyer", ["sales.create"]))).not.toContain("pexec");
  });
  it("دور مفوّض (extraRoles) بيضيف شرحه: المشتري + مدير المخازن بيشوف قرار المخزن في طلبات الإنتاج", () => {
    expect(ids(view("buyer"))).not.toContain("preq");
    const v = view("buyer", [], ["warehouse_manager"]);
    expect(ids(v)).toContain("preq");
    expect(steps("preq", v)).toContain("wh");
  });
  it("قرار المخزن بالصلاحية الممنوحة productionWorkflow.warehouseAction", () => {
    expect(steps("porders", view("production_manager"))).not.toContain("materials");
    expect(steps("porders", view("production_manager", ["productionWorkflow.warehouseAction"]))).toContain("materials");
  });
});
