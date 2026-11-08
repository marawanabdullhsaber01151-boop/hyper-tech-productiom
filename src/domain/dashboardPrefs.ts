/** @format */
/**
 * تفضيلات لوحة الرئيسية (الخطوة 41ب): ترتيب الكروت وإخفاء/إظهار لكل مستخدم. دوال نقية، والسيرفر والواجهة
 * بيتفقوا على نفس قايمة الكروت. أي رقم كارت مش معروف بيتشال بدل ما يكسر الحفظ.
 */
export const DASHBOARD_CARD_IDS = ["kpis", "status", "alerts", "orders", "categories", "summary"] as const;
export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number];
export interface DashboardPrefs { order: DashboardCardId[]; hidden: DashboardCardId[] }
export const DASHBOARD_PREF_KEY = "dashboard.layout";
export const DEFAULT_DASHBOARD_PREFS: DashboardPrefs = { order: [...DASHBOARD_CARD_IDS], hidden: [] };

const known = (v: unknown): v is DashboardCardId => typeof v === "string" && (DASHBOARD_CARD_IDS as readonly string[]).includes(v);
const uniqueKnown = (v: unknown): DashboardCardId[] => {
  const out: DashboardCardId[] = [];
  if (Array.isArray(v)) for (const x of v) if (known(x) && !out.includes(x)) out.push(x);
  return out;
};

/** تنضيف أي قيمة جاية (من الطلب أو من القاعدة): كروت معروفة بس، من غير تكرار، والناقص بيتضاف في الآخر بالترتيب الأصلي. */
export function normalizePrefs(raw: unknown): DashboardPrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const order = uniqueKnown(o.order);
  for (const id of DASHBOARD_CARD_IDS) if (!order.includes(id)) order.push(id);
  return { order, hidden: uniqueKnown(o.hidden) };
}

/** الطلب لازم يكون شكله سليم: order مصفوفة و hidden مصفوفة، وكل العناصر كروت معروفة. */
export function isValidPrefsInput(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  const ok = (v: unknown) => Array.isArray(v) && v.length <= DASHBOARD_CARD_IDS.length * 2 && v.every(known);
  return ok(o.order) && ok(o.hidden);
}
