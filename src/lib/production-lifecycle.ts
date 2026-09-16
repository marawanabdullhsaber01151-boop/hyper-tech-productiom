import { productionTransitionEventsTable } from "../db/schema";

type LifecycleTransaction = {
  insert: (...args: any[]) => any;
};

export async function recordProductionTransitionEvent(
  tx: LifecycleTransaction,
  input: {
    workflowOrderId: number;
    revision: number;
    fromStatus?: string | null;
    toStatus: string;
    actionKey: string;
    actorUserId?: number | null;
    actorName?: string | null;
    reason?: string | null;
    source?: string;
    metadata?: unknown;
  },
) {
  const [event] = await tx
    .insert(productionTransitionEventsTable)
    .values({
      workflowOrderId: input.workflowOrderId,
      revision: input.revision,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus,
      actionKey: input.actionKey,
      actorUserId: input.actorUserId ?? null,
      actorName: input.actorName ?? null,
      reason: input.reason ?? null,
      source: input.source ?? "api",
      metadata: input.metadata ?? null,
    })
    .returning();
  return event;
}