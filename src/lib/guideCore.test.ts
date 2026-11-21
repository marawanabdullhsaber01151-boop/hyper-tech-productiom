/** @format */
import { describe, expect, it } from "vitest";
import { buildNav, buildRoles, flattenPermissions, groupPolicies, normAmount, slaSummary, type PolicyRow } from "./guideCore";
import { USER_ROLES } from "./roles";
import { PERMISSIONS } from "./permissions";
import { DEPARTMENTS } from "./departments";

const pol = (o: Partial<PolicyRow> & Pick<PolicyRow, "actionKey">): PolicyRow => ({ minAmount: "0", approverRoles: ["chairman"], sequence: 1, requiredApprovals: 1, active: true, ...o });

describe("buildRoles", () => {
  it("الـ18 دور كلهم بأسماء عربي، والمعتمد/المعفي صح", () => {
    const r = buildRoles(["chairman", "sales_manager"]);
    expect(r).toHaveLength(USER_ROLES.length);
    expect(r.every((x) => x.label.length > 0 && x.label !== x.id)).toBe(true);
    expect(r.find((x) => x.id === "sales_manager")).toMatchObject({ approver: true, exempt: false });
    expect(r.find((x) => x.id === "executive_manager")).toMatchObject({ approver: false, exempt: true });
    expect(r.find((x) => x.id === "chairman")).toMatchObject({ approver: true, exempt: true });
    expect(r.find((x) => x.id === "buyer")).toMatchObject({ approver: false, exempt: false });
  });
});

describe("flattenPermissions", () => {
  it("بيسطّح كل مورد/فعل، من غير تكرار، وبترتيب الأدوار الرسمي", () => {
    const flat = flattenPermissions({ a: { view: ["buyer", "chairman", "chairman"], write: [] } });
    expect(flat).toEqual([
      { resource: "a", action: "view", roles: ["chairman", "buyer"] },
      { resource: "a", action: "write", roles: [] },
    ]);
  });
  it("PERMISSIONS الحقيقية: كل صف أدواره أدوار معروفة", () => {
    const flat = flattenPermissions(PERMISSIONS as unknown as Record<string, Record<string, readonly string[]>>);
    expect(flat.length).toBeGreaterThan(20);
    for (const p of flat) for (const r of p.roles) expect((USER_ROLES as readonly string[]).includes(r)).toBe(true);
  });
  it("دور مجهول بيتحط في الآخر ومابيقعش", () => {
    expect(flattenPermissions({ a: { x: ["zzz", "chairman"] } })[0]!.roles).toEqual(["chairman", "zzz"]);
  });
});

describe("groupPolicies", () => {
  it("بيجمّع الشرائح بالمبلغ ويرتّب الخطوات، ويشيل المعطّل", () => {
    const g = groupPolicies([
      pol({ actionKey: "s", minAmount: "100000.00", sequence: 2, approverRoles: ["chairman"] }),
      pol({ actionKey: "s", minAmount: "100000.00", sequence: 1, approverRoles: ["executive_manager"] }),
      pol({ actionKey: "s", minAmount: "0.00", approverRoles: ["sales_manager"] }),
      pol({ actionKey: "s", minAmount: "5", active: false }),
      pol({ actionKey: "a", minAmount: "0" }),
    ]);
    expect(g.map((x) => x.actionKey)).toEqual(["a", "s"]);
    const s = g.find((x) => x.actionKey === "s")!;
    expect(s.tiers.map((t) => t.minAmount)).toEqual(["0", "100000"]);
    expect(s.tiers[1]!.steps.map((x) => x.sequence)).toEqual([1, 2]);
  });
  it("فاضي ← فاضي، وكلها معطّلة ← فاضي", () => {
    expect(groupPolicies([])).toEqual([]);
    expect(groupPolicies([pol({ actionKey: "x", active: false })])).toEqual([]);
  });
  it("مبلغ تالف بيتحوّل صفر (أقل شريحة) مش NaN", () => {
    expect(normAmount("abc")).toBe("0");
    expect(normAmount("-5")).toBe("0");
    expect(normAmount("1500.50")).toBe("1500.5");
  });
});

describe("slaSummary / buildNav", () => {
  it("المهلة 240 دقيقة والجمعة إجازة", () => {
    expect(slaSummary()).toMatchObject({ minutes: 240, soonAt: 0.75, hours: { start: 9, end: 17, offDay: 5 } });
  });
  it("buildNav بيحفظ كل الصفحات والأدوار", () => {
    const n = buildNav(DEPARTMENTS);
    expect(n).toHaveLength(DEPARTMENTS.length);
    const count = (d: ReadonlyArray<{ subFunctions: ReadonlyArray<{ pages: readonly unknown[] }> }>) => d.reduce((a, x) => a + x.subFunctions.reduce((b, s) => b + s.pages.length, 0), 0);
    expect(count(n)).toBe(count(DEPARTMENTS));
  });
});
