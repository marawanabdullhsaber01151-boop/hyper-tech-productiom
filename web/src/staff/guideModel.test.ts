import { describe, expect, it } from "vitest";
import { edgeEnds, MAP_EDGES, MAP_NODES, ORDER_EDGES, ORDER_POS, ORDER_STATES, RESOURCES, levelOf, pagesForRole, resourceReach, roleAbilities, slaHours, tierFor, tierViews, type GuideNavDept, type GuidePermission, type GuidePolicyGroup, type GuideRole } from "./guideModel";

const perms: GuidePermission[] = [
  { resource: "sales", action: "view", roles: ["a", "b"] },
  { resource: "sales", action: "write", roles: ["a"] },
  { resource: "quality", action: "view", roles: ["b"] },
  { resource: "operationsControl", action: "planApprove", roles: ["c"] },
];
const roles: GuideRole[] = ["a", "b", "c", "d"].map((id) => ({ id, label: id, approver: false, exempt: false }));

describe("levelOf", () => {
  it("كتابة تغلب العرض، وغير موجود = none", () => {
    expect(levelOf(perms, "sales", "a")).toBe("write");
    expect(levelOf(perms, "sales", "b")).toBe("view");
    expect(levelOf(perms, "sales", "d")).toBe("none");
    expect(levelOf(perms, "nope", "a")).toBe("none");
  });
  it("أفعال عمليات التحكم (اعتماد خطة) بتتحسب كتابة", () => {
    expect(levelOf(perms, "operationsControl", "c")).toBe("write");
  });
});

describe("roleAbilities / resourceReach", () => {
  it("بترجّع كل الموارد بالترتيب", () => {
    expect(roleAbilities(perms, "a").map((x) => x.resource)).toEqual([...RESOURCES]);
  });
  it("العدّ: write/view لمورد", () => {
    expect(resourceReach(perms, roles, "sales")).toEqual({ view: 1, write: 1 });
    expect(resourceReach(perms, roles, "finance")).toEqual({ view: 0, write: 0 });
  });
});

const nav: GuideNavDept[] = [
  { id: "x", label: "X", icon: "i", roles: ["a"], subFunctions: [{ id: "s", label: "S", pages: [{ id: "p1", label: "P1", href: "/v2/p1", roles: ["a"] }, { id: "p2", label: "P2", href: "/v2/p2", roles: ["b"] }] }] },
  { id: "y", label: "Y", icon: "i", roles: ["b"], subFunctions: [{ id: "s", label: "S", pages: [{ id: "p3", label: "P3", href: "/v2/p3", roles: ["b"] }] }] },
];
describe("pagesForRole", () => {
  it("بيفلتر القسم والصفحة بالدور", () => {
    expect(pagesForRole(nav, "a").map((d) => [d.dept, d.pages.map((p) => p.id)])).toEqual([["x", ["p1"]]]);
    expect(pagesForRole(nav, "b").map((d) => d.dept)).toEqual(["y"]);
    expect(pagesForRole(nav, "zzz")).toEqual([]);
  });
});

const g: GuidePolicyGroup = { actionKey: "k", tiers: [
  { minAmount: "100000", steps: [{ sequence: 1, roles: ["x"], requiredApprovals: 1 }] },
  { minAmount: "0", steps: [{ sequence: 1, roles: ["y"], requiredApprovals: 2 }] },
] };
describe("tierViews / tierFor", () => {
  it("بيرتّب الشرائح ويحدد «لحد»", () => {
    const v = tierViews(g);
    expect(v.map((x) => [x.from, x.to])).toEqual([["0", "100000"], ["100000", null]]);
  });
  it("المبلغ على حدّ الشريحة بيدخل الشريحة الأعلى (≥)", () => {
    expect(tierFor(g, 99999.99)?.from).toBe("0");
    expect(tierFor(g, 100000)?.from).toBe("100000");
    expect(tierFor(g, 0)?.from).toBe("0");
  });
  it("مفيش سياسة تغطي المبلغ ← null (مفيش شريحة تبدأ من صفر)", () => {
    expect(tierFor({ actionKey: "k", tiers: [{ minAmount: "50", steps: [] }] }, 10)).toBeNull();
    expect(tierFor({ actionKey: "k", tiers: [] }, 10)).toBeNull();
  });
});

describe("slaHours", () => {
  it("240 دقيقة = 4 ساعات", () => {
    expect(slaHours(240)).toBe(4);
    expect(slaHours(90)).toBe(1.5);
  });
});

describe("خريطة النظام", () => {
  it("كل سهم بين عقدتين موجودتين، ومفيش عقدتين فوق بعض", () => {
    const ids = new Set(MAP_NODES.map((n) => n.id));
    for (const e of MAP_EDGES) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); }
    const pos = MAP_NODES.map((n) => `${n.x},${n.y}`);
    expect(new Set(pos).size).toBe(pos.length);
    expect(new Set(MAP_NODES.map((n) => n.id)).size).toBe(MAP_NODES.length);
  });
  it("كل عقدة ليها سهم واحد على الأقل (مفيش عقدة معزولة)", () => {
    for (const n of MAP_NODES) expect(MAP_EDGES.some((e) => e.from === n.id || e.to === n.id)).toBe(true);
  });
  it("edgeEnds: السهم بيبدأ وينتهي على حافة المستطيل مش جواه، وعمودي/أفقي مايبقاش NaN", () => {
    for (const e of MAP_EDGES) {
      const a = MAP_NODES.find((n) => n.id === e.from)!, b = MAP_NODES.find((n) => n.id === e.to)!;
      const p = edgeEnds(a, b, 0);
      for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
      expect(Math.hypot(p.x2 - p.x1, p.y2 - p.y1)).toBeGreaterThan(10);
    }
  });
});

describe("رحلة الأمر", () => {
  it("كل حالة ليها مكان وكل انتقال بين حالات معروفة", () => {
    for (const s of ORDER_STATES) expect(ORDER_POS[s]).toBeTruthy();
    for (const e of ORDER_EDGES) { expect(ORDER_STATES).toContain(e.from); expect(ORDER_STATES).toContain(e.to); }
  });
  it("الإلغاء نهاية: مفيش انتقال خارج من ملغي أو مدفوع", () => {
    expect(ORDER_EDGES.some((e) => e.from === "cancelled" || e.from === "paid")).toBe(false);
  });
});
