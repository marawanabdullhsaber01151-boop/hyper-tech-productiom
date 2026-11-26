/** @format */
// دليل البوابة: النصوص كاملة، أسماء الأزرار = أسماء الشاشة الحقيقية، وكل كلام عن الصلاحيات مطابق للسيرفر والشاشات.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ENFORCED_PERMS, SECTIONS, UNENFORCED_PERMS, grantedAbilities, missingAbilities, portalCatalog } from "../web/src/portal/portalGuideModel";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const copy = read("web/src/copy/portalGuide.ts");
const val = (key: string) => copy.match(new RegExp(`"${key.replace(/\./g, "\\.")}": "((?:[^"\\\\]|\\\\.)*)"`))?.[1];
const uiCopy = (() => {
  const out = new Map<string, string>();
  const dir = resolve(__dirname, "../web/src/copy");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.startsWith("guide") || f === "portalGuide.ts") continue;
    for (const m of readFileSync(resolve(dir, f), "utf8").matchAll(/^\s*"([\w.]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) out.set(m[1]!, m[2]!);
  }
  return out;
})();
const serverPerms = new Map([...read("src/lib/portalPermissions.ts").matchAll(/key: "([\w.]+)", group: "\w+", label: "([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
const viewer = (permissions: string[], isOwner = false) => ({ isOwner, permissions });
const ids = (perms: string[], owner = false) => portalCatalog(viewer(perms, owner)).map((e) => e.section.id);

describe("دليل البوابة: اكتمال النصوص", () => {
  it("كل قسم ليه عنوان ووصف وخطوات ونصايح وأجزاء بالعدد المعلن، ومفيش زيادة", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["start", "home", "products", "cart", "orders", "quotes", "payments", "balances", "chat", "team", "account", "notif"]);
    for (const s of SECTIONS) {
      const b = `pg.${s.id}`;
      expect(val(`${b}.t`), b).toBeTruthy();
      expect((val(`${b}.what`) ?? "").length, b).toBeGreaterThan(20);
      for (const st of s.steps) expect((val(`${b}.s.${st.id}`) ?? "").length, `${b}.s.${st.id}`).toBeGreaterThan(20);
      expect(copy.includes(`"${b}.s.${s.steps.length + 1}"`), `${b}: خطوة زيادة`).toBe(false);
      for (let i = 1; i <= s.tips; i++) expect((val(`${b}.tip.${i}`) ?? "").length, `${b}.tip.${i}`).toBeGreaterThan(15);
      expect(copy.includes(`"${b}.tip.${s.tips + 1}"`), `${b}: نصيحة زيادة`).toBe(false);
      for (const p of s.parts) {
        expect(val(`${b}.p.${p.id}.l`), `${b}.p.${p.id}.l`).toBeTruthy();
        expect((val(`${b}.p.${p.id}.d`) ?? "").length, `${b}.p.${p.id}.d`).toBeGreaterThan(10);
      }
      const partIds = new Set(s.parts.map((p) => p.id));
      for (const m of copy.matchAll(new RegExp(`"${b}\\.p\\.(\\w+)\\.(?:l|d)":`, "g"))) expect(partIds.has(m[1]!), `جزء يتيم ${b}.${m[1]}`).toBe(true);
      expect(uiCopy.get(s.nav), `${s.id}: nav`).toBeTruthy();
    }
  });
  it("خطوات القسم متسلسلة 1..n من غير تكرار", () => {
    for (const s of SECTIONS) expect(s.steps.map((x) => x.id), s.id).toEqual(s.steps.map((_, i) => String(i + 1)));
  });
  it("اسم كل زرار/خانة في الدليل هو نفس اسمها الحقيقي على الشاشة", () => {
    for (const s of SECTIONS) for (const p of s.parts) {
      const real = uiCopy.get(p.src);
      expect(real, `${s.id}.${p.id} ← ${p.src}`).toBeTruthy();
      expect(val(`pg.${s.id}.p.${p.id}.l`), `${s.id}.${p.id}`).toBe(real);
    }
  });
  it("مفيش ألفاظ مش مؤكدة، ومفيش مرجع لحاجة مش موجودة في البوابة", () => {
    for (const m of copy.matchAll(/"pg\.[\w.]+": "((?:[^"\\]|\\.)*)"/g)) expect(m[1], m[0].slice(0, 40)).not.toMatch(/ربما|غالبًا|غالبا|يمكن أن/);
  });
});

