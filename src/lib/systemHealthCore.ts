/** @format */
/**
 * محرّك صفحة «صحة النظام» — الجزء النقي (من غير قاعدة بيانات) عشان يتختبر بسهولة.
 *
 * المبدأ: كل فحص مستقل. لو فحص فشل أو علّق، الباقي يكمل، والفحص اللي فشل نفسه يظهر كمشكلة
 * («ماقدرناش نفحص كذا») بدل ما يختفي — لأن فحص ساكت = أخطر من فحص أحمر.
 */

export type HealthStatus = "ok" | "warn" | "bad" | "unknown";

export interface CheckOutcome {
  status: HealthStatus;
  /** إيه اللي حصل، بكلام بسيط (جملة أو اتنين). */
  message: string;
  /** اعمل إيه (بس لو في مشكلة). */
  action?: string;
  /** رقم الحالات المتأثرة (لو ينطبق). */
  count?: number;
  /** أمثلة قصيرة تساعد على الوصول للمشكلة (٥ كحد أقصى). */
  examples?: string[];
  /** رابط لصفحة المعالجة. */
  href?: string;
}

export interface HealthCheck extends CheckOutcome {
  id: string;
  group: string;
  title: string;
  /** مدة الفحص بالمللي ثانية. */
  ms: number;
}

export interface CheckDef {
  id: string;
  group: string;
  title: string;
  run: () => Promise<CheckOutcome>;
}

export const GROUP_TITLES: Record<string, string> = {
  base: "الأساس",
  security: "الأمان والحسابات",
  access: "الصلاحيات والصفحات",
  sales: "المبيعات والفواتير",
  customers: "العملاء والبوابة",
  stock: "المخزون",
  errors: "الأخطاء",
};

export const CHECK_TIMEOUT_MS = 8000;
const MAX_EXAMPLES = 5;

const RANK: Record<HealthStatus, number> = { ok: 0, unknown: 1, warn: 2, bad: 3 };

/** أسوأ حالة في المجموعة. الـ«مش معروف» أسوأ من «سليم» (فحص ما اشتغلش = مش مطمّنين). */
export function worst(statuses: readonly HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>((acc, s) => (RANK[s] > RANK[acc] ? s : acc), "ok");
}

export function summarize(checks: readonly { status: HealthStatus }[]): Record<HealthStatus, number> {
  const out: Record<HealthStatus, number> = { ok: 0, warn: 0, bad: 0, unknown: 0 };
  for (const c of checks) out[c.status] += 1;
  return out;
}

/** جملة الملخص العامة اللي بتظهر فوق الصفحة. */
export function headline(overall: HealthStatus, s: Record<HealthStatus, number>): string {
  const problems = s.bad + s.warn + s.unknown;
  if (overall === "ok") return "كل حاجة شغالة سليم";
  if (overall === "bad") return `في ${problems === 1 ? "مشكلة" : `${problems} مشاكل`} محتاجة تدخّل، وفيها ${s.bad === 1 ? "واحدة" : `${s.bad}`} خطيرة`;
  return `النظام شغّال، بس في ${problems === 1 ? "ملاحظة" : `${problems} ملاحظات`} تستاهل تبصّ عليها`;
}

/** يحوّل عدد حالات لحالة: صفر = سليم، من warnAt = تنبيه، من badAt = مشكلة. */
export function statusFromCount(n: number, t: { warnAt?: number; badAt?: number } = {}): HealthStatus {
  const warnAt = t.warnAt ?? 1;
  if (t.badAt !== undefined && n >= t.badAt) return "bad";
  return n >= warnAt ? "warn" : "ok";
}

/** صيغة عربية بسيطة للأعداد: ١ = مفرد، ٢ = مثنى، ٣–١٠ = جمع، أكتر = مفرد منصوب. */
export function countWord(n: number, forms: { one: string; two: string; few: string; many: string }): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}

/** شغّل فحص واحد بمهلة، وحوّل أي فشل لنتيجة «مش معروف» مفهومة. عمره ما بيرمي. */
export async function runCheck(def: CheckDef, timeoutMs: number = CHECK_TIMEOUT_MS): Promise<HealthCheck> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      def.run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return {
      id: def.id,
      group: def.group,
      title: def.title,
      ...outcome,
      examples: outcome.examples?.slice(0, MAX_EXAMPLES),
      ms: Date.now() - started,
    };
  } catch (err) {
    const timedOut = err instanceof Error && err.message === "timeout";
    return {
      id: def.id,
      group: def.group,
      title: def.title,
      status: "unknown",
      message: timedOut ? "الفحص ده اتأخر أكتر من اللازم وما كملش." : "ماقدرناش نكمّل الفحص ده بسبب خطأ.",
      action: timedOut ? "اضغط «افحص تاني». لو اتكرر، قاعدة البيانات بطيئة ومحتاجة مراجعة." : "اضغط «افحص تاني». لو اتكرر، ابعت للدعم الفني اسم الفحص ووقته.",
      ms: Date.now() - started,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runAll(defs: readonly CheckDef[], timeoutMs: number = CHECK_TIMEOUT_MS): Promise<HealthCheck[]> {
  return Promise.all(defs.map((d) => runCheck(d, timeoutMs)));
}

export interface HealthReport {
  status: HealthStatus;
  headline: string;
  checkedAt: string;
  summary: Record<HealthStatus, number>;
  groups: { id: string; title: string; status: HealthStatus; checks: HealthCheck[] }[];
}

export function buildReport(checks: readonly HealthCheck[], now: Date = new Date()): HealthReport {
  const order = Object.keys(GROUP_TITLES);
  const ids = [...new Set([...order, ...checks.map((c) => c.group)])];
  const groups = ids
    .map((id) => {
      const list = checks
        .filter((c) => c.group === id)
        // الأسوأ فوق عشان المشكلة تتشاف من أول نظرة
        .sort((a, b) => RANK[b.status] - RANK[a.status]);
      return { id, title: GROUP_TITLES[id] ?? id, status: worst(list.map((c) => c.status)), checks: list };
    })
    .filter((g) => g.checks.length > 0);
  const summary = summarize(checks);
  const status = worst(checks.map((c) => c.status));
  return { status, headline: headline(status, summary), checkedAt: now.toISOString(), summary, groups };
}

/** أدوار مالهاش ولا صفحة في القايمة: لو حد بالدور ده دخل هيلاقي نظام فاضي. */
export function rolesWithoutPages(roles: readonly string[], pagesFor: (role: string) => number): string[] {
  return roles.filter((r) => pagesFor(r) === 0);
}

/** مستخدمين نشطين بدور مش معروف للنظام: كل صفحاتهم هتطلع «فشل تحميل» أو «ممنوع». */
export function usersWithUnknownRole(users: readonly { username: string; role: string }[], known: readonly string[]): { username: string; role: string }[] {
  const set = new Set(known);
  return users.filter((u) => !set.has(u.role));
}
