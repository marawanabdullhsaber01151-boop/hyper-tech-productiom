/** @format */
// صندوق الاعتمادات (الخطوة 39أ): الطلبات المعلّقة اللي دوري (أو تفويضي) يعتمدها، بمهلة ساعات العمل ومحاكي الأثر،
// ومسح المهلة اللي بيفتح مهمة تصعيد للطلبات المتأخرة. القرار نفسه بيمشي على PATCH /governance/approval-requests/:id/decide.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, approvalPoliciesTable, approvalRequestsTable, systemUsersTable, salesOrderItemsTable } from "../db";
import { ACTION_REGISTRY } from "./actionRegistry";
import { getEffectiveRoles } from "./delegation";
import { createTask } from "./humanTasks";
import { roleLabel } from "./roleLabels";
import { loadOperationalConfig } from "./settingsStore";
import { decideVerdict, describeImpact, slaState, workingMinutesBetween, type DecideVerdict, type Impact, type SlaState } from "../domain/approvals-inbox";

/** مين يشوف الصندوق ويقرر (نفس أدوار /governance/approval-requests). */
export const APPROVER_ROLES = ["chairman", "executive_manager", "sales_manager", "purchasing_manager", "hr_manager", "production_manager", "operations_manager"] as const;

export interface InboxRow {
  id: number;
  actionKey: string;
  resourceType: string;
  resourceId: number;
  title: string;
  amount: number;
  status: string;
  requesterName: string;
  requesterRoleLabel: string;
  createdAt: Date;
  /** من أول الخطوة الحالية (أو إنشاء الطلب)، بدقايق ساعات العمل. */
  waitedMinutes: number;
  sla: SlaState;
  stepRoleLabels: string[];
  mine: boolean;
  verdict: DecideVerdict;
  impact: Impact;
  decisionNote: string | null;
  decidedAt: Date | null;
}

const ACTION_LABEL = new Map(ACTION_REGISTRY.map((a) => [a.key, a.label]));
const strMeta = (m: unknown, k: string): string | null => (m && typeof m === "object" && typeof (m as Record<string, unknown>)[k] === "string" ? ((m as Record<string, unknown>)[k] as string) : null);

/** بداية انتظار الخطوة الحالية: وقت آخر قرار (الخطوة السابقة) أو إنشاء الطلب. */
export const stepStartedAt = (r: { createdAt: Date; decidedAt: Date | null }): Date => r.decidedAt ?? r.createdAt;

export function requestTitle(r: { actionKey: string; resourceType: string; resourceId: number; metadata: unknown }): string {
  const label = ACTION_LABEL.get(r.actionKey) ?? "طلب اعتماد";
  const ref = strMeta(r.metadata, "orderNumber");
  return ref ? `${label} ${ref}` : `${label} (${r.resourceType} رقم ${r.resourceId})`;
}

export async function loadInbox(user: { userId: number; role: string }, mode: "pending" | "history", now: Date = new Date()): Promise<InboxRow[]> {
  const cfg = await loadOperationalConfig();
  let roles: string[] = [user.role];
  try { roles = await getEffectiveRoles(user.userId); } catch { /* fallback للدور الأساسي */ }
  const policies = await db.select().from(approvalPoliciesTable).where(eq(approvalPoliciesTable.active, true));
  const rows = mode === "pending"
    ? await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.status, "pending")).orderBy(approvalRequestsTable.createdAt)
    : await db.select().from(approvalRequestsTable).where(inArray(approvalRequestsTable.status, ["approved", "rejected"])).orderBy(desc(approvalRequestsTable.decidedAt)).limit(100);

  const stepRoles = (actionKey: string, step: number): string[] => (policies.find((p) => p.actionKey === actionKey && p.sequence === step)?.approverRoles as string[] | undefined) ?? [];
  const nextRoles = (actionKey: string, step: number): string[] | null => {
    const next = policies.filter((p) => p.actionKey === actionKey && p.sequence > step).sort((a, b) => a.sequence - b.sequence)[0];
    return next ? (next.approverRoles as string[]) : null;
  };
  // الظاهر: الطلب اللي دوري يعتمد خطوته الحالية. السجل: أي طلب لنوع أنا معتمد عليه في أي خطوة، أو أنا اللي أنشأته.
  const visible = rows.filter((r) =>
    mode === "pending"
      ? stepRoles(r.actionKey, r.currentStep).some((x) => roles.includes(x))
      : r.requestedBy === user.userId || policies.some((p) => p.actionKey === r.actionKey && (p.approverRoles as string[]).some((x) => roles.includes(x))),
  );
  if (!visible.length) return [];

  const userIds = [...new Set(visible.map((r) => r.requestedBy))];
  const users = await db.select({ id: systemUsersTable.id, name: systemUsersTable.fullName, username: systemUsersTable.username, role: systemUsersTable.role }).from(systemUsersTable).where(inArray(systemUsersTable.id, userIds));
  const userById = new Map(users.map((u) => [u.id, u]));

  const salesIds = visible.filter((r) => r.resourceType === "sales_order").map((r) => r.resourceId);
  const counts = salesIds.length
    ? await db.select({ orderId: salesOrderItemsTable.orderId, n: sql<number>`count(*)::int` }).from(salesOrderItemsTable).where(inArray(salesOrderItemsTable.orderId, salesIds)).groupBy(salesOrderItemsTable.orderId)
    : [];
  const itemCount = new Map(counts.map((c) => [c.orderId, c.n]));

  // من الموظفين النشطين اللي دورهم معتمد للخطوة (لقاعدة «الوحيد المعتمد»)
  const allStepRoles = [...new Set(visible.flatMap((r) => stepRoles(r.actionKey, r.currentStep)))];
  const approvers = allStepRoles.length ? await db.select({ id: systemUsersTable.id, role: systemUsersTable.role }).from(systemUsersTable).where(and(eq(systemUsersTable.status, "active"), inArray(systemUsersTable.role, allStepRoles))) : [];

  return visible.map((r) => {
    const sr = stepRoles(r.actionKey, r.currentStep);
    const requester = userById.get(r.requestedBy);
    const waited = r.status === "pending" ? workingMinutesBetween(stepStartedAt(r), now, cfg.work) : 0;
    const soleApprover = !approvers.some((a) => a.id !== r.requestedBy && sr.includes(a.role));
    return {
      id: r.id,
      actionKey: r.actionKey,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      title: requestTitle(r),
      amount: Number(r.amount),
      status: r.status,
      requesterName: requester?.name || requester?.username || "—",
      requesterRoleLabel: requester ? roleLabel(requester.role) : "",
      createdAt: r.createdAt,
      waitedMinutes: waited,
      sla: slaState(waited, cfg.slaMinutes),
      stepRoleLabels: sr.map(roleLabel),
      mine: r.requestedBy === user.userId,
      verdict: decideVerdict({ userId: user.userId, requestedBy: r.requestedBy, roles, stepRoles: sr, requesterIsSoleApprover: soleApprover }),
      impact: describeImpact({ resourceType: r.resourceType, amount: Number(r.amount), metadata: r.metadata, nextStepRoles: nextRoles(r.actionKey, r.currentStep), itemCount: itemCount.get(r.resourceId) ?? null }),
      decisionNote: r.decisionNote,
      decidedAt: r.status === "pending" ? null : r.decidedAt,
    };
  });
}

