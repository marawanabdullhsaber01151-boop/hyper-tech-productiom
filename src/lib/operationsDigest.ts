import { and, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  notificationsTable,
  operationTransfersTable,
  operationsCasesTable,
  operationsPlansTable,
  productionWorkflowOrdersTable,
  purchaseRequisitionsTable,
} from "../db/schema";
import { notifyRoles } from "./notifications";
import { ACTIVE_CASE_STATUSES, caseRisk } from "./operationsCenterCore";
import { loadCapacityForecast } from "./operationsCapacity";
import { OPS_DIGEST_DEDUPE_HOURS, OPS_DIGEST_REF, OPS_DIGEST_TYPE, composeOpsDigest } from "./operationsDigestCore";
import { OPERATIONS_CONTROL_ROLES } from "./operations-control-policy";

const ORDER_DONE = ["delivered_customer", "delivered_warehouse", "cancelled", "closed", "corrected"];

export type OpsDigestResult = { sent: boolean; reason?: "already_sent"; attention?: number };

/** ملخص التشغيل اليومي للمدير التشغيلي والتنفيذي والرئيس. بيتبعت مرة في اليوم من نفس الـcron الموجود. */
export async function sendOperationsDigest(now: Date = new Date()): Promise<OpsDigestResult> {
  const since = new Date(now.getTime() - OPS_DIGEST_DEDUPE_HOURS * 3_600_000);
  const [recent] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.type, OPS_DIGEST_TYPE), gte(notificationsTable.createdAt, since)))
    .limit(1);
  if (recent) return { sent: false, reason: "already_sent" };

  const count = async (q: PromiseLike<Array<{ n: number }>>) => (await q)[0]?.n ?? 0;
  const [cases, awaitingClaim, reqs, transfers, overdue, plans, cap] = await Promise.all([
    db.select().from(operationsCasesTable).where(inArray(operationsCasesTable.status, [...ACTIVE_CASE_STATUSES])),
    count(db.select({ n: sql<number>`count(*)::int` }).from(productionWorkflowOrdersTable).where(eq(productionWorkflowOrdersTable.workflowStatus, "awaiting_operations_claim"))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.status, "pending_operations"))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(operationTransfersTable).where(eq(operationTransfersTable.status, "pending"))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(productionWorkflowOrdersTable).where(and(
      sql`${productionWorkflowOrdersTable.neededBy} IS NOT NULL AND ${productionWorkflowOrdersTable.neededBy} < (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date`,
      notInArray(productionWorkflowOrdersTable.workflowStatus, ORDER_DONE),
    ))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(operationsPlansTable).where(eq(operationsPlansTable.status, "submitted"))),
    loadCapacityForecast(now),
  ]);
  const digest = composeOpsDigest({
    activeCases: cases.length,
    atRiskCases: cases.filter((c) => caseRisk(c, now).level === "high").length,
    unassigned: cases.filter((c) => !c.assignedTo).length,
    awaitingClaim,
    requisitionsPending: reqs,
    transfersPending: transfers,
    overdueOrders: overdue,
    plansWaiting: plans,
    utilization: cap.forecast.utilization,
    overloadedDays: cap.forecast.overloadedDays,
    lateOrders: cap.forecast.lateOrders,
  });
  await notifyRoles([...OPERATIONS_CONTROL_ROLES.caseView], {
    type: OPS_DIGEST_TYPE,
    title: digest.title,
    body: digest.body,
    referenceType: OPS_DIGEST_REF,
  });
  return { sent: true, attention: digest.attention };
}
