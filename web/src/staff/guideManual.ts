/**
 * «الشرح التفصيلي لكل صفحة» (دليل النظام الموسّع): نموذج بيانات من غير أي نص عربي (النصوص في copy/guide5.ts).
 * كل شرح مربوط بشاشة من الفهرس (guideScreens). والجزء/الخطوة ممكن تتقيّد بأدوار (نفس ثوابت صفحات الشاشة نفسها،
 * عشان الدليل ما يقولش لحد يعمل حاجة الشاشة مش هتسمحله بيها) أو بصلاحية ممنوحة (استثناء مؤقت/دائم أو تفويض).
 */
import { ORDER_RECEIVE_ROLES, ORDER_CREATE_ROLES, ORDER_CANCEL_ROLES, ADVANCE_ROLES, DISPATCH_ROLES, CONFIRM_CUSTOMER_ROLES, CONFIRM_WAREHOUSE_ROLES, LIFECYCLE_ROLES, CORRECT_ROLES } from "./orderRules";
import { MATERIALS_DECIDE_ROLES } from "./materialsRules";
import { REQUEST_CREATE_ROLES, WAREHOUSE_DECIDE_ROLES, DIRECTOR_DECIDE_ROLES, NCR_CLOSE_ROLES, QUALITY_VIEW_ROLES } from "./productionRules";
import { QUALITY_DECIDE_ROLES } from "./qualityRules";
import { EXECUTE_ROLES } from "./executionCore";
import { STOPPAGE_WRITE_ROLES, OEE_READ_ROLES } from "./oeeCore";
import { PLANNING_ROLES, PLANNING_APPROVAL_ROLES } from "./planningCore";
import { TASK_MANAGER_ROLES } from "./tasksCore";
import { ACTIVITY_ROLES } from "./activityCore";
import { FOUNDATION_ROLES } from "./foundationCore";
import { SCREENS } from "./guideScreens";
import type { GuideNavDept, GuideNavPage } from "./guideModel";

type Roles = readonly string[];
export interface ManualGate { only?: Roles; grant?: readonly string[] }
export interface ManualStep extends ManualGate { id: string }
export interface ManualPart extends ManualGate { id: string; src: string }
export interface Manual {
  id: string;
  /** الشاشة (من فهرس الشاشات) اللي بتتحكم في مين يشوف الشرح */
  screen: string;
  steps: readonly ManualStep[];
  parts: readonly ManualPart[];
  /** أرقام شروحات تانية الصفحة دي بتتربط بيها */
  links: readonly string[];
  tips: number;
}

/** الصلاحيات (action keys) اللي بتفتح الشرح لو اتمنحت لموظف دوره مش بيشوفه. */
/** كل مفتاح هنا لازم يكون في سجل الإجراءات ومحمي بـrequirePermission في السيرفر (الاستثناءات بتشتغل عليه بس). */
const G = {
  cancel: ["productionWorkflow.cancel"],
  execute: ["productionWorkflow.execute"],
  warehouse: ["productionWorkflow.warehouseAction"],
  assign: ["tasks.assign"],
} as const;

const s = (id: string, gate: ManualGate = {}): ManualStep => ({ id, ...gate });
const p = (id: string, src: string, gate: ManualGate = {}): ManualPart => ({ id, src, ...gate });