/** مفتاح منع تكرار مهمة التصعيد: طلب + خطوة + وقت بداية الخطوة (يعني مهمة واحدة لكل خطوة). */
export const slaDedupeKey = (id: number, step: number, startedAt: Date) => `approval-sla:${id}:${step}:${startedAt.getTime()}`;

/**
 * مسح المهلة (من عامل الـ15 دقيقة): كل طلب معلّق عدّى 4 ساعات عمل من بداية خطوته بيتفتح له مهمة بشرية عالية الأولوية
 * للإدارة العليا (للرئيس، وللمدير التنفيذي لو الرئيس هو صاحب الطلب)، وأي مهمة لطلب اتقفل بتتقفل لوحدها.
 */
export async function scanApprovalSla(now: Date = new Date()): Promise<{ created: number; closed: number }> {
  const cfg = await loadOperationalConfig();
  const pending = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.status, "pending")).orderBy(approvalRequestsTable.createdAt).limit(200);
  let created = 0;
  if (pending.length) {
    const reqUsers = await db.select({ id: systemUsersTable.id, role: systemUsersTable.role }).from(systemUsersTable).where(inArray(systemUsersTable.id, [...new Set(pending.map((p) => p.requestedBy))]));
    const roleOf = new Map(reqUsers.map((u) => [u.id, u.role]));
    for (const r of pending) {
      const start = stepStartedAt(r);
      const waited = workingMinutesBetween(start, now, cfg.work);
      if (waited < cfg.slaMinutes) continue;
      const { duplicate } = await createTask(
        {
          kind: "approval_sla",
          title: `اعتماد متأخر: ${requestTitle(r)}`,
          description: `الطلب مستني الاعتماد بقاله ${Math.floor(waited / 60)} ساعة عمل (المهلة ${cfg.slaMinutes / 60} ساعات عمل). افتح صندوق الاعتمادات وقرر، أو وجّه صاحب الدور المعتمد.`,
          priority: "high",
          assigneeRole: roleOf.get(r.requestedBy) === "chairman" ? "executive_manager" : "chairman",
          escalateToRole: "chairman",
          dueAt: new Date(now.getTime() + 4 * 3_600_000),
          sourceType: "approval_request",
          sourceId: r.id,
          dedupeKey: slaDedupeKey(r.id, r.currentStep, start),
        },
        null,
      ).catch(() => ({ duplicate: true }));
      if (!duplicate) created += 1;
    }
  }
  // قفل مهام المهلة لطلبات ما بقتش معلّقة
  const stale = await db.execute(sql`
    SELECT t.id FROM human_tasks t
    JOIN approval_requests a ON a.id = t.source_id
    WHERE t.source_type = 'approval_request' AND t.kind = 'approval_sla' AND t.status IN ('open','in_progress') AND a.status <> 'pending'
    LIMIT 100`);
  const ids = (stale.rows as Array<{ id: number }>).map((x) => x.id);
  if (ids.length) {
    await db.transaction(async (tx) => {
      for (const id of ids) {
        await tx.execute(sql`UPDATE human_tasks SET status = 'cancelled', next_escalation_at = NULL, result_note = 'الطلب اتقفل', updated_at = now() WHERE id = ${id} AND status IN ('open','in_progress')`);
        await tx.execute(sql`INSERT INTO human_task_events (task_id, event, actor_user_id, detail) VALUES (${id}, 'cancelled', NULL, 'اتلغت تلقائيًا: طلب الاعتماد اتقفل.')`);
      }
    });
  }
  return { created, closed: ids.length };
}
