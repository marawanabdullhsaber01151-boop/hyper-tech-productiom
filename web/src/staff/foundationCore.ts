/**
 * منطق صفحة البيانات الأساسية (خطوة 35أ): مواقع، مراكز عمل، ماكينات، ورديات، عدادات.
 * بدون واجهة عشان يتختبر لوحده. السيرفر هو الحَكَم (src/routes/foundation.ts).
 */

/** نفس FOUNDATION_ROLES في السيرفر. */
export const FOUNDATION_ROLES = ["chairman", "executive_manager", "operations_manager", "warehouse_manager", "production_manager"] as const;
/** العدّادات (تعديل) والسجل: رئيس مجلس الإدارة بس. */
export const FOUNDATION_CHAIRMAN_ROLES = ["chairman"] as const;
export const canManageFoundation = (role: string) => (FOUNDATION_ROLES as readonly string[]).includes(role);
export const isChairman = (role: string) => role === "chairman";

export type FoundationTab = "locations" | "centers" | "machines" | "shifts" | "sequences" | "audit";
export const foundationTabs = (role: string): FoundationTab[] =>
  canManageFoundation(role) ? (["locations", "centers", "machines", "shifts", "sequences", ...(isChairman(role) ? (["audit"] as const) : [])] as FoundationTab[]) : [];

/* ───────────── أنواع (مرآة رد السيرفر) ───────────── */
export interface LocationRow { id: number; code: string; name: string; locationType: string; parentId: number | null; active: boolean; allowsInventory: boolean; allowsProduction: boolean; requiresQuarantine: boolean; notes: string | null }
export interface CenterRow { id: number; code: string; name: string; centerType: string; locationId: number | null; capacityMinutesPerShift: number; active: boolean; notes: string | null }
export interface MachineRow { id: number; code: string; name: string; workCenterId: number; status: string; serialNumber: string | null; calibrationDueDate: string | null; maintenanceDueDate: string | null; active: boolean; notes: string | null }
export interface ShiftRow { id: number; code: string; name: string; startTime: string; endTime: string; breakMinutes: number; active: boolean }
export interface SequenceRow { id: number; sequenceKey: string; prefix: string; nextValue: number; padding: number; active: boolean }
export interface AuditRow { id: number; entityType: string; entityId: number | null; action: string; actorId: string; actorRole: string; reason: string | null; createdAt: string }
export interface ImpactLine { type: string; count: number; label: string; examples: string[] }
export interface Impact { kind: string; id: number; name: string; active: boolean; blockers: ImpactLine[]; references: ImpactLine[]; blocked: boolean }

export const LOCATION_TYPES = ["warehouse", "quarantine", "wip", "production", "finished_goods", "scrap"] as const;
export const MACHINE_STATUSES = ["available", "running", "down", "maintenance", "calibration", "retired"] as const;
export type MachineStatus = (typeof MACHINE_STATUSES)[number];

export const machineTone = (s: string): "success" | "info" | "danger" | "warn" | "neutral" =>
  s === "available" ? "success" : s === "running" ? "info" : s === "down" ? "danger" : s === "maintenance" || s === "calibration" ? "warn" : "neutral";

/* ───────────── تواريخ ───────────── */
export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
const dayNumber = (iso: string) => { const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };

export type DueState = "none" | "overdue" | "soon" | "ok";
export const DUE_SOON_DAYS = 14;
/** استحقاق معايرة/صيانة: متأخر، قريب (≤14 يوم)، تمام، أو مش مسجّل. */
export function dueState(date: string | null, today: string): DueState {
  if (!date) return "none";
  const diff = dayNumber(date) - dayNumber(today);
  return diff < 0 ? "overdue" : diff <= DUE_SOON_DAYS ? "soon" : "ok";
}
export const daysUntil = (date: string, today: string) => dayNumber(date) - dayNumber(today);