describe("دليل البوابة: الصلاحيات مطابقة للسيرفر", () => {
  it("المفروضة + غير المفروضة = كل صلاحيات البوابة المسجلة، بدون تداخل (صلاحية جديدة تجبرنا نقرر)", () => {
    const all = [...serverPerms.keys()].sort();
    expect([...ENFORCED_PERMS, ...UNENFORCED_PERMS].sort()).toEqual(all);
  });
  it("اسم كل صلاحية في الدليل هو نفس اسمها عند السيرفر", () => {
    for (const k of ENFORCED_PERMS) {
      expect(val(`pg.ab.${k}.l`), k).toBe(serverPerms.get(k));
      expect((val(`pg.ab.${k}.d`) ?? "").length, k).toBeGreaterThan(10);
    }
  });
  const serverFiles = () => {
    const out: string[] = [];
    for (const dir of ["src/routes", "src/lib", "src/middleware"]) {
      for (const f of readdirSync(resolve(__dirname, "..", dir))) {
        if (!f.endsWith(".ts") || f.includes("test") || f === "portalPermissions.ts") continue;
        out.push(read(`${dir}/${f}`));
      }
    }
    return out.join("\n");
  };
  it("كل صلاحية قلنا إنها مفروضة السيرفر بيفحصها فعلًا", () => {
    const code = serverFiles();
    for (const k of ENFORCED_PERMS) expect(code.includes(`"${k}"`), `${k} مش بيتفحص في السيرفر`).toBe(true);
  });
  it("الصلاحيات اللي قلنا إنها غير مفروضة فعلًا مش بيتفحصها السيرفر (لو اتفرضت الاختبار يقع ونحدّث الدليل)", () => {
    const code = serverFiles();
    for (const k of UNENFORCED_PERMS) expect(code.includes(`"${k}"`), `${k} بقى مفروض: حدّث الدليل وENFORCED_PERMS`).toBe(false);
  });
});

describe("دليل البوابة: الشاشات بتخفي/تعرض زي ما الدليل بيقول", () => {
  const routes = read("web/src/portal/routes.tsx");
  const shell = read("web/src/portal/screens/Shell.tsx");
  it("الصفحات اللي ليها صلاحية في الدليل هي نفسها المحمية بنفس الصلاحية في المسارات", () => {
    for (const [path, perm] of [["cart", "cart.use"], ["payments", "payments.report"], ["balances", "payments.confirm_balance"], ["chat", "chat.use"], ["team", "team.view"]] as const) {
      expect(routes, path).toMatch(new RegExp(`path: "/portal/${path}".*perm="${perm.replace(".", "\\.")}"`));
      expect(SECTIONS.find((s) => s.id === path)?.perm, path).toEqual([perm]);
    }
    expect(shell).toMatch(/can\("orders\.view_own"\) \|\| can\("orders\.view_company"\)/);
    expect(SECTIONS.find((s) => s.id === "orders")?.perm).toEqual(["orders.view_own", "orders.view_company"]);
  });
  it("صفحة الدليل متاحة لأي موظف مسجّل (من غير صلاحية) وفي القايمة الجانبية", () => {
    expect(routes).toMatch(/path: "\/portal\/guide", render: \(\) => <Protected><LazyPage load=\{loadGuide\}/);
    expect(shell).toMatch(/to: "\/portal\/guide".*show: true/);
  });
  it("أزرار كل قسم متحكم فيها في الشاشة بنفس الصلاحية اللي في الدليل", () => {
    const files: Record<string, string> = {
      home: "web/src/portal/screens/Home.tsx", products: "web/src/portal/screens/Products.tsx", cart: "web/src/portal/screens/Cart.tsx",
      quotes: "web/src/portal/screens/PriceQuotes.tsx", team: "web/src/portal/screens/Team.tsx", account: "web/src/portal/screens/Account.tsx",
      orders: "web/src/portal/screens/Orders.tsx", chat: "web/src/portal/screens/Chat.tsx",
    };
    const server = read("src/routes/portal.ts");
    for (const s of SECTIONS) {
      const gated = [...s.steps, ...s.parts].flatMap((x) => x.perm ?? []);
      for (const perm of new Set(gated)) {
        if (s.perm?.includes(perm)) continue;
        const file = files[s.id];
        if (!file) continue;
        const code = read(file) + (s.id === "orders" || s.id === "quotes" ? server : "");
        expect(code.includes(`"${perm}"`), `${s.id}: ${perm} مش متحكم فيها في الشاشة/السيرفر`).toBe(true);
      }
    }
  });
  it("كارت الترحيب في الرئيسية بيستخدم علامة «شاف الدليل»، والدليل بيعلّمها", () => {
    expect(read("web/src/portal/screens/Home.tsx")).toMatch(/guideSeen\(auth\.member\?\.id\)/);
    expect(read("web/src/portal/screens/PortalGuide.tsx")).toMatch(/markGuideSeen\(member\?\.id\)/);
  });
});

