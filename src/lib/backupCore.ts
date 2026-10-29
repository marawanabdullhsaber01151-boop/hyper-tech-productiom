/** @format */
// قواعد النسخ الاحتياطي بدون قاعدة بيانات ولا شبكة، عشان تتختبر لوحدها.
// بتستخدمها: سكربتات scripts/backup/* (GitHub Actions) وفحص «النسخ الاحتياطي» في صفحة صحة النظام.

import type { CheckOutcome } from "./systemHealthCore";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** بادئة مفتاح الملف في المخزن. الشكل: daily/hypertech-20261029T003000Z.dump.age */
export const BACKUP_PREFIX = "daily/hypertech-";
const KEY_RE = /^daily\/hypertech-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump\.age$/;

const pad = (n: number) => String(n).padStart(2, "0");

export function backupObjectKey(at: Date): string {
  const s = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`;
  return `${BACKUP_PREFIX}${s}.dump.age`;
}

export const manifestKeyFor = (dumpKey: string) => dumpKey.replace(/\.dump\.age$/, ".manifest.json");

/** وقت النسخة من اسم الملف، أو null لو الاسم مش بتاعنا (وساعتها ما نلمسوش أبدًا). */
export function parseBackupKey(key: string): Date | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return dt.getUTCMonth() === mo - 1 ? dt : null;
}

export const RETENTION = { dailyDays: 14, weeklyWeeks: 8, monthlyMonths: 12, minKeep: 3 } as const;

/**
 * سياسة الاحتفاظ:
 * - كل نسخ آخر 14 يوم.
 * - نسخة يوم الأحد (UTC) لمدة 8 أسابيع.
 * - نسخة أول كل شهر لمدة 12 شهر.
 * - آخر 3 نسخ دايمًا مهما كان عمرها.
 * - أي مفتاح اسمه مش بتاعنا مش بيدخل في الحساب أبدًا (لا بيتحذف ولا بيتحسب).
 */
export function planRetention(keys: readonly string[], now: Date): { keep: string[]; prune: string[] } {
  const parsed = keys
    .map((key) => ({ key, at: parseBackupKey(key) }))
    .filter((x): x is { key: string; at: Date } => x.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const keep = new Set<string>();
  parsed.forEach((x, i) => {
    const age = now.getTime() - x.at.getTime();
    if (i < RETENTION.minKeep) keep.add(x.key);
    else if (age <= RETENTION.dailyDays * DAY) keep.add(x.key);
    else if (x.at.getUTCDay() === 0 && age <= RETENTION.weeklyWeeks * 7 * DAY) keep.add(x.key);
    else if (x.at.getUTCDate() === 1 && age <= RETENTION.monthlyMonths * 31 * DAY) keep.add(x.key);
  });
  // لو في نسخ أكتر من يوم في نفس الأسبوع/الشهر الكل بيتحفظ جوه نافذته؛ ده أأمن من إننا نختار واحدة.
  return { keep: parsed.filter((x) => keep.has(x.key)).map((x) => x.key), prune: parsed.filter((x) => !keep.has(x.key)).map((x) => x.key) };
}

/** حارس أمان: ما نمسحش أكتر من نص النسخ في مرة واحدة (بيمسك خطأ ساعة أو اسم). */
export function pruneIsSafe(total: number, pruneCount: number): boolean {
  return pruneCount === 0 || pruneCount <= Math.floor(total / 2);
}

export type RowCounts = Record<string, number>;

export interface CountsDiff {
  table: string;
  restored: number | null;
  min: number | null;
  max: number | null;
}

/**
 * مقارنة عدد الصفوف بعد الاسترجاع. العد بيتاخد قبل النسخ وبعده، فلو في كتابة حصلت أثناء النسخ
 * (نادرة، لإن النسخ الساعة 3 الفجر بتوقيت القاهرة) العدد المسترجع لازم يقع بينهم. بدون كتابة الاتنين متساويين فالمقارنة بتبقى دقيقة.
 */
export function compareRowCounts(before: RowCounts, after: RowCounts, restored: RowCounts): { ok: boolean; tables: number; rows: number; diffs: CountsDiff[] } {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after), ...Object.keys(restored)])].sort();
  const diffs: CountsDiff[] = [];
  let rows = 0;
  for (const table of names) {
    const b = before[table];
    const a = after[table];
    const r = restored[table];
    if (r === undefined) {
      diffs.push({ table, restored: null, min: b ?? a ?? null, max: a ?? b ?? null });
      continue;
    }
    rows += r;
    if (b === undefined && a === undefined) {
      diffs.push({ table, restored: r, min: null, max: null });
      continue;
    }
    const lo = Math.min(b ?? (a as number), a ?? (b as number));
    const hi = Math.max(b ?? (a as number), a ?? (b as number));
    if (r < lo || r > hi) diffs.push({ table, restored: r, min: lo, max: hi });
  }
  return { ok: diffs.length === 0, tables: names.length, rows, diffs };
}

export interface LastRun {
  kind: "backup" | "restore_test";
  store: string;
  status: "ok" | "failed";
  finishedAt: Date;
  error?: string | null;
  sizeBytes?: number | null;
}

export const BACKUP_WARN_HOURS = 36;
export const BACKUP_BAD_HOURS = 72;
export const RESTORE_WARN_DAYS = 10;
export const RESTORE_BAD_DAYS = 21;

const STORE_NAMES: Record<string, string> = { r2: "Cloudflare R2", b2: "Backblaze B2" };
const storeName = (s: string) => STORE_NAMES[s] ?? s;
const fmtSize = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(b / 1024))} ك.ب`);

