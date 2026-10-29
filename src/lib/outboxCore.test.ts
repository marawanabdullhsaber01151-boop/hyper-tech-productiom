/** @format */
import { describe, expect, it } from "vitest";
import { BACKOFF_MINUTES, MAX_ATTEMPTS, afterFailure, backoffMs, dedupeKey, hourBucket, outboxHealth, validatePayload, type OutboxStats } from "./outboxCore";

const NOW = new Date("2026-10-29T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const stats = (o: Partial<OutboxStats>): OutboxStats => ({ pending: 0, retrying: 0, dead: 0, oldestDueAt: null, ...o });

describe("التراجع الزمني", () => {
  it("دقيقة، 5، 30، ساعتين، 12 ساعة، وبعدها يثبت على آخر قيمة", () => {
    expect([1, 2, 3, 4, 5].map((n) => backoffMs(n) / 60_000)).toEqual([...BACKOFF_MINUTES]);
    expect(backoffMs(9) / 60_000).toBe(720);
    expect(backoffMs(0) / 60_000).toBe(1);
  });
  it("فشل المحاولة الأولى: يتأجل دقيقة وبيفضل pending", () => {
    const f = afterFailure({ attempts: 0, maxAttempts: MAX_ATTEMPTS, now: NOW, error: new Error("smtp down") });
    expect(f.status).toBe("pending");
    expect(f.attempts).toBe(1);
    expect(f.nextAttemptAt?.toISOString()).toBe("2026-10-29T12:01:00.000Z");
    expect(f.lastError).toBe("smtp down");
  });
  it("آخر محاولة (السادسة) = dead من غير موعد تاني", () => {
    const f = afterFailure({ attempts: 5, maxAttempts: 6, now: NOW, error: "x" });
    expect(f).toEqual({ status: "dead", attempts: 6, nextAttemptAt: null, lastError: "x" });
  });
  it("نص الخطأ بيتقصّ ويقبل أي نوع", () => {
    expect(afterFailure({ attempts: 0, maxAttempts: 6, now: NOW, error: "a".repeat(900) }).lastError.length).toBe(500);
    expect(afterFailure({ attempts: 0, maxAttempts: 6, now: NOW, error: { code: 1 } }).lastError).toBe("[object Object]");
  });
});

describe("بيانات الأحداث", () => {
  const n = { type: "order_created", title: "طلب جديد", body: "تفاصيل" };
  it("إشعار مستخدم وإشعار دور صحيحين", () => {
    expect(validatePayload("notify.user", { userId: 5, ...n }).ok).toBe(true);
    expect(validatePayload("notify.role", { role: "chairman", ...n, referenceType: "order", referenceId: 3 }).ok).toBe(true);
  });
  it("بيرفض نوع مجهول وحقل ناقص وقيمة غلط", () => {
    expect(validatePayload("nope", {}).ok).toBe(false);
    const missing = validatePayload("notify.user", { ...n });
    expect(missing.ok).toBe(false);
    expect(validatePayload("notify.user", { userId: -1, ...n }).ok).toBe(false);
    expect(validatePayload("portal.alert", { userId: 1, template: "weird" }).ok).toBe(false);
    expect(validatePayload("portal.alert", { userId: 1, companyId: null, template: "password_changed" }).ok).toBe(true);
  });
  it("حقول زيادة بتتشال من القيمة المخزّنة", () => {
    const r = validatePayload("notify.role", { role: "hr", ...n, secret: "x" });
    expect(r.ok && (r.value as Record<string, unknown>).secret).toBeUndefined();
  });
});

describe("مفاتيح منع التكرار", () => {
  it("نفس الأجزاء = نفس المفتاح، والفاضي شرطة", () => {
    expect(dedupeKey("alert", 7, "password_changed", "2026-10-29T12")).toBe("alert:7:password_changed:2026-10-29T12");
    expect(dedupeKey("a", null, undefined, "")).toBe("a:-:-:-");
  });
  it("دلو الساعة بالتوقيت العالمي", () => {
    expect(hourBucket(new Date("2026-10-29T12:59:59Z"))).toBe("2026-10-29T12");
    expect(hourBucket(new Date("2026-10-29T13:00:00Z"))).toBe("2026-10-29T13");
  });
});

describe("فحص صحة النظام للصندوق", () => {
  it("فاضي = سليم", () => {
    const r = outboxHealth(stats({}), NOW);
    expect(r.status).toBe("ok");
    expect(r.message).toContain("مفيش");
  });
  it("حدث طازج في الطريق أو بيتعاد بسرعة = سليم", () => {
    expect(outboxHealth(stats({ pending: 3, retrying: 1, oldestDueAt: new Date(NOW.getTime() - 120_000) }), NOW).status).toBe("ok");
  });
  it("متأخر ساعة = تنبيه، 24 ساعة = خطر", () => {
    expect(outboxHealth(stats({ pending: 2, oldestDueAt: ago(2) }), NOW).status).toBe("warn");
    expect(outboxHealth(stats({ pending: 2, oldestDueAt: ago(30) }), NOW).status).toBe("bad");
  });
  it("حدث ميت = تنبيه، و5 فأكتر = خطر", () => {
    expect(outboxHealth(stats({ dead: 1 }), NOW).status).toBe("warn");
    expect(outboxHealth(stats({ dead: 5 }), NOW).status).toBe("bad");
  });
});