describe("دليل البوابة: كل عضو بيشوف كتالوجه بس", () => {
  it("رئيس الشركة: كل الأقسام بكل الخطوات والأزرار", () => {
    const c = portalCatalog(viewer([], true));
    expect(c.map((e) => e.section.id)).toEqual(SECTIONS.map((s) => s.id));
    for (const e of c) { expect(e.steps.length).toBe(e.section.steps.length); expect(e.parts.length).toBe(e.section.parts.length); }
    expect(missingAbilities(viewer([], true))).toEqual([]);
  });
  it("المشتري: السلة والطلبات والعروض والإرسال، من غير تحويلات ولا أرصدة ولا محادثة ولا فريق", () => {
    const buyer = ["cart.use", "orders.create", "orders.view_own", "orders.cancel_own"];
    expect(ids(buyer)).toEqual(["start", "home", "products", "cart", "orders", "quotes", "account", "notif"]);
    const orders = portalCatalog(viewer(buyer)).find((e) => e.section.id === "orders")!;
    expect(orders.steps.map((x) => x.id)).not.toContain("3");
    expect(orders.parts.map((x) => x.id)).toContain("cancel");
    expect(orders.parts.map((x) => x.id)).not.toContain("all");
  });
  it("مشاهد بس (طلباته من غير سلة): بيشوف الطلبات من غير السلة وزرار «اطلب تاني» ولا الإرسال", () => {
    const viewerOnly = ["orders.view_own"];
    expect(ids(viewerOnly)).toEqual(["start", "home", "products", "orders", "quotes", "account", "notif"]);
    const q = portalCatalog(viewer(viewerOnly)).find((e) => e.section.id === "quotes")!;
    expect(q.parts.map((x) => x.id)).not.toContain("order");
    const o = portalCatalog(viewer(viewerOnly)).find((e) => e.section.id === "orders")!;
    expect(o.parts.map((x) => x.id)).not.toContain("reorder");
    const pr = portalCatalog(viewer(viewerOnly)).find((e) => e.section.id === "products")!;
    expect(pr.parts.map((x) => x.id)).not.toContain("add");
  });
  it("مسؤول المالية في الشركة: التحويلات والأرصدة", () => {
    const fin = ["payments.report", "payments.confirm_balance"];
    expect(ids(fin)).toEqual(["start", "home", "products", "payments", "balances", "account", "notif"]);
  });
  it("موظف بيشوف الفريق بس: خطوتين من غير إضافة ولا إدارة ولا كود", () => {
    const team = portalCatalog(viewer(["team.view"])).find((e) => e.section.id === "team")!;
    expect(team.steps.map((x) => x.id)).toEqual(["1", "2"]);
    expect(team.parts.map((x) => x.id)).toEqual(["members"]);
  });
  it("مدير الفريق: كل خطوات الفريق", () => {
    const all = ["team.view", "team.invite", "team.manage", "team.approve_join", "company.manage_code", "company.settings", "audit.view"];
    const team = portalCatalog(viewer(all)).find((e) => e.section.id === "team")!;
    expect(team.steps.length).toBe(8);
    expect(team.parts.length).toBe(14);
  });
  it("المحادثة: المراقبة (محادثات الفريق) بصلاحيتها بس", () => {
    const base = portalCatalog(viewer(["chat.use"])).find((e) => e.section.id === "chat")!;
    expect(base.steps.map((x) => x.id)).not.toContain("4");
    const mon = portalCatalog(viewer(["chat.use", "chat.view_company"])).find((e) => e.section.id === "chat")!;
    expect(mon.steps.map((x) => x.id)).toContain("4");
  });
  it("موظف من غير أي صلاحية: الأساسيات بس (بداية، رئيسية، منتجات، حسابي، إشعارات)", () => {
    expect(ids([])).toEqual(["start", "home", "products", "account", "notif"]);
  });
  it("«تقدر / مش متاح ليك» قسمين من غير تداخل ومجموعهم كل الصلاحيات المفروضة", () => {
    const v = viewer(["cart.use", "orders.create"]);
    const can = grantedAbilities(v);
    const cannot = missingAbilities(v);
    expect(can).toEqual(["cart.use", "orders.create"]);
    expect([...can, ...cannot].sort()).toEqual([...ENFORCED_PERMS].sort());
  });
  it("الأقسام اللي بتتخبى لو الصلاحية اتسحبت (نفس الدالة بتتحسب كل مرة)", () => {
    expect(ids(["payments.report"])).toContain("payments");
    expect(ids([])).not.toContain("payments");
  });
});
