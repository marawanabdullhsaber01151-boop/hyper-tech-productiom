import { and, desc, eq, lte, or } from "drizzle-orm";
import { db, approvalPoliciesTable, approvalRequestsTable, auditEventsTable, sodRulesTable } from "../db";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function findApprovalPolicy(actionKey: string, amount: number) {
  const [policy] = await db
    .select()
    .from(approvalPoliciesTable)
    .where(
      and(
        eq(approvalPoliciesTable.actionKey, actionKey),
        eq(approvalPoliciesTable.active, true),
        lte(approvalPoliciesTable.minAmount, String(amount)),
      ),
    )
    .orderBy(desc(approvalPoliciesTable.minAmount), approvalPoliciesTable.sequence)
    .limit(1);
  return policy ?? null;
}

export async function createApprovalRequest(input: {
  actionKey: string;
  resourceType: string;
  resourceId: number;
  amount: number;
  requestedBy: number;
  metadata?: unknown;
}, tx: Transaction) {
  const [policy] = await tx
    .select()
    .from(approvalPoliciesTable)
    .where(
      and(
        eq(approvalPoliciesTable.actionKey, input.actionKey),
        eq(approvalPoliciesTable.active, true),
        lte(approvalPoliciesTable.minAmount, String(input.amount)),
      ),
    )
    .orderBy(desc(approvalPoliciesTable.minAmount), approvalPoliciesTable.sequence)
    .limit(1);
  if (!policy) return null;

  const [request] = await tx
    .insert(approvalRequestsTable)
    .values({
      actionKey: input.actionKey,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      amount: String(input.amount),
      requestedBy: input.requestedBy,
      currentStep: policy.sequence,
      metadata: input.metadata,
    })
    .returning();
  return { request, policy };
}

export async function checkSoDViolation(
  userId: number,
  actionKey: string,
  resourceType: string,
  resourceId: number,
) {
  const rules = await db.select().from(sodRulesTable).where(and(
    or(
      eq(sodRulesTable.actionKeyApprove, actionKey),
      eq(sodRulesTable.actionKeyCreate, actionKey),
    ),
    eq(sodRulesTable.active, true),
  ));
  if (!rules.length) return false;
  const prior = await Promise.all(rules.map((rule) =>
    db.select({ id: auditEventsTable.id }).from(auditEventsTable)
      .where(and(
        eq(auditEventsTable.actorUserId, userId),
        eq(auditEventsTable.resourceType, resourceType),
        eq(auditEventsTable.resourceId, resourceId),
        eq(auditEventsTable.actionKey, rule.actionKeyCreate),
      )).limit(1)
  ));
  return prior.some((rows) => rows.length > 0);
}

/** A resource is executable only after every matching approval request is complete. */
export async function hasPendingApproval(
  resourceType: string,
  resourceId: number,
) {
  const [request] = await db.select({ id: approvalRequestsTable.id })
    .from(approvalRequestsTable)
    .where(and(
      eq(approvalRequestsTable.resourceType, resourceType),
      eq(approvalRequestsTable.resourceId, resourceId),
      eq(approvalRequestsTable.status, "pending"),
    )).limit(1);
  return Boolean(request);
}