export const MANUALS: readonly Manual[] = [
  {
    id: "preq", screen: "preq",
    steps: [s("open"), s("new", { only: REQUEST_CREATE_ROLES }), s("fields", { only: REQUEST_CREATE_ROLES }), s("wh", { only: WAREHOUSE_DECIDE_ROLES, grant: G.warehouse }), s("dir", { only: DIRECTOR_DECIDE_ROLES }), s("cancel"), s("after")],
    parts: [p("new", "prd:req.new", { only: REQUEST_CREATE_ROLES }), p("wa", "prd:act.warehouse_approve", { only: WAREHOUSE_DECIDE_ROLES }), p("wp", "prd:act.warehouse_partial", { only: WAREHOUSE_DECIDE_ROLES }), p("wr", "prd:act.warehouse_reject", { only: WAREHOUSE_DECIDE_ROLES }), p("dir", "prd:act.director", { only: DIRECTOR_DECIDE_ROLES }), p("cancel", "prd:act.cancel")],
    links: ["porders", "pquality", "planning"], tips: 3,
  },
  {
    id: "porders", screen: "porders",
    steps: [s("open"), s("filter"), s("new", { only: ORDER_CREATE_ROLES }), s("receive", { only: ORDER_RECEIVE_ROLES }), s("materials", { only: MATERIALS_DECIDE_ROLES, grant: G.warehouse }), s("dispatch", { only: DISPATCH_ROLES }), s("advance", { only: ADVANCE_ROLES }), s("exceptions", { only: LIFECYCLE_ROLES }), s("deliver", { only: ORDER_RECEIVE_ROLES }), s("confirm", { only: [...CONFIRM_CUSTOMER_ROLES, ...CONFIRM_WAREHOUSE_ROLES] }), s("correct", { only: CORRECT_ROLES }), s("cancel", { only: ORDER_CANCEL_ROLES, grant: G.cancel })],
    parts: [p("receive", "prd:ord.act.receive", { only: ORDER_RECEIVE_ROLES }), p("decide", "prd:ord.act.decide", { only: MATERIALS_DECIDE_ROLES, grant: G.warehouse }), p("dispatch", "prd:ord.act.dispatch", { only: DISPATCH_ROLES }), p("advance", "prd:ord.act.advance", { only: ADVANCE_ROLES }), p("hold", "prd:ord.act.hold", { only: LIFECYCLE_ROLES }), p("resume", "prd:ord.act.resume", { only: LIFECYCLE_ROLES }), p("rework", "prd:ord.act.rework", { only: LIFECYCLE_ROLES }), p("partial", "prd:ord.act.partial", { only: LIFECYCLE_ROLES }), p("deliver", "prd:ord.act.deliver", { only: ORDER_RECEIVE_ROLES }), p("confirm", "prd:ord.act.confirm", { only: [...CONFIRM_CUSTOMER_ROLES, ...CONFIRM_WAREHOUSE_ROLES] }), p("correct", "prd:ord.act.correct", { only: CORRECT_ROLES }), p("cancel", "prd:ord.act.cancel", { only: ORDER_CANCEL_ROLES, grant: G.cancel }), p("due", "prd:ord.act.due")],
    links: ["preq", "pexec", "pinspect", "tasks"], tips: 3,
  },
  {
    id: "pexec", screen: "pexec",
    steps: [s("open"), s("batch", { only: EXECUTE_ROLES, grant: G.execute }), s("confirm", { only: EXECUTE_ROLES, grant: G.execute }), s("downtime", { only: EXECUTE_ROLES, grant: G.execute }), s("close", { only: EXECUTE_ROLES, grant: G.execute }), s("readonly")],
    parts: [p("newBatch", "prd:ex.newBatch", { only: EXECUTE_ROLES, grant: G.execute }), p("confirm", "prd:ex.confirm", { only: EXECUTE_ROLES, grant: G.execute }), p("downtime", "prd:ex.downtime", { only: EXECUTE_ROLES, grant: G.execute }), p("close", "prd:ex.close", { only: EXECUTE_ROLES, grant: G.execute })],
    links: ["porders", "poee", "pquality", "costing"], tips: 3,
  },
  {
    id: "pquality", screen: "pexec",
    steps: [s("open", { only: QUALITY_VIEW_ROLES }), s("new", { only: QUALITY_VIEW_ROLES }), s("close", { only: NCR_CLOSE_ROLES }), s("trace", { only: QUALITY_VIEW_ROLES }), s("lot", { only: QUALITY_VIEW_ROLES })],
    parts: [p("tab", "prd:tab.quality", { only: QUALITY_VIEW_ROLES }), p("new", "prd:q.new", { only: QUALITY_VIEW_ROLES }), p("close", "prd:q.close", { only: NCR_CLOSE_ROLES }), p("trace", "prd:tab.trace", { only: QUALITY_VIEW_ROLES }), p("lot", "prd:tr.register", { only: QUALITY_VIEW_ROLES })],
    links: ["pexec", "pinspect"], tips: 2,
  },
  {
    id: "poee", screen: "pexec",
    steps: [s("open", { only: OEE_READ_ROLES }), s("start", { only: STOPPAGE_WRITE_ROLES }), s("end", { only: STOPPAGE_WRITE_ROLES }), s("report", { only: OEE_READ_ROLES }), s("read", { only: OEE_READ_ROLES })],
    parts: [p("tab", "prd:tab.oee", { only: OEE_READ_ROLES }), p("start", "prd:oee.start", { only: STOPPAGE_WRITE_ROLES }), p("end", "prd:oee.end", { only: STOPPAGE_WRITE_ROLES }), p("report", "prd:oee.report", { only: OEE_READ_ROLES })],
    links: ["pexec", "foundation", "engineering"], tips: 2,
  },
  {
    id: "pinspect", screen: "inspect",
    steps: [s("open", { only: QUALITY_DECIDE_ROLES }), s("check", { only: QUALITY_DECIDE_ROLES }), s("sample", { only: QUALITY_DECIDE_ROLES }), s("result", { only: QUALITY_DECIDE_ROLES }), s("history", { only: QUALITY_DECIDE_ROLES })],
    parts: [p("tab", "prd:tab.inspect", { only: QUALITY_DECIDE_ROLES }), p("start", "prd:insp.start", { only: QUALITY_DECIDE_ROLES }), p("pass", "prd:insp.passed", { only: QUALITY_DECIDE_ROLES }), p("fail", "prd:insp.failed", { only: QUALITY_DECIDE_ROLES })],
    links: ["porders", "pquality"], tips: 2,
  },
  {
    id: "costing", screen: "ledger",
    steps: [s("open"), s("batches"), s("view"), s("save"), s("final"), s("standards"), s("setstd"), s("read")],
    parts: [p("tab", "cst:tab"), p("batches", "cst:sub.batches"), p("standards", "cst:sub.standards"), p("open", "cst:b.open.btn"), p("save", "cst:d.save"), p("final", "cst:d.final"), p("std", "cst:s.edit")],
    links: ["pexec", "porders", "planning"], tips: 3,
  },
  {
    id: "planning", screen: "planning",
    steps: [s("open", { only: PLANNING_ROLES }), s("lines", { only: PLANNING_ROLES }), s("calc", { only: PLANNING_ROLES }), s("read", { only: PLANNING_ROLES }), s("save", { only: PLANNING_ROLES }), s("approve", { only: PLANNING_APPROVAL_ROLES }), s("req", { only: PLANNING_ROLES }), s("release", { only: PLANNING_APPROVAL_ROLES })],
    parts: [p("new", "pln:tab.new", { only: PLANNING_ROLES }), p("runs", "pln:tab.runs", { only: PLANNING_ROLES }), p("calc", "pln:calc", { only: PLANNING_ROLES }), p("save", "pln:save", { only: PLANNING_ROLES }), p("approve", "pln:d.approve", { only: PLANNING_APPROVAL_ROLES }), p("reqAll", "pln:d.reqAll", { only: PLANNING_ROLES }), p("release", "pln:d.release", { only: PLANNING_APPROVAL_ROLES })],
    links: ["engineering", "preq", "costing"], tips: 3,
  },
  {
    id: "tasks", screen: "tasks",
    steps: [s("open"), s("new"), s("target", { only: TASK_MANAGER_ROLES, grant: G.assign }), s("claim"), s("done"), s("move", { only: TASK_MANAGER_ROLES, grant: G.assign }), s("escalate"), s("team", { only: TASK_MANAGER_ROLES })],
    parts: [p("mine", "tasks:tab.mine"), p("team", "tasks:tab.team", { only: TASK_MANAGER_ROLES }), p("new", "tasks:new"), p("claim", "tasks:act.claim"), p("complete", "tasks:act.complete"), p("reassign", "tasks:act.reassign", { only: TASK_MANAGER_ROLES, grant: G.assign }), p("cancel", "tasks:act.cancel")],
    links: ["porders", "approvals"], tips: 3,
  },
  {
    id: "activity", screen: "activity",
    steps: [s("open", { only: ACTIVITY_ROLES }), s("filter", { only: ACTIVITY_ROLES }), s("views", { only: ACTIVITY_ROLES }), s("online", { only: ACTIVITY_ROLES }), s("read", { only: ACTIVITY_ROLES })],
    parts: [p("actor", "act:actor", { only: ACTIVITY_ROLES }), p("section", "act:section", { only: ACTIVITY_ROLES }), p("views", "act:views", { only: ACTIVITY_ROLES }), p("more", "act:more", { only: ACTIVITY_ROLES })],
    links: ["audit", "approvals"], tips: 2,
  },
  {
    id: "audit", screen: "foundation",
    steps: [s("open", { only: FOUNDATION_ROLES }), s("read", { only: FOUNDATION_ROLES }), s("chain"), s("diff")],
    parts: [p("tab", "fnd:tab.audit", { only: FOUNDATION_ROLES }), p("when", "fnd:a.col.when", { only: FOUNDATION_ROLES }), p("reason", "fnd:a.col.reason", { only: FOUNDATION_ROLES })],
    links: ["activity", "foundation"], tips: 2,
  },
];

