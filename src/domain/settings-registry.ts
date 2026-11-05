/** @format */
// مركز الإعدادات (الخطوة 40أ): سجل منظّم لكل إعداد (نوعه، حدوده، قيمته الافتراضية) + تحقق + حساب التغييرات. نقي من غير قاعدة بيانات.

export type SettingGroup = "company" | "operations" | "security";
export type SettingType = "text" | "email" | "int" | "select";
export interface SettingOption { value: string; label: string }
export interface SettingDef {
  key: string;
  group: SettingGroup;
  type: SettingType;
  label: string;
  hint?: string;
  unit?: string;
  default: string;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: readonly SettingOption[];
}

const WEEKDAYS: readonly SettingOption[] = [
  { value: "6", label: "السبت" }, { value: "0", label: "الأحد" }, { value: "1", label: "الاثنين" }, { value: "2", label: "الثلاثاء" },
  { value: "3", label: "الأربعاء" }, { value: "4", label: "الخميس" }, { value: "5", label: "الجمعة" },
];

export const SETTING_DEFS: readonly SettingDef[] = [
  { key: "company_name", group: "company", type: "text", label: "اسم الشركة", default: "", maxLength: 120 },
  { key: "company_phone", group: "company", type: "text", label: "تليفون الشركة", default: "", maxLength: 40 },
  { key: "company_email", group: "company", type: "email", label: "إيميل الشركة", default: "", maxLength: 120 },
  { key: "company_address", group: "company", type: "text", label: "عنوان الشركة", default: "", maxLength: 250 },
  { key: "currency", group: "company", type: "select", label: "العملة", default: "EGP", options: [{ value: "EGP", label: "جنيه مصري" }, { value: "USD", label: "دولار أمريكي" }, { value: "SAR", label: "ريال سعودي" }] },
  { key: "fiscal_year_start", group: "company", type: "select", label: "بداية السنة المالية", default: "01-01", options: [{ value: "01-01", label: "يناير" }, { value: "04-01", label: "أبريل" }, { value: "07-01", label: "يوليو" }, { value: "10-01", label: "أكتوبر" }] },
  { key: "work.start_hour", group: "operations", type: "int", label: "بداية الدوام", hint: "الساعة (بتوقيت القاهرة، من 0 لـ 23).", unit: "ساعة", default: "9", min: 0, max: 23 },
  { key: "work.end_hour", group: "operations", type: "int", label: "نهاية الدوام", hint: "الساعة (بتوقيت القاهرة، من 1 لـ 24) وبتكون بعد البداية.", unit: "ساعة", default: "17", min: 1, max: 24 },
  { key: "work.off_day", group: "operations", type: "select", label: "يوم الإجازة الأسبوعية", default: "5", options: WEEKDAYS },
  { key: "approval.sla_hours", group: "operations", type: "int", label: "مهلة الرد على طلب الاعتماد", hint: "بساعات العمل. بعدها بيتفتح تنبيه للإدارة العليا.", unit: "ساعة عمل", default: "4", min: 1, max: 48 },
  { key: "stall.percent", group: "operations", type: "int", label: "حساسية «أمر واقف»", hint: "100 = الحدود الأصلية لكل مرحلة. أقل = تنبيه أبكر، وأكتر = تنبيه أبطأ.", unit: "%", default: "100", min: 25, max: 300 },
  { key: "security.require_2fa_top", group: "security", type: "select", label: "طلب التحقق بخطوتين للإدارة العليا", hint: "مقفول = صحة النظام ما بتذكرش الموضوع خالص. مفعّل = لو حساب رئيس مجلس الإدارة أو المدير التنفيذي من غير تحقق بخطوتين بتظهر ملاحظة.", default: "off", options: [{ value: "off", label: "مقفول" }, { value: "on", label: "مفعّل" }] },
];

/** مفاتيح قديمة مسموحة في السيرفر للتوافق، من غير شاشة (مفيش كود بيقراها). */
export const LEGACY_SETTING_KEYS: readonly string[] = ["company_logo", "currency_symbol", "language", "timezone", "low_stock_alert_enabled", "default_payment_terms", "invoice_footer_note", "vat_rate", "vat_enabled"];

