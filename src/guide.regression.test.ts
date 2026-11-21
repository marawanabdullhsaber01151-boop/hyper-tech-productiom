/** @format */
// دليل النظام (المرحلة 1): حراسة إن الدليل مايتأخرش عن النظام. أي دور/مورد/قسم/حالة جديدة من غير شرح = الاختبار يقع.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "./lib/permissions";
import { DEPARTMENTS } from "./lib/departments";
import { USER_ROLES } from "./lib/roles";
import { MAP_NODES, ORDER_STATES, RESOURCES, ORDER_EDGES, MAP_EDGES, APPROVAL_FLOW } from "../web/src/staff/guideModel";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");
const copyText = read("web/src/copy/guide.ts");
const has = (key: string) => copyText.includes(`"${key}":`);

describe("الصلاحيات ↔ الدليل", () => {
  it("كل مورد في PERMISSIONS ليه عمود في الدليل، ومفيش عمود لمورد مش موجود", () => {
    expect([...RESOURCES].sort()).toEqual(Object.keys(PERMISSIONS).sort());
  });
  it("كل مورد ليه اسم عربي، وكل دور ليه وصف", () => {
    for (const r of RESOURCES) expect(has(`guide.res.${r}`), `guide.res.${r}`).toBe(true);
    for (const r of USER_ROLES) expect(has(`guide.role.${r}`), `guide.role.${r}`).toBe(true);
  });
  it("مفيش وصف لدور اتشال", () => {
    const keys = [...copyText.matchAll(/"guide\.role\.([a-z_]+)":/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...USER_ROLES].sort());
  });
});

describe("الأقسام ↔ الخريطة", () => {
  it("كل قسم في القايمة له عقدة على الخريطة ووصف", () => {
    const mapped = new Set(MAP_NODES.map((n) => n.dept));
    for (const d of DEPARTMENTS) expect(mapped.has(d.id), `القسم ${d.id} مش على الخريطة`).toBe(true);
  });
  it("كل عقدة وسهم ليهم نص", () => {
    for (const n of MAP_NODES) { expect(has(`guide.node.${n.id}`), n.id).toBe(true); expect(has(`guide.dept.${n.id}`), n.id).toBe(true); }
    for (const e of MAP_EDGES) expect(has(`guide.edge.${e.key}`), e.key).toBe(true);
  });
  it("كل عقدة مربوطة بقسم حقيقي", () => {
    const ids = new Set(DEPARTMENTS.map((d) => d.id));
    for (const n of MAP_NODES) expect(n.dept !== null && ids.has(n.dept), n.id).toBe(true);
  });
});

describe("حالات الأمر ↔ الدليل", () => {
  it("حالات الأمر نفس حالات السيرفر (SALES_STATUSES) بالظبط", () => {
    const web = read("web/src/staff/salesCore.ts").match(/SALES_STATUSES = \[([^\]]+)\]/)![1]!.match(/"(\w+)"/g)!.map((s) => s.replace(/"/g, ""));
    expect([...ORDER_STATES].sort()).toEqual([...web].sort());
  });
  it("كل حالة: اسم + مين + مخزن + حسابات + تنبيه. وكل انتقال له اسم", () => {
    for (const s of ORDER_STATES) {
      expect(has(`guide.st.${s}`), s).toBe(true);
      for (const f of ["who", "stock", "money", "note"]) expect(has(`guide.st.${s}.${f}`), `${s}.${f}`).toBe(true);
    }
    for (const e of ORDER_EDGES) expect(has(`guide.oe.${e.key}`), e.key).toBe(true);
  });
});

describe("الاعتمادات ↔ الدليل", () => {
  it("كل إجراء اعتماد معروف في الهجرات له اسم عربي", () => {
    const sql = read("migrations/0025_approval_policies_seed.sql") + read("migrations/0104_credit_override_policy.sql");
    const keys = new Set([...sql.matchAll(/'([A-Za-z]+(?:\.[A-Za-z_]+)+)'/g)].map((m) => m[1]!).filter((x) => /\.(approve|create|record|credit_override)$/.test(x)));
    expect(keys.size).toBeGreaterThanOrEqual(5);
    for (const key of keys) expect(has(`guide.act.${key}`), key).toBe(true);
  });
  it("خطوات التدفق والقواعد الستة ليها نصوص", () => {
    for (const s of APPROVAL_FLOW) { expect(has(`guide.flow.${s}.t`)).toBe(true); expect(has(`guide.flow.${s}.d`)).toBe(true); }
    for (const r of ["self", "exempt", "reject", "deputy", "audit", "impact"]) expect(has(`guide.apv.rule.${r}`), r).toBe(true);
  });
  it("قواعد الدليل مطابقة للكود: الرفض 3 حروف، المهلة 4 ساعات، المعفيين رئيس ومدير تنفيذي", () => {
    const code = read("src/domain/approvals-inbox.ts");
    expect(code).toContain("REJECT_NOTE_MIN = 3");
    expect(code).toContain("SLA_WORKING_MINUTES = 240");
    expect(code).toContain('SELF_APPROVAL_EXEMPT: readonly string[] = ["chairman", "executive_manager"]');
    expect(copyText).toContain("3 حروف");
    expect(copyText).toContain("4 ساعات");
  });
});

describe("المسار والصفحة", () => {
  const route = read("src/routes/guide.ts");
  it("للقراءة بس ولأي موظف مسجّل، ومتوصّل في main", () => {
    expect(route).toContain("requireAuth");
    expect(route.match(/router\.(get|post|put|patch|delete)\(/g)).toEqual(["router.get("]);
    expect(read("src/main.ts")).toContain("apiRouter.use(guideRouter)");
  });
  it("الصفحة lazy ومسجلة على /staff/guide، ومتاحة من القايمة العلوية ومن Ctrl+K", () => {
    const app = read("web/src/app/App.tsx");
    expect(app).toContain('import("../staff/Guide")');
    expect(app).toContain('path: "/staff/guide"');
    expect(read("web/src/staff/Header.tsx")).toContain('navigate("/staff/guide")');
    expect(read("web/src/copy/lazy-dicts.ts")).toContain("guide: guideCopy");
  });
  it("نصوص الدليل من غير أرقام هندية (الأرقام لاتينية)", () => {
    expect(copyText).not.toMatch(/[٠-٩]/);
  });
});
