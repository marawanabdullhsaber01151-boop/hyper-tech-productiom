/** منطق التوقفات والكفاءة النقي (الخطوة 37ب). السيرفر هو الحَكَم (src/routes/production-oee.ts). */
export const STOPPAGE_WRITE_ROLES = ["chairman", "production_manager", "production_controller", "supervisor"] as const;
export const OEE_READ_ROLES = [...STOPPAGE_WRITE_ROLES, "production_quality_controller", "executive_manager", "operations_manager"] as const;
export const canReadOee = (role: string | undefined) => !!role && (OEE_READ_ROLES as readonly string[]).includes(role);
export const canWriteStoppage = (role: string | undefined) => !!role && (STOPPAGE_WRITE_ROLES as readonly string[]).includes(role);

export interface OeeMachine { id: number; code: string; name: string; status: string; openStoppage: { id: number; reasonCode: string; startedAt: string; notes: string | null } | null }
export interface OeeRow {
  machineId: number; code: string; name: string; stoppages: number; openStoppage: boolean; missingStandards: number;
  availability: number | null; performance: number | null; quality: number | null; oee: number | null;
  plannedMinutes: number; downtimeMinutes: number; runMinutes: number; produced: number;
}
export interface OeeReportData {
  from: string; to: string; workingDays: number; dailyShiftMinutes: number;
  machines: OeeRow[]; total: Omit<OeeRow, "machineId" | "code" | "name" | "openStoppage"> & { missingStandards: number; stoppages: number };
}

export type RangePreset = "today" | "week" | "month";
export const RANGE_PRESETS: readonly RangePreset[] = ["today", "week", "month"];
const pad = (n: number) => String(n).padStart(2, "0");
export const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** الفترة الجاهزة: النهاية اليوم دايمًا، والبداية قبلها بـ 0 / 6 / 29 يوم (شامل). */
export function presetRange(p: RangePreset, now = new Date()): { from: string; to: string } {
  const back = p === "today" ? 0 : p === "week" ? 6 : 29;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
  return { from: isoLocal(start), to: isoLocal(now) };
}
export const rangeError = (from: string, to: string): "range" | null => (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to ? null : "range");

/** نسبة للعرض: null يبقى «—» (مش صفر) عشان ما نخمّنش. */
export const pctLabel = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : `${v}%`);
export const oeeTone = (v: number | null | undefined): "neutral" | "danger" | "warn" | "success" => (v === null || v === undefined ? "neutral" : v >= 85 ? "success" : v >= 60 ? "warn" : "danger");

export const stoppagePayload = (machineId: number, reason: string, notes: string) => {
  const n = notes.trim();
  return { machineId, reasonCode: reason, ...(n ? { notes: n } : {}) };
};
export const stoppageError = (reason: string, reasons: readonly string[]): "reason" | null => (reasons.includes(reason) ? null : "reason");
/** مدة التوقف المفتوح بالدقايق لحد دلوقتي (للعرض بس؛ السيرفر بيحسب المدة النهائية). */
export const openMinutes = (startedAt: string, now = Date.now()): number => Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60000));
