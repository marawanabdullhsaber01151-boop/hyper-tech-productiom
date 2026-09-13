import { and, eq, isNull, lte, gte, desc } from "drizzle-orm";
import { db, delegationsTable, auditEventsTable } from "../db";
import { createHash } from "node:crypto";

// ✅ إصلاح حرج: الشرط ده كان بيقارن Number(row.maxAmount) >= 0 — وبما إن
// maxAmount دايمًا رقم موجب أو null (متأكد منها بـ regex في createDelegationSchema)،
// الشرط ده كان صحيح دايمًا (tautology) ومكانوش بيعمل أي فلترة فعلية خالص.
// الدالة دي مسؤوليتها الوحيدة إنها ترجع أحدث تفويض نشط (الوقت + الحالة)
// للإجراء ده — التحقق من حد المبلغ (maxAmount) بقى مسؤولية منفصلة تمامًا
// عن طريق delegationCoversAmount() في أي route محتاج يتحقق من مبلغ فعلي
// (لأن requirePermission نفسه بيشتغل كـ middleware قبل قراءة جسم الطلب،
// فمش عارف قيمة المبلغ في اللحظة دي أصلاً).
export async function findActiveDelegation(userId: number, actionKey: string, now = new Date()) {
  await db.update(delegationsTable).set({ status: "expired" }).where(and(
    eq(delegationsTable.delegateUserId, userId),
    eq(delegationsTable.actionKey, actionKey),
    eq(delegationsTable.status, "active"),
    lte(delegationsTable.endsAt, now),
  ));
  const [row] = await db.select().from(delegationsTable).where(and(
    eq(delegationsTable.delegateUserId, userId),
    eq(delegationsTable.actionKey, actionKey),
    eq(delegationsTable.status, "active"),
    isNull(delegationsTable.revokedAt),
    lte(delegationsTable.startsAt, now),
    gte(delegationsTable.endsAt, now),
  )).orderBy(desc(delegationsTable.createdAt)).limit(1);
  return row ?? null;
}

export function delegationCoversAmount(delegation: typeof delegationsTable.$inferSelect, amount: number) {
  return !delegation.maxAmount || Number(delegation.maxAmount) >= amount;
}

type AuditExecutor = Pick<typeof db, "select" | "insert">;

export async function writeAuditEvent(input: {
  actorUserId?: number | null; actorName?: string | null; actionKey: string;
  resourceType: string; resourceId?: number | null; beforeData?: unknown;
  afterData?: unknown; decision?: string; reason?: string | null;
  delegationId?: number | null; ipAddress?: string | null; userAgent?: string | null;
  executor?: AuditExecutor;
}) {
  // تمرير tx هنا مهم للعمليات المركبة: لا نسجل تدقيقًا ناجحًا إذا فشل
  // إنشاء الحساب أو أي خطوة أخرى داخل نفس العملية.
  const executor = input.executor ?? db;
  const [previous] = await executor.select({ recordHash: auditEventsTable.recordHash })
    .from(auditEventsTable).orderBy(desc(auditEventsTable.id)).limit(1);
  const createdAt = new Date();
  const prevHash = previous?.recordHash || null;
  const recordHash = createHash("sha256").update([
    prevHash ?? "", input.actorUserId ?? "", input.actionKey,
    input.resourceId ?? "", createdAt.toISOString(),
  ].join("")).digest("hex");
  await executor.insert(auditEventsTable).values({
    actorUserId: input.actorUserId ?? null, actorName: input.actorName ?? null,
    actionKey: input.actionKey, resourceType: input.resourceType,
    resourceId: input.resourceId ?? null, beforeData: input.beforeData,
    afterData: input.afterData, decision: input.decision ?? "executed",
    reason: input.reason ?? null, delegationId: input.delegationId ?? null,
    ipAddress: input.ipAddress ?? null, userAgent: input.userAgent ?? null,
    prevHash, recordHash, createdAt,
  });
}