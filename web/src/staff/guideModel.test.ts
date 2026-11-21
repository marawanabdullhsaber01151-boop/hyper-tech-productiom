import { describe, expect, it } from "vitest";
import { SCREENS, GLOSSARY, SCENARIOS } from "./guideScreens";
import { ACC_TOPICS, AUTO_RULES, FLOWS, FLOW_IDS, FLOW_STEP_H, FLOW_STEP_W, flowPos, flowViewBox, edgeEnds, MAP_EDGES, MAP_NODES, ORDER_EDGES, ORDER_POS, ORDER_STATES, RESOURCES, levelOf, pagesForRole, resourceReach, roleAbilities, slaHours, tierFor, tierViews, type GuideNavDept, type GuidePermission, type GuidePolicyGroup, type GuideRole } from "./guideModel";

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


describe("خرائط العمليات (المرحلة 2)", () => {
  it("كل خريطة: معرّفات خطوات فريدة، كل سهم بين خطوتين موجودتين، ومفيش خطوة معزولة", () => {
    for (const id of FLOW_IDS) {
      const f = FLOWS[id];
      const ids = f.steps.map((s) => s.id);
      expect(new Set(ids).size, id).toBe(ids.length);
      for (const e of f.edges) { expect(ids, `${id}:${e.from}`).toContain(e.from); expect(ids, `${id}:${e.to}`).toContain(e.to); }
      for (const s of f.steps) expect(f.edges.some((e) => e.from === s.id || e.to === s.id), `${id}:${s.id}`).toBe(true);
    }
  });
  it("مفيش خطوتين على نفس الخانة، ومفيش سهم من خطوة لنفسها ولا سهم مكرر", () => {
    for (const id of FLOW_IDS) {
      const f = FLOWS[id];
      const cells = f.steps.map((s) => `${s.col},${s.row}`);
      expect(new Set(cells).size, id).toBe(cells.length);
      const pairs = f.edges.map((e) => `${e.from}>${e.to}`);
      expect(new Set(pairs).size, id).toBe(pairs.length);
      for (const e of f.edges) expect(e.from).not.toBe(e.to);
    }
  });
  it("الخطوة الأولى (أقصى اليمين) والنهايات (ملغي/مرفوض) مفيش منها أسهم خارجة", () => {
    for (const id of FLOW_IDS) for (const e of FLOWS[id].edges) expect(["cancelled", "rejected"]).not.toContain(e.from);
  });
  it("المقاسات: كل الخطوات جوه الرسمة والترتيب من اليمين لليسار", () => {
    for (const id of FLOW_IDS) {
      const f = FLOWS[id];
      const v = flowViewBox(f);
      for (const s of f.steps) {
        const p = flowPos(s);
        expect(p.x - FLOW_STEP_W / 2).toBeGreaterThanOrEqual(0);
        expect(p.x + FLOW_STEP_W / 2).toBeLessThanOrEqual(v.w);
        expect(p.y + FLOW_STEP_H / 2).toBeLessThanOrEqual(v.h);
      }
      const first = f.steps.find((s) => s.col === 0)!, next = f.steps.find((s) => s.col === 1)!;
      expect(flowPos(first).x).toBeGreaterThan(flowPos(next).x);
    }
  });
  it("مواضيع الحسابات وقواعد الترحيل من غير تكرار", () => {
    expect(new Set(ACC_TOPICS).size).toBe(ACC_TOPICS.length);
    expect(new Set(AUTO_RULES).size).toBe(AUTO_RULES.length);
  });
});

describe("فهرس الشاشات (بنية)", () => {
  it("معرّفات الشاشات والأزرار فريدة، وكل زرار ليه مفتاح src بصيغة prefix:rest", () => {
    expect(new Set(SCREENS.map((s) => s.id)).size).toBe(SCREENS.length);
    for (const s of SCREENS) {
      expect(new Set(s.buttons.map((b) => b.id)).size, s.id).toBe(s.buttons.length);
      for (const b of s.buttons) expect(b.src, `${s.id}.${b.id}`).toMatch(/^[a-z]+:[A-Za-z0-9.]+$/);
    }
  });
  it("شاشات العميل مالهاش صفحات قايمة، وشاشات الموظفين غالبًا ليها", () => {
    for (const s of SCREENS.filter((x) => x.side === "portal")) expect(s.pages).toEqual([]);
    expect(SCREENS.filter((x) => x.side === "staff" && x.pages.length > 0).length).toBeGreaterThan(15);
  });
  it("القاموس والسيناريوهات من غير تكرار وكل سيناريو له خطوتين على الأقل", () => {
    expect(new Set(GLOSSARY).size).toBe(GLOSSARY.length);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) expect(s.steps).toBeGreaterThanOrEqual(2);
  });
});