export const defOf = (key: string): SettingDef | undefined => SETTING_DEFS.find((d) => d.key === key);
export const isKnownKey = (key: string) => !!defOf(key) || LEGACY_SETTING_KEYS.includes(key);

export type ValueCheck = { ok: true; value: string } | { ok: false; error: "type" | "range" | "length" | "option" | "email" | "required" };

/** بيتحقق من قيمة إعداد ويرجّع الشكل المخزّن. السنة المالية القديمة («01») بتتحوّل لـ«01-01». */
export function checkValue(def: SettingDef, raw: unknown): ValueCheck {
  const s = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : null;
  if (s === null) return { ok: false, error: "type" };
  if (def.type === "int") {
    if (!/^\d{1,4}$/.test(s)) return { ok: false, error: "type" };
    const n = Number(s);
    if (n < (def.min ?? 0) || n > (def.max ?? 9999)) return { ok: false, error: "range" };
    return { ok: true, value: String(n) };
  }
  if (def.type === "select") {
    const v = def.key === "fiscal_year_start" && /^\d{2}$/.test(s) ? `${s}-01` : s;
    return def.options?.some((o) => o.value === v) ? { ok: true, value: v } : { ok: false, error: "option" };
  }
  if (s.length > (def.maxLength ?? 250)) return { ok: false, error: "length" };
  if (def.type === "email" && s !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { ok: false, error: "email" };
  if (def.key === "company_name" && s === "") return { ok: false, error: "required" };
  return { ok: true, value: s };
}

export type SettingValues = Record<string, string>;

/** القيم الفعلية: المخزّن لو صالح، وإلا الافتراضي (قيمة تالفة ما توقفش النظام). */
export function resolveSettings(stored: Readonly<Record<string, string>>): SettingValues {
  const out: SettingValues = {};
  for (const d of SETTING_DEFS) {
    const raw = stored[d.key];
    const c = raw === undefined ? null : checkValue(d, raw);
    out[d.key] = c && c.ok ? c.value : d.default;
  }
  return out;
}

export interface SettingChange { key: string; before: string; after: string }
export type SettingsIssue = { key: string; error: Exclude<ValueCheck, { ok: true }>["error"] | "unknown" | "hours" };

/** بيحسب اللي اتغير فعلًا (القيم المتساوية بتتجاهل) ويرجّع مشاكل التحقق، بما فيها: النهاية بعد البداية. */
export function planChanges(current: Readonly<Record<string, string>>, updates: Readonly<Record<string, unknown>>): { changes: SettingChange[]; issues: SettingsIssue[]; next: SettingValues } {
  const base = resolveSettings(current);
  const next: SettingValues = { ...base };
  const changes: SettingChange[] = [];
  const issues: SettingsIssue[] = [];
  for (const [key, raw] of Object.entries(updates)) {
    const def = defOf(key);
    if (!def) { issues.push({ key, error: "unknown" }); continue; }
    const c = checkValue(def, raw);
    if (!c.ok) { issues.push({ key, error: c.error }); continue; }
    next[key] = c.value;
    if (c.value !== base[key]) changes.push({ key, before: base[key], after: c.value });
  }
  if (Number(next["work.end_hour"]) <= Number(next["work.start_hour"])) issues.push({ key: "work.end_hour", error: "hours" });
  return { changes, issues, next };
}

export interface WorkConfig { startHour: number; endHour: number; offDay: number }
export interface OperationalConfig { work: WorkConfig; slaMinutes: number; stallFactor: number }

export function operationalConfig(values: Readonly<Record<string, string>>): OperationalConfig {
  const v = resolveSettings(values);
  return {
    work: { startHour: Number(v["work.start_hour"]), endHour: Number(v["work.end_hour"]), offDay: Number(v["work.off_day"]) },
    slaMinutes: Number(v["approval.sla_hours"]) * 60,
    stallFactor: Number(v["stall.percent"]) / 100,
  };
}
export const DEFAULT_OPERATIONAL: OperationalConfig = operationalConfig({});
