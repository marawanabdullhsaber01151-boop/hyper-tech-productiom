/** @format */
// محرك الـsaga: عملية طويلة من خطوات، كل خطوة بتتنفذ في معاملة، والحالة بتتحفظ بعد كل خطوة.
// الدوال هنا نقية (بدون قاعدة بيانات)؛ التنفيذ الفعلي في sagas.ts.

export const SAGA_STATUSES = ["running", "waiting", "completed", "compensating", "compensated", "failed"] as const;
export type SagaStatus = (typeof SAGA_STATUSES)[number];
export const SAGA_MAX_ATTEMPTS = 5;
export const SAGA_BACKOFF_MINUTES = [1, 5, 30, 120] as const;

export type SagaState = Record<string, unknown>;

/** نتيجة خطوة: كمّل للي بعدها، أو استنى مهمة بشرية، أو خلّص. */
export type StepResult =
  | { type: "next"; state?: SagaState }
  | { type: "wait_task"; taskId: number; state?: SagaState }
  | { type: "done"; state?: SagaState };

export interface SagaStepContext {
  sagaId: number;
  state: SagaState;
  stepIndex: number;
  tx: unknown;
}
export interface SagaStep {
  name: string;
  run: (ctx: SagaStepContext) => Promise<StepResult>;
  /** تعويض الخطوة لو الـsaga فشلت بعدها (بيتنادى بالعكس). */
  compensate?: (ctx: SagaStepContext) => Promise<void>;
}
export interface SagaDefinition {
  type: string;
  steps: readonly SagaStep[];
}

export function sagaBackoffMs(attempts: number): number {
  const i = Math.min(Math.max(attempts, 1), SAGA_BACKOFF_MINUTES.length) - 1;
  return SAGA_BACKOFF_MINUTES[i]! * 60_000;
}

export interface SagaRow {
  status: SagaStatus;
  stepIndex: number;
  attempts: number;
}
export interface SagaPatch {
  status: SagaStatus;
  stepIndex: number;
  attempts: number;
  waitingTaskId: number | null;
  nextRunAt: Date | null;
  lastError: string | null;
  finished: boolean;
}

/** الحالة بعد نجاح خطوة. */
export function afterStepSuccess(row: SagaRow, totalSteps: number, result: StepResult, now: Date): SagaPatch {
  if (result.type === "done") return { status: "completed", stepIndex: totalSteps, attempts: 0, waitingTaskId: null, nextRunAt: null, lastError: null, finished: true };
  const nextIndex = row.stepIndex + 1;
  if (result.type === "wait_task") return { status: "waiting", stepIndex: nextIndex, attempts: 0, waitingTaskId: result.taskId, nextRunAt: new Date(now.getTime() + 60_000), lastError: null, finished: false };
  if (nextIndex >= totalSteps) return { status: "completed", stepIndex: totalSteps, attempts: 0, waitingTaskId: null, nextRunAt: null, lastError: null, finished: true };
  return { status: "running", stepIndex: nextIndex, attempts: 0, waitingTaskId: null, nextRunAt: now, lastError: null, finished: false };
}

/** الحالة بعد فشل خطوة: إعادة بتراجع زمني، وبعد آخر محاولة نبدأ التعويض (لو في خطوات قبلها اتنفذت). */
export function afterStepFailure(row: SagaRow, error: unknown, now: Date): SagaPatch {
  const attempts = row.attempts + 1;
  const msg = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  if (attempts >= SAGA_MAX_ATTEMPTS) {
    // بنعوّض من الخطوة اللي قبل الفاشلة (الفاشلة نفسها ما اتكمّلتش)
    const compIndex = row.stepIndex - 1;
    if (compIndex < 0) return { status: "failed", stepIndex: row.stepIndex, attempts, waitingTaskId: null, nextRunAt: null, lastError: msg, finished: true };
    return { status: "compensating", stepIndex: compIndex, attempts: 0, waitingTaskId: null, nextRunAt: now, lastError: msg, finished: false };
  }
  return { status: "running", stepIndex: row.stepIndex, attempts, waitingTaskId: null, nextRunAt: new Date(now.getTime() + sagaBackoffMs(attempts)), lastError: msg, finished: false };
}

/** بعد تعويض خطوة: نكمّل لما قبلها، ولو خلصنا الكل تبقى compensated. */
export function afterCompensation(row: SagaRow, now: Date): SagaPatch {
  const next = row.stepIndex - 1;
  if (next < 0) return { status: "compensated", stepIndex: 0, attempts: 0, waitingTaskId: null, nextRunAt: null, lastError: null, finished: true };
  return { status: "compensating", stepIndex: next, attempts: 0, waitingTaskId: null, nextRunAt: now, lastError: null, finished: false };
}

/** الـsaga المنتظرة مهمة: لما المهمة تخلص نكمّل، ولو اتلغت نعوّض. */
export function resumeAfterTask(row: SagaRow, taskStatus: string, now: Date): SagaPatch | null {
  if (taskStatus === "done") return { status: "running", stepIndex: row.stepIndex, attempts: 0, waitingTaskId: null, nextRunAt: now, lastError: null, finished: false };
  if (taskStatus === "cancelled") {
    const compIndex = row.stepIndex - 1;
    const err = "المهمة البشرية اللي كانت العملية مستنياها اتلغت.";
    if (compIndex < 0) return { status: "failed", stepIndex: row.stepIndex, attempts: 0, waitingTaskId: null, nextRunAt: null, lastError: err, finished: true };
    return { status: "compensating", stepIndex: compIndex, attempts: 0, waitingTaskId: null, nextRunAt: now, lastError: err, finished: false };
  }
  return null;
}
