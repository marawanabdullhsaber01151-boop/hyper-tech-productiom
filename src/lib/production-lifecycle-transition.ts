import { and, eq } from "drizzle-orm";
import {
  productionLifecycleAdjustmentsTable,
  productionWorkflowOrdersTable,
} from "../db/schema";
import {
  assertCanonicalProductionTransition,
  assertReason,
  requiredReasonForCanonicalTransition,
  type LifecycleAdjustmentType,
} from "../domain/production-lifecycle";
import { recordProductionTransitionEvent } from "./production-lifecycle";
import { writeAuditEvent } from "./governance";

type Tx = {
  select: (...args: any[]) => any;
  update: (...args: any[]) => any;
  insert: (...args: any[]) => any;
};

export type TransitionInput = {
  orderId: number;
  targetStatus: string;
  actorUserId: number;
  actorName: string;
  reason?: string | null;
  evidence?: unknown;
  expectedRevision?: number;
  adjustmentType?: LifecycleAdjustmentType;
  quantity?: string | null;
  relatedWorkflowOrderId?: number | null;
  actionKey?: string;
};

export async function transitionCanonicalProductionOrder(
  tx: Tx,
  input: TransitionInput,
) {
  const [before] = await tx
    .select()
    .from(productionWorkflowOrdersTable)
    .where(eq(productionWorkflowOrdersTable.id, input.orderId))
    .for("update")
    .limit(1);

  if (!before) {
    throw Object.assign(new Error("أمر الإنتاج غير موجود"), {
      status: 404,
      code: "CANONICAL_ORDER_NOT_FOUND",
    });
  }
  if (
    input.expectedRevision !== undefined &&
    before.lifecycleRevision !== input.expectedRevision
  ) {
    throw Object.assign(new Error("تغير الأمر من جلسة أخرى؛ أعد تحميل التفاصيل"), {
      status: 409,
      code: "LIFECYCLE_REVISION_CONFLICT",
      currentRevision: before.lifecycleRevision,
    });
  }

  assertCanonicalProductionTransition(before.workflowStatus, input.targetStatus);
  if (requiredReasonForCanonicalTransition(before.workflowStatus, input.targetStatus)) {
    assertReason(input.reason);
  }
  if (input.targetStatus === "closed" && !input.evidence) {
    throw Object.assign(new Error("دليل الإغلاق مطلوب"), {
      status: 400,
      code: "CLOSURE_EVIDENCE_REQUIRED",
    });
  }

  const update: Record<string, unknown> = {
    workflowStatus: input.targetStatus,
    updatedAt: new Date(),
  };
  if (input.targetStatus === "closed") {
    update.closedAt = new Date();
    update.closedById = input.actorUserId;
    update.closureEvidence = input.evidence;
  }
  if (input.targetStatus === "cancelled") {
    update.cancelledById = input.actorUserId;
    update.cancelledByName = input.actorName;
    update.cancelReason = input.reason;
    update.cancelledAt = new Date();
  }
  const [after] = await tx
    .update(productionWorkflowOrdersTable)
    .set(update)
    .where(
      and(
        eq(productionWorkflowOrdersTable.id, input.orderId),
        eq(
          productionWorkflowOrdersTable.lifecycleRevision,
          before.lifecycleRevision,
        ),
      ),
    )
    .returning();
  if (!after) {
    throw Object.assign(new Error("تغير الأمر من جلسة أخرى؛ لم يتم الانتقال"), {
      status: 409,
      code: "LIFECYCLE_CONCURRENT_UPDATE",
    });
  }

  const actionKey = input.actionKey ?? `production.lifecycle.${input.targetStatus}`;
  await recordProductionTransitionEvent(tx, {
    workflowOrderId: after.id,
    revision: after.lifecycleRevision,
    fromStatus: before.workflowStatus,
    toStatus: after.workflowStatus,
    actionKey,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    reason: input.reason,
    metadata: input.evidence ?? null,
  });
  if (input.adjustmentType) {
    await tx.insert(productionLifecycleAdjustmentsTable).values({
      workflowOrderId: after.id,
      relatedWorkflowOrderId: input.relatedWorkflowOrderId ?? null,
      adjustmentType: input.adjustmentType,
      fromStatus: before.workflowStatus,
      toStatus: after.workflowStatus,
      quantity: input.quantity ?? null,
      reason: input.reason!.trim(),
      evidence: input.evidence ?? null,
      actorUserId: input.actorUserId,
      actorName: input.actorName,
    });
  }
  await writeAuditEvent({
    executor: tx as any,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    actionKey,
    resourceType: "production_workflow_order",
    resourceId: after.id,
    beforeData: { workflowStatus: before.workflowStatus, lifecycleRevision: before.lifecycleRevision },
    afterData: { workflowStatus: after.workflowStatus, lifecycleRevision: after.lifecycleRevision },
    reason: input.reason ?? null,
  });
  return after;
}