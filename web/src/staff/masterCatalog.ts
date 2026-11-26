/**
 * «دليل البيانات الأساسية»: نموذج بيانات من غير أي نص عربي (النصوص في copy/guide6.ts).
 * كل تبويب في صفحة البيانات الأساسية له شرح، وكل خانة فيه لها: تكتب إيه (w) + مثال (x) + اقتراح (s) + بتأثر في إيه (e).
 * `src` = مفتاح النص الحقيقي على الشاشة (fnd.*). نص الخانة في الدليل لازم يطابقه حرفيًا (اختبار بيضمن كده).
 */
import "../copy/foundation";
import { FOUNDATION_ROLES } from "./foundationCore";

export interface MasterField { id: string; src: string }
export interface MasterTab {
  id: "locations" | "centers" | "machines" | "shifts" | "items" | "sequences" | "audit";
  /** عنوان التبويب على الشاشة */
  src: string;
  fields: readonly MasterField[];
  /** عدد الخطوات / أماكن الظهور / النصايح */
  steps: number;
  effects: number;
  tips: number;
}

const f = (id: string, src: string): MasterField => ({ id, src });
const CODE = f("code", "fnd.f.code");
const NAME = f("name", "fnd.f.name");
const NOTES = f("notes", "fnd.f.notes");

export const MASTER_TABS: readonly MasterTab[] = [
  {
    id: "locations", src: "fnd.tab.locations", steps: 5, effects: 4, tips: 3,
    fields: [CODE, NAME, f("type", "fnd.l.type"), f("parent", "fnd.l.parent"), f("inv", "fnd.l.inv"), f("prod", "fnd.l.prod"), f("quar", "fnd.l.quar"), NOTES],
  },
  {
    id: "centers", src: "fnd.tab.centers", steps: 5, effects: 5, tips: 3,
    fields: [CODE, NAME, f("type", "fnd.c.type"), f("location", "fnd.c.location"), f("capacity", "fnd.c.capacity"), NOTES],
  },
  {
    id: "machines", src: "fnd.tab.machines", steps: 5, effects: 4, tips: 3,
    fields: [CODE, NAME, f("center", "fnd.m.center"), f("serial", "fnd.m.serial"), f("calibration", "fnd.m.calibration"), f("maintenance", "fnd.m.maintenance"), f("status", "fnd.m.changeStatus"), NOTES],
  },
  {
    id: "shifts", src: "fnd.tab.shifts", steps: 4, effects: 3, tips: 3,
    fields: [CODE, NAME, f("start", "fnd.s.start"), f("end", "fnd.s.end"), f("break", "fnd.s.break"), f("night", "fnd.s.night"), NOTES],
  },
  {
    id: "items", src: "fnd.tab.items", steps: 6, effects: 5, tips: 4,
    fields: [
      f("code", "fnd.it.f.code"), f("name", "fnd.it.f.name"), f("type", "fnd.it.f.type"), f("unit", "fnd.it.f.unit"), f("min", "fnd.it.f.min"),
      f("shelf", "fnd.it.f.shelf"), f("lot", "fnd.it.f.lot"), f("serial", "fnd.it.f.serial"), f("notes", "fnd.it.f.notes"), f("reason", "fnd.it.f.reason"),
      f("aliases", "fnd.it.aliases"), f("conv", "fnd.it.conv"), f("import", "fnd.it.import"), f("dups", "fnd.it.dups"), f("history", "fnd.it.history"), f("review", "fnd.it.review"),
    ],
  },
  {
    id: "sequences", src: "fnd.tab.sequences", steps: 4, effects: 3, tips: 3,
    fields: [f("prefix", "fnd.q.prefix"), f("padding", "fnd.q.padding"), f("next", "fnd.q.next")],
  },
  { id: "audit", src: "fnd.tab.audit", fields: [], steps: 3, effects: 2, tips: 2 },
];

/** صفوف المقارنة «الموقع مقابل مركز العمل». */
export const COMPARE_ROWS = 6;

/** مين يشوف الدليل ده: نفس مين يقدر يفتح الصفحة نفسها. */
export const MASTER_ROLES = FOUNDATION_ROLES;
export const canSeeMaster = (role: string): boolean => (MASTER_ROLES as readonly string[]).includes(role);