/**
 * حالة النسخ الاحتياطي لصفحة صحة النظام. بياخد آخر تشغيلة لكل (نوع، مخزن).
 * - لا نسخ مسجّلة = تنبيه (مش «سليم» ولا «خطر»): غالبًا لسه ما اتفعّلش.
 * - آخر محاولة فشلت في أي مخزن = خطر.
 * - أحدث نسخة ناجحة أقدم من 36 ساعة = تنبيه، وأقدم من 72 = خطر.
 * - اختبار الاسترجاع الأسبوعي: أقدم من 10 أيام = تنبيه، من 21 = خطر. لازم نجرّب إن النسخة بتتفتح فعلًا.
 */
export function backupHealth(runs: readonly LastRun[], now: Date): CheckOutcome {
  const backups = runs.filter((r) => r.kind === "backup");
  if (!backups.length) {
    return {
      status: "warn",
      message: "مفيش أي نسخة احتياطية مسجّلة لحد دلوقتي. لو حصل عطل في قاعدة البيانات مفيش نسخة تتسترجع منها.",
      action: "فعّل النسخ الاحتياطي اليومي حسب دليل docs/runbooks/backup-restore.md (يتشغّل من GitHub Actions).",
    };
  }
  const failed = backups.filter((r) => r.status === "failed");
  if (failed.length) {
    return {
      status: "bad",
      message: `آخر نسخة احتياطية فشلت في ${failed.map((r) => storeName(r.store)).join(" و")}. بيانات اليوم ممكن ما تكونش محفوظة هناك.`,
      action: "افتح تبويب Actions في GitHub وشوف سبب فشل «backup». غالبًا مفتاح منتهي أو بيانات اتصال اتغيرت.",
      examples: failed.map((r) => `${storeName(r.store)}: ${r.error ?? "سبب غير مسجّل"}`).slice(0, 5),
    };
  }
  const newestOk = Math.max(...backups.map((r) => r.finishedAt.getTime()));
  const hours = Math.floor((now.getTime() - newestOk) / HOUR);
  const stores = backups.map((r) => storeName(r.store)).join(" و");
  const size = backups.find((r) => r.sizeBytes)?.sizeBytes;
  const lines = [`آخر نسخة ناجحة من ${hours} ساعة في ${stores}${size ? ` (${fmtSize(size)})` : ""}.`];
  let status: CheckOutcome["status"] = "ok";
  let action: string | undefined;
  if (hours >= BACKUP_BAD_HOURS) {
    status = "bad";
    action = "النسخ اليومي واقف من أكتر من 3 أيام. افتح Actions في GitHub وشغّل «backup» يدويًا وشوف السبب.";
  } else if (hours >= BACKUP_WARN_HOURS) {
    status = "warn";
    action = "النسخة اليومية اتأخرت. افتح Actions في GitHub وراجع «backup».";
  }

  const tests = runs.filter((r) => r.kind === "restore_test");
  if (!tests.length) {
    if (status === "ok") status = "warn";
    lines.push("لسه ما اتعملش اختبار استرجاع. النسخة اللي ما اتجرّبتش ممكن ما تتفتحش وقت الحاجة.");
    action = action ?? "شغّل «restore-test» يدويًا من تبويب Actions في GitHub.";
  } else {
    const failedTest = tests.filter((r) => r.status === "failed");
    if (failedTest.length) {
      status = "bad";
      lines.push(`اختبار الاسترجاع فشل في ${failedTest.map((r) => storeName(r.store)).join(" و")}: النسخة مش مضمونة.`);
      action = "افتح «restore-test» في Actions وشوف الجدول اللي عدده مختلف أو الملف اللي ما اتفتحش.";
    } else {
      const testDays = Math.floor((now.getTime() - Math.max(...tests.map((r) => r.finishedAt.getTime()))) / DAY);
      if (testDays >= RESTORE_BAD_DAYS) {
        status = "bad";
        lines.push(`آخر اختبار استرجاع ناجح من ${testDays} يوم.`);
        action = action ?? "شغّل «restore-test» دلوقتي وتأكد إنه نجح.";
      } else if (testDays >= RESTORE_WARN_DAYS) {
        if (status === "ok") status = "warn";
        lines.push(`آخر اختبار استرجاع ناجح من ${testDays} يوم.`);
        action = action ?? "اختبار الاسترجاع الأسبوعي اتأخر. راجع «restore-test» في Actions.";
      } else {
        lines.push(`آخر اختبار استرجاع ناجح من ${testDays} يوم (النسخة بتتفتح وعدد الصفوف مطابق).`);
      }
    }
  }
  return { status, message: lines.join(" "), ...(action ? { action } : {}) };
}
