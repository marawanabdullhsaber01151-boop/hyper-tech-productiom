/** @format */
/**
 * آثار جانبية بعد نجاح الـtransaction (إشعارات، رسائل…).
 *
 * المشكلة اللي بتحلها: لما الإشعار بيفشل بعد ما العملية اتسجّلت فعلًا، الراوت كان بيرجّع 500
 * فيحاول المستخدم تاني ويلاقي «اتراجعت بالفعل»، رغم إن الطلب اتأكد. العملية الأساسية نجحت؛
 * فشل رسالة جانبية لازم يتسجَّل في اللوج بس، ولا يقلب النجاح لخطأ.
 *
 * ملاحظة: ده حل انتقالي. الحل الكامل هو جدول outbox يُكتب في نفس الـtransaction (معيار 2.11).
 */

export type SideEffect = {
  /** اسم قصير يظهر في اللوج لو الأثر فشل */
  label: string;
  run: () => Promise<unknown> | unknown;
};

export type SideEffectFailure = { label: string; error: unknown };

export type FailureReporter = (failure: SideEffectFailure) => void;

async function defaultReporter(failure: SideEffectFailure): Promise<void> {
  const { logger } = await import("./logger");
  logger.error("Post-commit side effect failed", {
    label: failure.label,
    error: failure.error instanceof Error ? failure.error.message : String(failure.error),
  });
}

/**
 * ينفّذ كل الآثار بالتوازي ولا يرمي أبدًا. يرجّع الفاشل منها (للاختبار ولأي تصرف إضافي).
 */
export async function runAfterCommit(
  effects: ReadonlyArray<SideEffect>,
  report: FailureReporter = (failure) => void defaultReporter(failure),
): Promise<SideEffectFailure[]> {
  const settled = await Promise.allSettled(
    effects.map(async (effect) => effect.run()),
  );
  const failures: SideEffectFailure[] = [];
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      const failure = { label: effects[index].label, error: result.reason };
      failures.push(failure);
      try {
        report(failure);
      } catch {
        // التبليغ نفسه ما يوقعش الطلب.
      }
    }
  });
  return failures;
}
