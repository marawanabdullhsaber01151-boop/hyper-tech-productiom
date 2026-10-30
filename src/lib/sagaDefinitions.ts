/** @format */
// تعريفات العمليات الطويلة (saga). كل عملية جديدة (الخطوات 39 و53 و58...) بتتضاف هنا.
// «اتصال متابعة»: بتنشئ مهمة اتصال للمسؤول بموعد، وتستنى لحد ما تتنفذ، وبعدها تخلّص.

import { createTask } from "./humanTasks";
import type { SagaDefinition } from "./sagaCore";
import type { Executor } from "./db-executor";

const followUpCall: SagaDefinition = {
  type: "follow_up_call",
  steps: [
    {
      name: "create_call_task",
      run: async ({ state, tx, sagaId }) => {
        const s = state as { title?: string; assigneeRole?: string; assigneeUserId?: number; dueHours?: number; sourceType?: string; sourceId?: number };
        const { task } = await createTask(
          {
            kind: "follow_up_call",
            title: s.title ?? "اتصال متابعة بالعميل",
            assigneeRole: s.assigneeRole ?? "sales_manager",
            assigneeUserId: s.assigneeUserId,
            dueAt: new Date(Date.now() + (s.dueHours ?? 24) * 3_600_000),
            sourceType: s.sourceType,
            sourceId: s.sourceId,
            dedupeKey: `saga:${sagaId}:call`,
          },
          null,
          undefined,
          tx as Executor,
        );
        return { type: "wait_task", taskId: task.id, state: { taskId: task.id } };
      },
      compensate: async () => undefined,
    },
    { name: "finish", run: async () => ({ type: "done" }) },
  ],
};

export const SAGA_DEFINITIONS: Record<string, SagaDefinition> = { follow_up_call: followUpCall };