export interface MachineStats { total: number; active: number; down: number; overdue: number; soon: number }
export function machineStats(rows: readonly MachineRow[], today: string): MachineStats {
  const live = rows.filter((m) => m.active && m.status !== "retired");
  const dues = live.flatMap((m) => [dueState(m.calibrationDueDate, today), dueState(m.maintenanceDueDate, today)]);
  return { total: rows.length, active: live.length, down: live.filter((m) => m.status === "down").length, overdue: dues.filter((d) => d === "overdue").length, soon: dues.filter((d) => d === "soon").length };
}

/* ───────────── ورديات ───────────── */
const toMinutes = (hhmm: string) => { const [h = 0, m = 0] = hhmm.split(":").map(Number); return h * 60 + m; };
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** مدة الوردية الصافية بالدقايق (تدعم الوردية اللي بتعدّي منتصف الليل)، بعد خصم الاستراحة. */
export function shiftNetMinutes(start: string, end: string, breakMinutes: number): number {
  if (!TIME.test(start) || !TIME.test(end)) return 0;
  let span = toMinutes(end) - toMinutes(start);
  if (span <= 0) span += 24 * 60;
  return Math.max(span - breakMinutes, 0);
}
export const crossesMidnight = (start: string, end: string) => TIME.test(start) && TIME.test(end) && toMinutes(end) <= toMinutes(start);
export const formatHours = (minutes: number) => { const h = Math.floor(minutes / 60), m = minutes % 60; return m ? `${h}:${String(m).padStart(2, "0")}` : String(h); };

/** عدد الدقايق المتاحة يوميًا لو كل الورديات النشطة اشتغلت (للعلم عند ضبط الطاقة). */
export const dailyShiftMinutes = (rows: readonly ShiftRow[]) => rows.filter((s) => s.active).reduce((n, s) => n + shiftNetMinutes(s.startTime, s.endTime, s.breakMinutes), 0);

/* ───────────── مواقع ───────────── */
/** مسار الموقع «أب ‹ ابن»، مع حماية من الدورات. */
export function locationPath(rows: readonly LocationRow[], id: number): string {
  const by = new Map(rows.map((r) => [r.id, r]));
  const names: string[] = [];
  const seen = new Set<number>();
  for (let cur = by.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? by.get(cur.parentId) : undefined) { seen.add(cur.id); names.unshift(cur.name); }
  return names.join(" ‹ ");
}
/** الأبناء (كلهم، بأي عمق) عشان منقترحش موقع يبقى أبًا لنفسه أو لحفيده. */
export function descendantIds(rows: readonly LocationRow[], id: number): Set<number> {
  const out = new Set<number>();
  const walk = (parent: number) => { for (const r of rows) if (r.parentId === parent && !out.has(r.id)) { out.add(r.id); walk(r.id); } };
  walk(id);
  return out;
}
export const parentCandidates = (rows: readonly LocationRow[], selfId: number | null) => {
  const banned = selfId === null ? new Set<number>() : new Set<number>([selfId, ...descendantIds(rows, selfId)]);
  return rows.filter((r) => !banned.has(r.id) && r.active);
};

/* ───────────── نماذج ───────────── */
export const normalizeInt = (s: string) => s.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
const intOk = (s: string, min: number, max: number) => /^\d{1,6}$/.test(normalizeInt(s)) && Number(normalizeInt(s)) >= min && Number(normalizeInt(s)) <= max;

export const codeError = (code: string, name: string): "code" | "name" | null => (!code.trim() || code.trim().length > 80 ? "code" : !name.trim() || name.trim().length > 160 ? "name" : null);

export interface LocationForm { code: string; name: string; locationType: string; parentId: string; allowsInventory: boolean; allowsProduction: boolean; requiresQuarantine: boolean; notes: string }
export const locationPayload = (f: LocationForm) => ({ code: f.code.trim(), name: f.name.trim(), locationType: f.locationType, parentId: f.parentId ? Number(f.parentId) : null, allowsInventory: f.allowsInventory, allowsProduction: f.allowsProduction, requiresQuarantine: f.requiresQuarantine, notes: f.notes.trim() || null });

