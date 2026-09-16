/**
 * Phase 4 — the per-line Operations Manager gate.
 *
 * The UPDATE below is the concurrency boundary. PostgreSQL locks the target
 * row while evaluating/updating it; only one transaction can satisfy the
 * status + NULL-owner predicate and receive a returned row. A losing
 * transaction waits for that row lock, then sees the committed owner and gets
 * a specific conflict instead of a silent no-op.
 */
import { and, eq, isNull } from "drizzle-orm";
import { productionWorkflowOrdersTable } from "../db/schema";
import { writeAuditEvent } from "./governance";
import { recordProductionTransitionEvent } from "./production-lifecycle";

type ClaimTransaction = {
  update: (...args: any[]) => any;
  select: (...args: any[]) => any;
  insert?: (...args: any[]) => any;
};

export const OPERATIONS_CLAIM_STATUS = "awaiting_operations_claim" as const;
export const OPERATIONS_CLAIMED_STATUS = "claimed" as const;

export type OperationsClaimInput = {
  orderId: number;
  actorUserId: number;
  actorName: string;
  actionKey: string;
  reason?: string | null;
  ipAddress?: string;
  userAgent?: string;
};

export function alreadyClaimedError(
  claimedByName: string | null | undefined,
  claimedAt: Date | string | null | undefined,
) {
  const actor = claimedByName || "مستخدم آخر";
  const at = claimedAt ? new Date(claimedAt).toISOString() : "وقت غير معروف";
  return Object.assign(
    new Error(`تم استلام سطر الإنتاج بالفعل بواسطة ${actor} في ${at}`),
    {
      status: 409,
      code: "OPERATIONS_LINE_ALREADY_CLAIMED",
    },
  );
}

export async function claimOperationsLine(
  tx: ClaimTransaction,
  input: OperationsClaimInput,
  dependencies: {
    auditWriter?: typeof writeAuditEvent;
  } = {},
) {
  const claimedAt = new Date();
  const [claimed] = await tx
    .update(productionWorkflowOrdersTable)
    .set({
      workflowStatus: OPERATIONS_CLAIMED_STATUS,
      claimedById: input.actorUserId,
      claimedByName: input.actorName,
      claimedAt,
      updatedAt: claimedAt,
    })
    .where(
      and(
        eq(productionWorkflowOrdersTable.id, input.orderId),
        eq(
          productionWorkflowOrdersTable.workflowStatus,
          OPERATIONS_CLAIM_STATUS,
        ),
        isNull(productionWorkflowOrdersTable.claimedById),
      ),
    )
    .returning();

  if (!claimed) {
    const [current] = await tx
      .select({
        id: productionWorkflowOrdersTable.id,
        workflowStatus: productionWorkflowOrdersTable.workflowStatus,
        claimedById: productionWorkflowOrdersTable.claimedById,
        claimedByName: productionWorkflowOrdersTable.claimedByName,
        claimedAt: productionWorkflowOrdersTable.claimedAt,
      })
      .from(productionWorkflowOrdersTable)
      .where(eq(productionWorkflowOrdersTable.id, input.orderId))
      .limit(1);

    if (!current) {
      throw Object.assign(new Error("سطر الإنتاج غير موجود"), {
        status: 404,
        code: "OPERATIONS_LINE_NOT_FOUND",
      });
    }
    if (
      current.claimedById ||
      current.workflowStatus === OPERATIONS_CLAIMED_STATUS
    ) {
      throw alreadyClaimedError(current.claimedByName, current.claimedAt);
    }
    throw Object.assign(
      new Error("سطر الإنتاج ليس في انتظار استلام مدير التشغيل"),
      { status: 409, code: "OPERATIONS_LINE_NOT_AWAITING_CLAIM" },
    );
  }

  const auditWriter = dependencies.auditWriter ?? writeAuditEvent;
  await auditWriter({
    executor: tx as any,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    actionKey: input.actionKey,
    resourceType: "production_workflow_order",
    resourceId: claimed.id,
    beforeData: {
      workflowStatus: OPERATIONS_CLAIM_STATUS,
      orderNumber: claimed.orderNumber,
    },
    afterData: {
      workflowStatus: claimed.workflowStatus,
      orderNumber: claimed.orderNumber,
      claimedById: claimed.claimedById,
      claimedByName: claimed.claimedByName,
      claimedAt: claimed.claimedAt,
    },
    reason: input.reason ?? null,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
  // The unit-test fake predates the transition ledger and intentionally does
  // not expose insert(). Real PostgreSQL transactions always do.
  if (typeof tx.insert === "function" && claimed.lifecycleRevision !== undefined) {
    await recordProductionTransitionEvent(tx as any, {
      workflowOrderId: claimed.id,
      revision: claimed.lifecycleRevision,
      fromStatus: OPERATIONS_CLAIM_STATUS,
      toStatus: claimed.workflowStatus,
      actionKey: input.actionKey,
      actorUserId: input.actorUserId,
      actorName: input.actorName,
      reason: input.reason,
    });
  }

  return claimed;
}