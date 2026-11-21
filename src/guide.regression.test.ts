/** @format */
// دليل النظام (المرحلة 1): حراسة إن الدليل مايتأخرش عن النظام. أي دور/مورد/قسم/حالة جديدة من غير شرح = الاختبار يقع.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FLOWS, FLOW_IDS, ACC_TOPICS, AUTO_RULES } from "../web/src/staff/guideModel";
import { QUALITY_PASS_RATE } from "./lib/productionQualityCore";
import { PO_STATUSES } from "./lib/purchasing";
import { AUTO_ACCOUNT_CODES, STOCK_ACCOUNT_BY_CATEGORY } from "./lib/ledgerAutoCore";
import { CANONICAL_PRODUCTION_STATUSES } from "./domain/production-lifecycle";
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

const copy2 = read("web/src/copy/guide2.ts");
const has2 = (key: string) => copy2.includes(`"${key}":`);

describe("المرحلة 2: كل خطوة وسهم ليهم شرح كامل", () => {
  it("كل خطوة: اسم + مين + إيه اللي بيحصل + خد بالك. وكل سهم له اسم", () => {
    for (const id of FLOW_IDS) {
      expect(has2(`guide.fl.${id}.title`), id).toBe(true);
      expect(has2(`guide.fl.${id}.intro`), id).toBe(true);
      for (const s of FLOWS[id].steps) for (const f of ["n", "who", "does", "note"]) expect(has2(`guide.fl.${id}.s.${s.id}.${f}`), `${id}.${s.id}.${f}`).toBe(true);
      for (const e of FLOWS[id].edges) expect(has2(`guide.fl.${id}.e.${e.key}`), `${id}.e.${e.key}`).toBe(true);
    }
  });
  it("مفيش شرح يتيم: كل مفتاح خطوة/سهم في النصوص ليه خطوة/سهم في الخريطة", () => {
    for (const m of copy2.matchAll(/"guide\.fl\.(\w+)\.s\.(\w+)\.(n|who|does|note)":/g)) {
      const flow = FLOWS[m[1] as keyof typeof FLOWS];
      expect(flow, m[1]).toBeTruthy();
      expect(flow.steps.some((s) => s.id === m[2]), `${m[1]}.${m[2]}`).toBe(true);
    }
    for (const m of copy2.matchAll(/"guide\.fl\.(\w+)\.e\.(\w+)":/g)) expect(FLOWS[m[1] as keyof typeof FLOWS].edges.some((e) => e.key === m[2]), `${m[1]}.${m[2]}`).toBe(true);
  });
  it("الحسابات: كل موضوع وكل قاعدة ترحيل ليها نص", () => {
    for (const id of ACC_TOPICS) { expect(has2(`guide.acc.${id}.t`), id).toBe(true); expect(has2(`guide.acc.${id}.d`), id).toBe(true); }
    for (const r of AUTO_RULES) for (const f of ["ev", "dr", "cr"]) expect(has2(`guide.acc.rule.${r}.${f}`), `${r}.${f}`).toBe(true);
  });
  it("الشرح متطابق مع الكود: أكواد الحسابات ونسبة الجودة وحالات الشراء", () => {
    expect(copy2).toContain(`(${AUTO_ACCOUNT_CODES.receivable})`);
    expect(copy2).toContain(`(${AUTO_ACCOUNT_CODES.sales})`);
    expect(copy2).toContain(`(${AUTO_ACCOUNT_CODES.suppliers})`);
    for (const c of Object.values(STOCK_ACCOUNT_BY_CATEGORY)) expect(copy2).toContain(c);
    expect(QUALITY_PASS_RATE).toBe(95);
    expect(copy2).toContain("95%");
    expect([...PO_STATUSES]).toEqual(["draft", "pending_approval", "approved", "sent", "partially_received", "received", "cancelled"]);
  });
  it("حالات أمر الإنتاج الـ21 اتغيّرت؟ لو اتغيّرت راجع خريطة أمر الإنتاج في الدليل", () => {
    expect(CANONICAL_PRODUCTION_STATUSES).toHaveLength(21);
    for (const s of ["new", "claimed", "in_production", "quality_check", "completed", "rework", "cancelled", "partially_completed"]) expect(CANONICAL_PRODUCTION_STATUSES as readonly string[]).toContain(s);
  });
  it("قواعد البوابة والمشتريات المذكورة موجودة في الكود: كلمة سر العميل 6، فصل مهام الفحص، اعتماد الشراء", () => {
    expect(read("src/db/schema/portal-customers.ts")).toContain("min(6,");
    expect(read("src/lib/receiving.ts")).toContain("violatesSeparation");
    expect(read("src/lib/purchasing.ts")).toContain('PO_APPROVER_ROLES = ["chairman", "purchasing_manager"]');
    expect(read("src/routes/purchases.ts")).toContain("violatesSeparation(role");
  });
  it("الصفحة سجّلت نصوص المرحلة 2 (lazy)", () => {
    expect(read("web/src/staff/Guide.tsx")).toContain('import "../copy/guide2"');
    expect(read("web/src/copy/lazy-dicts.ts")).toContain("guide2: guide2Copy");
  });
});