export interface CenterForm { code: string; name: string; centerType: string; locationId: string; capacity: string; notes: string }
export const centerError = (f: CenterForm): "code" | "name" | "capacity" | null => codeError(f.code, f.name) ?? (intOk(f.capacity, 1, 1440) ? null : "capacity");
export const centerPayload = (f: CenterForm) => ({ code: f.code.trim(), name: f.name.trim(), centerType: f.centerType.trim() || "production_line", locationId: f.locationId ? Number(f.locationId) : null, capacityMinutesPerShift: Number(normalizeInt(f.capacity)), notes: f.notes.trim() || null });

export interface MachineForm { code: string; name: string; workCenterId: string; serialNumber: string; calibrationDueDate: string; maintenanceDueDate: string; notes: string }
export const machineError = (f: MachineForm): "code" | "name" | "center" | "calibration" | "maintenance" | null => {
  const base = codeError(f.code, f.name);
  if (base) return base;
  if (!f.workCenterId) return "center";
  if (f.calibrationDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.calibrationDueDate)) return "calibration";
  if (f.maintenanceDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.maintenanceDueDate)) return "maintenance";
  return null;
};
export const machinePayload = (f: MachineForm) => ({ code: f.code.trim(), name: f.name.trim(), workCenterId: Number(f.workCenterId), serialNumber: f.serialNumber.trim() || null, calibrationDueDate: f.calibrationDueDate || null, maintenanceDueDate: f.maintenanceDueDate || null, notes: f.notes.trim() || null });

export interface ShiftForm { code: string; name: string; startTime: string; endTime: string; breakMinutes: string }
export const shiftError = (f: ShiftForm): "code" | "name" | "start" | "end" | "break" | "length" | null => {
  const base = codeError(f.code, f.name);
  if (base) return base;
  if (!TIME.test(f.startTime)) return "start";
  if (!TIME.test(f.endTime)) return "end";
  if (!intOk(f.breakMinutes || "0", 0, 720)) return "break";
  return shiftNetMinutes(f.startTime, f.endTime, Number(normalizeInt(f.breakMinutes || "0"))) > 0 ? null : "length";
};
export const shiftPayload = (f: ShiftForm) => ({ code: f.code.trim(), name: f.name.trim(), startTime: f.startTime, endTime: f.endTime, breakMinutes: Number(normalizeInt(f.breakMinutes || "0")) });

/* ───────────── عدّادات ───────────── */
export const formatSequence = (prefix: string, padding: number, value: number) => `${prefix}${String(value).padStart(padding, "0")}`;
export interface SequenceForm { prefix: string; padding: string; nextValue: string }
export const sequenceError = (f: SequenceForm, current: number): "prefix" | "padding" | "next" | "lower" | null =>
  !f.prefix.trim() || f.prefix.trim().length > 30 ? "prefix" : !intOk(f.padding, 1, 12) ? "padding" : !intOk(f.nextValue, 1, 999999) ? "next" : Number(normalizeInt(f.nextValue)) < current ? "lower" : null;
export const sequencePayload = (f: SequenceForm) => ({ prefix: f.prefix.trim(), padding: Number(normalizeInt(f.padding)), nextValue: Number(normalizeInt(f.nextValue)) });

/* ───────────── محاكي الأثر ───────────── */
export const REASON_MIN = 3;
export const reasonOk = (s: string) => s.trim().length >= REASON_MIN;
export const activeBlockers = (i: Pick<Impact, "blockers">) => i.blockers.filter((b) => b.count > 0);
export const activeReferences = (i: Pick<Impact, "references">) => i.references.filter((b) => b.count > 0);
/** الإيقاف مسموح من غير سبب؟ مسموح لو مفيش مراجع حيّة. */
export const canDeactivateWithout = (i: Impact) => activeBlockers(i).length === 0;
/** زر التأكيد: من غير blockers يتفتح علطول، ومعاها لازم سبب صريح. */
export const confirmEnabled = (i: Impact | null, reason: string) => i !== null && (canDeactivateWithout(i) || reasonOk(reason));
export const impactBody = (reason: string, blocked: boolean) => ({ active: false, ...(blocked ? { overrideReason: reason.trim() } : {}) });
