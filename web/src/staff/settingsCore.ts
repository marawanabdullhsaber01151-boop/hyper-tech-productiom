/** منطق مركز الإعدادات النقي (الخطوة 40أ). السيرفر هو الحَكَم: بيتحقق من كل قيمة تاني ويرفض غير الصالح. */
export const SETTINGS_ROLES = ["chairman"] as const;

export interface SettingOption { value: string; label: string }
export interface SettingDef {
  key: string; group: "company" | "operations" | "security"; type: "text" | "email" | "int" | "select";
  label: string; hint?: string; unit?: string; default: string; min?: number; max?: number; maxLength?: number; options?: SettingOption[];
}
export type SettingValues = Record<string, string>;

export const defsOf = (defs: readonly SettingDef[], group: SettingDef["group"]) => defs.filter((d) => d.group === group);

/** اللي اتغير فعلًا بين القيم المحفوظة والمسودة. */
export function dirtyKeys(defs: readonly SettingDef[], saved: Readonly<SettingValues>, draft: Readonly<SettingValues>): string[] {
  return defs.filter((d) => (draft[d.key] ?? saved[d.key]) !== saved[d.key]).map((d) => d.key);
}
export const changedPayload = (keys: readonly string[], draft: Readonly<SettingValues>) => Object.fromEntries(keys.map((k) => [k, draft[k]]));

export type FieldError = "required" | "number" | "range" | "email" | "length" | "hours" | "days";

/** تحقق سريع قبل الإرسال (نفس قواعد السيرفر). بيرجّع الأخطاء لكل مفتاح. */
export function validateDraft(defs: readonly SettingDef[], draft: Readonly<SettingValues>): Record<string, FieldError> {
  const out: Record<string, FieldError> = {};
  for (const d of defs) {
    const v = (draft[d.key] ?? "").trim();
    if (d.type === "int") {
      if (!/^\d{1,4}$/.test(v)) out[d.key] = "number";
      else if (Number(v) < (d.min ?? 0) || Number(v) > (d.max ?? 9999)) out[d.key] = "range";
    } else if (d.type === "email") {
      if (v !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) out[d.key] = "email";
    } else if (d.type === "text") {
      if (v.length > (d.maxLength ?? 250)) out[d.key] = "length";
      else if (d.key === "company_name" && v === "") out[d.key] = "required";
    }
  }
  const s = Number(draft["work.start_hour"]), e = Number(draft["work.end_hour"]);
  if (!out["work.end_hour"] && !out["work.start_hour"] && e <= s) out["work.end_hour"] = "hours";
  if (draft["work.off_day_2"] && draft["work.off_day_2"] !== "none" && draft["work.off_day_2"] === draft["work.off_day"]) out["work.off_day_2"] = "days";
  return out;
}

export interface HistoryRow { id: number; createdAt: string; actor: string; key: string; label: string; before: string; after: string; reason: string | null }

/** القيمة بشكل مقروء: الاختيارات باسمها، والأرقام بوحدتها، والفاضي بشرطة. */
export function displayValue(def: SettingDef | undefined, raw: string): string {
  if (raw === "") return "—";
  if (def?.options) return def.options.find((o) => o.value === raw)?.label ?? raw;
  return def?.unit ? `${raw} ${def.unit}` : raw;
}
