/** منطق نقي لتبويبات الإعدادات الإدارية وصفحة «حسابي» (الخطوة 40ب). السيرفر هو الحَكَم وبيتحقق من كل حاجة تاني. */

export type PasswordProblem = "short" | "upper" | "lower" | "digit";

/** نفس قاعدة السيرفر لكلمة سر الموظفين (strongPasswordSchema). */
export function passwordProblem(pw: string): PasswordProblem | null {
  if (pw.length < 8) return "short";
  if (!/[A-Z]/.test(pw)) return "upper";
  if (!/[a-z]/.test(pw)) return "lower";
  if (!/[0-9]/.test(pw)) return "digit";
  return null;
}

/* ───────────── المستخدمون ───────────── */
export interface UserRow { id: number; username: string; fullName: string; role: string; status: "active" | "inactive"; createdAt: string }
export interface UserForm { username: string; fullName: string; role: string; status: "active" | "inactive"; password: string }
export const EMPTY_USER: UserForm = { username: "", fullName: "", role: "", status: "active", password: "" };

export type UserError = "username" | "fullName" | "role" | "password";

/** في التعديل كلمة السر اختيارية (فاضية = من غير تغيير). */
export function userError(f: UserForm, editing: boolean): UserError | null {
  if (f.username.trim().length < 3) return "username";
  if (!f.fullName.trim()) return "fullName";
  if (!f.role) return "role";
  if (!editing || f.password) { if (passwordProblem(f.password)) return "password"; }
  return null;
}

export function userFormOf(u: UserRow): UserForm {
  return { username: u.username, fullName: u.fullName, role: u.role, status: u.status, password: "" };
}

/** إنشاء: كل الحقول. تعديل: اللي اتغيّر بس (كلمة السر لو اتكتبت). */
export function userPayload(f: UserForm, before?: UserRow): Record<string, string> {
  const base = { username: f.username.trim(), fullName: f.fullName.trim(), role: f.role, status: f.status };
  if (!before) return { ...base, password: f.password };
  const out: Record<string, string> = {};
  for (const k of ["username", "fullName", "role", "status"] as const) if (base[k] !== before[k]) out[k] = base[k];
  if (f.password) out.password = f.password;
  return out;
}

export const userChanged = (f: UserForm, before: UserRow) => Object.keys(userPayload(f, before)).length > 0;

/** البحث بالاسم أو اسم الدخول، وفلتر الحالة. */
export function filterUsers(rows: readonly UserRow[], q: string, status: "" | "active" | "inactive"): UserRow[] {
  const s = q.trim().toLowerCase();
  return rows.filter((u) => (!status || u.status === status) && (!s || u.fullName.toLowerCase().includes(s) || u.username.toLowerCase().includes(s)));
}

/* ───────────── قواعد التوصيل ───────────── */
export interface RuleRow {
  id: number; label: string; minQty: string | null; maxQty: string | null; minValue: string | null; maxValue: string | null;
  timing: "any" | "on_time" | "late"; deliveryMethod: "customer" | "warehouse"; priority: number; isActive: boolean;
}
export interface RuleForm { label: string; minQty: string; maxQty: string; minValue: string; maxValue: string; timing: "any" | "on_time" | "late"; deliveryMethod: "customer" | "warehouse"; priority: string }
export const EMPTY_RULE: RuleForm = { label: "", minQty: "", maxQty: "", minValue: "", maxValue: "", timing: "any", deliveryMethod: "warehouse", priority: "100" };

export type RuleError = "label" | "number" | "range" | "priority";
const NUM = /^\d{1,9}(\.\d{1,3})?$/;

export function ruleError(f: RuleForm): RuleError | null {
  if (!f.label.trim()) return "label";
  const nums = [f.minQty, f.maxQty, f.minValue, f.maxValue].map((x) => x.trim());
  if (nums.some((x) => x !== "" && !NUM.test(x))) return "number";
  const lt = (a: string, b: string) => a !== "" && b !== "" && Number(a) > Number(b);
  if (lt(nums[0]!, nums[1]!) || lt(nums[2]!, nums[3]!)) return "range";
  if (!/^\d{1,5}$/.test(f.priority.trim())) return "priority";
  return null;
}