export interface Viewer { roles: readonly string[]; grants: readonly string[] }
export const gateOpen = (g: ManualGate, v: Viewer): boolean => {
  if (!g.only && !g.grant) return true;
  if (g.only?.some((r) => v.roles.includes(r))) return true;
  return Boolean(g.grant?.some((k) => v.grants.includes(k)));
};


export interface CatalogEntry { manual: Manual; /** role = الشاشة في قايمتي؛ grant = جاية من صلاحية ممنوحة بس */ via: "role" | "grant"; opens: GuideNavPage[] }

const allPages = (nav: readonly GuideNavDept[]) => nav.flatMap((d) => d.subFunctions.flatMap((sf) => sf.pages));
const hasGate = (m: Manual, v: Viewer) => [...m.steps, ...m.parts].some((x) => x.grant?.some((k) => v.grants.includes(k)));

/**
 * الشروحات اللي تظهر لموظف: اللي شاشتها في قايمته (حسب دوره أو دور مفوَّض له)، أو فيها جزء اتفتح بصلاحية ممنوحة له.
 * الشاشات اللي من غير صفحة في القايمة (زي المهام) بتظهر للكل.
 */
export function manualCatalog(nav: readonly GuideNavDept[], v: Viewer): CatalogEntry[] {
  const pages = allPages(nav);
  const out: CatalogEntry[] = [];
  for (const m of MANUALS) {
    const scr = SCREENS.find((x) => x.id === m.screen);
    if (!scr || !m.steps.some((x) => gateOpen(x, v))) continue;
    const opens = scr.pages
      .map((id) => pages.find((pg) => pg.id === id))
      .filter((pg): pg is GuideNavPage => Boolean(pg) && pg!.roles.some((r) => v.roles.includes(r)))
      .filter((pg, i, a) => a.findIndex((o) => o.href === pg.href) === i);
    const own = scr.pages.length === 0 ? scr.side === "staff" : opens.length > 0;
    if (own) out.push({ manual: m, via: "role", opens });
    else if (hasGate(m, v)) out.push({ manual: m, via: "grant", opens: [] });
  }
  return out;
}
