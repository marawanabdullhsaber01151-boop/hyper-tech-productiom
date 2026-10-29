/** @format */
// قواعد صندوق الصادر المضمون بدون قاعدة بيانات ولا شبكة، عشان تتختبر لوحدها.
// بيستخدمها العامل (outbox.ts) وفحص «الرسائل المعلّقة» في صفحة صحة النظام.

import { z } from "zod";
import type { CheckOutcome } from "./systemHealthCore";

export const OUTBOX_TYPES = ["notify.user", "notify.role", "portal.alert"] as const;
export type OutboxType = (typeof OUTBOX_TYPES)[number];

const notificationBody = {
  type: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  body: z.string().max(2000),
  referenceType: z.string().max(100).optional(),
  referenceId: z.number().int().optional(),
};

export const OUTBOX_PAYLOADS = {
  "notify.user": z.object({ userId: z.number().int().positive(), ...notificationBody }),
  "notify.role": z.object({ role: z.string().min(1).max(100), ...notificationBody }),
  "portal.alert": z.object({
    userId: z.number().int().positive(),
    companyId: z.number().int().positive().nullable().optional(),
    template: z.enum(["password_changed", "recovery_code_used"]),
  }),
} as const;

export type OutboxPayloadMap = { [K in OutboxType]: z.infer<(typeof OUTBOX_PAYLOADS)[K]> };

export function validatePayload(type: string, payload: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  if (!(OUTBOX_TYPES as readonly string[]).includes(type)) return { ok: false, message: `نوع حدث غير معروف: ${type}` };
  const r = OUTBOX_PAYLOADS[type as OutboxType].safeParse(payload);
  if (r.success) return { ok: true, value: r.data };
  const first = r.error.issues[0];
  return { ok: false, message: `بيانات الحدث ${type} غير صحيحة: ${first?.path.join(".") || "—"} ${first?.message ?? ""}`.trim() };
}

/** مفتاح منع التكرار: أجزاء مرتّبة بفاصل ثابت. أي جزء فاضي أو undefined بيتحوّل لشرطة. */
export function dedupeKey(...parts: ReadonlyArray<string | number | null | undefined>): string {
  return parts.map((p) => (p === null || p === undefined || p === "" ? "-" : String(p))).join(":");
}

/** دلو الساعة (UTC) لمفاتيح التنبيهات اللي نكتفي فيها بواحد في الساعة. */
export function hourBucket(now: Date): string {
  return now.toISOString().slice(0, 13);
}

export const MAX_ATTEMPTS = 6;
/** انتظار قبل المحاولة التالية بعد فشل المحاولة رقم n (n تبدأ من 1): دقيقة، 5، 30، ساعتين، 12 ساعة. */
export const BACKOFF_MINUTES = [1, 5, 30, 120, 720] as const;

export function backoffMs(attemptsSoFar: number): number {
  const i = Math.min(Math.max(attemptsSoFar, 1), BACKOFF_MINUTES.length) - 1;
  return BACKOFF_MINUTES[i]! * 60_000;
}

export interface FailureState {
  status: "pending" | "dead";
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string;
}

/** حالة الحدث بعد فشل محاولة: يتأجل بتراجع زمني، أو يبقى dead بعد آخر محاولة. نص الخطأ بيتقصّ (500 حرف). */
export function afterFailure(input: { attempts: number; maxAttempts: number; now: Date; error: unknown }): FailureState {
  const attempts = input.attempts + 1;
  const msg = (input.error instanceof Error ? input.error.message : String(input.error)).slice(0, 500);
  if (attempts >= input.maxAttempts) return { status: "dead", attempts, nextAttemptAt: null, lastError: msg };
  return { status: "pending", attempts, nextAttemptAt: new Date(input.now.getTime() + backoffMs(attempts)), lastError: msg };
}

export interface OutboxStats {
  /** أحداث لسه مستنية (pending) */
  pending: number;
  /** منها اللي فشل مرة على الأقل وبيتعاد */
  retrying: number;
  /** وصلت للحد الأقصى وما بقتش بتتعاد */
  dead: number;
  /** وقت أقدم حدث مستحق ولسه ما اتنفذش */
  oldestDueAt: Date | null;
}

export const OUTBOX_WARN_HOURS = 1;
export const OUTBOX_BAD_HOURS = 24;
export const OUTBOX_DEAD_BAD = 5;

/** فحص صحة النظام: الصندوق فاضي أو بيتصرّف طبيعي = سليم، متأخر = تنبيه/خطر، ميت = تنبيه (5 فأكتر = خطر). */
export function outboxHealth(stats: OutboxStats, now: Date): CheckOutcome {
  const lateHours = stats.oldestDueAt ? Math.floor((now.getTime() - stats.oldestDueAt.getTime()) / 3_600_000) : 0;
  if (stats.dead >= OUTBOX_DEAD_BAD || (stats.pending > 0 && lateHours >= OUTBOX_BAD_HOURS)) {
    return {
      status: "bad",
      message: stats.dead >= OUTBOX_DEAD_BAD ? `في ${stats.dead} رسالة أو إشعار فشل إرسالهم نهائيًا بعد كذا محاولة.` : `في ${stats.pending} رسالة أو إشعار مستنية من أكتر من ${lateHours} ساعة ولسه ما اتبعتتش.`,
      action: "افتح تبويب Actions في GitHub وشوف تشغيلات «outbox-drain». ولو في مشكلة مستمرة، ابعت الرسائل الفاشلة للدعم الفني.",
      count: stats.dead || stats.pending,
    };
  }
  if (stats.dead > 0 || (stats.pending > 0 && lateHours >= OUTBOX_WARN_HOURS)) {
    return {
      status: "warn",
      message: stats.dead > 0 ? `${stats.dead} رسالة أو إشعار فشل إرسالهم نهائيًا (باقي ${stats.pending} مستنية).` : `في ${stats.pending} رسالة أو إشعار مستنية من أكتر من ${lateHours} ساعة${stats.retrying ? `، منها ${stats.retrying} بتتعاد بعد فشل` : ""}.`,
      action: stats.dead > 0 ? "الرسائل الفاشلة محتاجة تدخّل. راجع سبب الفشل مع الدعم الفني ثم أعد جدولتها." : "الإرسال بيتأخر. راجع تشغيلات «outbox-drain» في GitHub Actions.",
      count: stats.dead || stats.pending,
    };
  }
  return {
    status: "ok",
    message: stats.pending > 0 ? `${stats.pending} رسالة أو إشعار في الطريق${stats.retrying ? `، منها ${stats.retrying} بتتعاد بعد فشل بسيط` : ""}.` : "مفيش رسائل أو إشعارات معلّقة. كل حاجة اتبعتت.",
  };
}