export function rulePayload(f: RuleForm) {
  const n = (x: string) => (x.trim() === "" ? null : x.trim());
  return { label: f.label.trim(), minQty: n(f.minQty), maxQty: n(f.maxQty), minValue: n(f.minValue), maxValue: n(f.maxValue), timing: f.timing, deliveryMethod: f.deliveryMethod, priority: Number(f.priority) };
}
export const ruleTogglePayload = (r: RuleRow) => ({ isActive: !r.isActive });
export const sortRules = (rows: readonly RuleRow[]) => [...rows].sort((a, b) => a.priority - b.priority || a.id - b.id);

/** وصف الحد: «من 5 إلى 10» أو «—». */
export function rangeParts(min: string | null, max: string | null): { min: string | null; max: string | null } {
  const clean = (x: string | null) => (x === null || x === "" ? null : String(Number(x)));
  return { min: clean(min), max: clean(max) };
}

/* ───────────── عن النظام ───────────── */
export interface SystemInfo {
  version: string; uptimeSeconds: number; nodeVersion: string; databaseSize: string; todayActivity: number;
  modules: { contacts: number; sales: number; inventory: number; users: number };
}
export function uptimeParts(seconds: number): { days: number; hours: number; minutes: number } {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return { days: Math.floor(s / 86_400), hours: Math.floor((s % 86_400) / 3_600), minutes: Math.floor((s % 3_600) / 60) };
}
/** مفاتيح الكاش المحلي بتاعة النظام القديم بس (مش أي مفتاح تاني في المتصفح). */
export const CACHE_PREFIX = "hyper_erp_cache_";
export function cacheKeys(keys: readonly string[]): string[] { return keys.filter((k) => k.startsWith(CACHE_PREFIX)); }

/* ───────────── حسابي ───────────── */
export interface PasswordForm { current: string; next: string; confirm: string }
export const EMPTY_PASSWORD: PasswordForm = { current: "", next: "", confirm: "" };
export type PasswordFormError = "current" | PasswordProblem | "mismatch" | "same";
export function passwordFormError(f: PasswordForm): PasswordFormError | null {
  if (!f.current) return "current";
  const p = passwordProblem(f.next);
  if (p) return p;
  if (f.next === f.current) return "same";
  if (f.next !== f.confirm) return "mismatch";
  return null;
}

/** كود التحقق: 6 أرقام (التطبيق) أو كود احتياطي — هنا بنتحقق من شكل الـ6 أرقام بس. */
export const isTotpCode = (c: string) => /^\d{6}$/.test(c.trim());
export interface TwoFaStatus { totpEnabled: boolean; totpEnabledAt: string | null }
export interface TwoFaSetup { secret: string; otpauthUrl: string }
/** السر بيتعرض مقسّم 4-4 عشان يتكتب بسهولة. */
export const groupSecret = (s: string) => s.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();

export interface HolidayRow { id: number; date: string; reason: string }
export interface HolidayForm { date: string; reason: string }
export const EMPTY_HOLIDAY: HolidayForm = { date: "", reason: "" };
export type HolidayError = "date" | "reason" | "dup";

/** تحقق قبل الإرسال: تاريخ حقيقي، سبب حرفين على الأقل، وتاريخ مش متسجّل. */
export function holidayError(f: HolidayForm, existing: readonly HolidayRow[]): HolidayError | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || new Date(`${f.date}T00:00:00Z`).toISOString().slice(0, 10) !== f.date) return "date";
  if (f.reason.trim().length < 2) return "reason";
  if (existing.some((h) => h.date === f.date)) return "dup";
  return null;
}
export const holidayPayload = (f: HolidayForm) => ({ date: f.date, reason: f.reason.trim() });
/** مرتّبة بالتاريخ، وبنعلّم اللي فات (مقارنة نصية بتاريخ النهارده بصيغة YYYY-MM-DD). */
export const sortHolidays = (rows: readonly HolidayRow[]): HolidayRow[] => [...rows].sort((a, b) => a.date.localeCompare(b.date));
export const isPastHoliday = (h: HolidayRow, todayIso: string) => h.date < todayIso;