import { edgeGeom, segmentHitsBox, NW, NH, ORDER_W, ORDER_H } from "./guideModel";

type G = { id: string; x: number; y: number }[];
function crossings(nodes: G, edges: ReadonlyArray<{ from: string; to: string }>, w: number, h: number): string[] {
  const out: string[] = [];
  const by = new Map(nodes.map((n) => [n.id, n]));
  const rev = (a: string, b: string) => edges.some((e) => e.from === b && e.to === a);
  for (const e of edges) {
    const a = by.get(e.from)!, b = by.get(e.to)!;
    const g = edgeGeom(a, b, w, h, rev(e.from, e.to) ? 9 : 0);
    for (const n of nodes) {
      if (n.id === e.from || n.id === e.to) continue;
      if (segmentHitsBox(g.x1, g.y1, g.x2, g.y2, n, w, h, 3)) out.push(`${e.from}→${e.to} يعدّي فوق ${n.id}`);
    }
    for (const n of nodes) if (Math.abs(g.lx - n.x) < w / 2 && Math.abs(g.ly - n.y) < h / 2) out.push(`اسم ${e.from}→${e.to} فوق ${n.id}`);
  }
  return out;
}

describe("هندسة الخرائط: مفيش خط بيعدّي فوق مربع ومفيش اسم سهم فوق مربع", () => {
  it("خريطة النظام", () => {
    expect(crossings(MAP_NODES as unknown as G, MAP_EDGES, NW, NH)).toEqual([]);
  });
  it("رحلة أمر البيع", () => {
    const nodes = ORDER_STATES.map((s) => ({ id: s, ...ORDER_POS[s] }));
    expect(crossings(nodes, ORDER_EDGES, ORDER_W, ORDER_H)).toEqual([]);
  });
  it("كل خرائط العمليات", () => {
    for (const id of FLOW_IDS) {
      const f = FLOWS[id];
      const nodes = f.steps.map((s) => ({ id: s.id, ...flowPos(s) }));
      expect(crossings(nodes, f.edges, FLOW_STEP_W, FLOW_STEP_H), id).toEqual([]);
    }
  });
  it("السهمين العكس (إنتاج↔مخزن) أسماءهم متباعدة ومش فوق بعض", () => {
    const a = MAP_NODES.find((n) => n.id === "production")!, b = MAP_NODES.find((n) => n.id === "warehouse")!;
    const g1 = edgeGeom(b, a, NW, NH, 9), g2 = edgeGeom(a, b, NW, NH, 9);
    expect(Math.hypot(g1.lx - g2.lx, g1.ly - g2.ly)).toBeGreaterThan(14);
  });
  it("المسافة بين المربعات المتجاورة تكفي لاسم السهم (≥ 70)", () => {
    for (const e of MAP_EDGES) {
      const a = MAP_NODES.find((n) => n.id === e.from)!, b = MAP_NODES.find((n) => n.id === e.to)!;
      const g = edgeGeom(a, b, NW, NH, 0);
      expect(Math.hypot(g.x2 - g.x1, g.y2 - g.y1), `${e.from}→${e.to}`).toBeGreaterThan(50);
    }
  });
  it("segmentHitsBox: قطعة بتعدّي المربع = true، وقطعة بعيدة أو بتلمس الحافة بره الهامش = false", () => {
    const c = { x: 100, y: 100 };
    expect(segmentHitsBox(0, 100, 200, 100, c, 50, 50)).toBe(true);
    expect(segmentHitsBox(0, 0, 200, 0, c, 50, 50)).toBe(false);
    expect(segmentHitsBox(0, 100, 60, 100, c, 50, 50)).toBe(false);
    expect(segmentHitsBox(0, 100, 60, 100, c, 50, 50, 20)).toBe(true);
  });
});
