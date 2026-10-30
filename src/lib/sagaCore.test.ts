/** @format */
import { describe, expect, it } from "vitest";
import { afterCompensation, afterStepFailure, afterStepSuccess, resumeAfterTask, sagaBackoffMs, SAGA_MAX_ATTEMPTS } from "./sagaCore";

const now = new Date("2026-11-01T10:00:00Z");
const row = (stepIndex: number, attempts = 0) => ({ status: "running" as const, stepIndex, attempts });

describe("saga — نجاح الخطوة", () => {
  it("next: بينقل للخطوة اللي بعدها ويصفّر المحاولات", () => {
    const p = afterStepSuccess(row(0, 3), 3, { type: "next" }, now);
    expect(p).toMatchObject({ status: "running", stepIndex: 1, attempts: 0, finished: false });
  });
  it("آخر خطوة = completed", () => {
    expect(afterStepSuccess(row(2), 3, { type: "next" }, now)).toMatchObject({ status: "completed", finished: true });
    expect(afterStepSuccess(row(0), 3, { type: "done" }, now)).toMatchObject({ status: "completed", finished: true });
  });
  it("wait_task: بتستنى المهمة وبتحفظ رقمها", () => {
    expect(afterStepSuccess(row(0), 3, { type: "wait_task", taskId: 77 }, now)).toMatchObject({ status: "waiting", stepIndex: 1, waitingTaskId: 77 });
  });
});

describe("saga — الفشل والتعويض", () => {
  it("فشل أول: إعادة بتراجع زمني", () => {
    const p = afterStepFailure(row(1), new Error("x"), now);
    expect(p.status).toBe("running");
    expect(p.attempts).toBe(1);
    expect(p.nextRunAt!.getTime()).toBe(now.getTime() + sagaBackoffMs(1));
  });
  it("بعد آخر محاولة: تعويض من الخطوة السابقة", () => {
    const p = afterStepFailure(row(2, SAGA_MAX_ATTEMPTS - 1), "boom", now);
    expect(p).toMatchObject({ status: "compensating", stepIndex: 1 });
    expect(p.lastError).toBe("boom");
  });
  it("فشل نهائي في أول خطوة = failed بدون تعويض", () => {
    expect(afterStepFailure(row(0, SAGA_MAX_ATTEMPTS - 1), "e", now)).toMatchObject({ status: "failed", finished: true });
  });
  it("التعويض بيمشي بالعكس لحد compensated", () => {
    const a = afterCompensation({ status: "compensating", stepIndex: 1, attempts: 0 }, now);
    expect(a).toMatchObject({ status: "compensating", stepIndex: 0 });
    expect(afterCompensation({ status: "compensating", stepIndex: 0, attempts: 0 }, now)).toMatchObject({ status: "compensated", finished: true });
  });
  it("التراجع الزمني يزيد وبيتوقف عند آخر قيمة", () => {
    expect(sagaBackoffMs(2)).toBeGreaterThan(sagaBackoffMs(1));
    expect(sagaBackoffMs(99)).toBe(sagaBackoffMs(4));
  });
});

describe("saga — استئناف بعد مهمة بشرية", () => {
  const waiting = { status: "waiting" as const, stepIndex: 1, attempts: 0 };
  it("المهمة اتنفذت: كمّل", () => expect(resumeAfterTask(waiting, "done", now)).toMatchObject({ status: "running", stepIndex: 1 }));
  it("المهمة اتلغت: تعويض", () => expect(resumeAfterTask(waiting, "cancelled", now)).toMatchObject({ status: "compensating", stepIndex: 0 }));
  it("لسه مفتوحة: كمّل استنى", () => expect(resumeAfterTask(waiting, "open", now)).toBeNull());
});
