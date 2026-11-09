/** @format */

import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import { portalMembersTable, portalNotificationsTable } from "../db/schema";
import { logger } from "./logger";
import { drainOutboxEvent, enqueueOutbox } from "./outbox";
import { dedupeKey, hourBucket, settleWithin } from "./outboxCore";
import { isExternalNotice, noticeRecipientIds } from "./portalNoticeCore";

/** أقصى انتظار لمحاولة الإرسال الفورية. الباقي يكمّله العامل (كل 15 دقيقة) بتراجع زمني. */
export const NOTICE_WAIT_MS = 2000;

export interface PortalNotificationPayload {
  type: string;
  title: string;
  body: string;
  referenceType?: string;
  referenceId?: number;
  /**
   * The member the event is about (e.g. who sent the order). They get their own
   * copy; the company owner side gets the company-wide copy (member_id NULL).
   */
  memberId?: number | null;
}

export async function notifyPortalCustomer(
  portalCustomerId: number,
  payload: PortalNotificationPayload,
) {
  const base = {
    portalCustomerId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    referenceType: payload.referenceType ?? "production_workflow",
    referenceId: payload.referenceId,
  };
  if (payload.memberId) {
    const [m] = await db
      .select({ id: portalMembersTable.id })
      .from(portalMembersTable)
      .where(
        and(
          eq(portalMembersTable.id, payload.memberId),
          eq(portalMembersTable.companyId, portalCustomerId),
        ),
      )
      .limit(1);
    if (m) {
      await db.insert(portalNotificationsTable).values({ ...base, memberId: payload.memberId });
    }
  }
  // Company-wide copy (member_id NULL) is always written: it is what the owner
  // side reads. Employees only read rows addressed to them.
  await db.insert(portalNotificationsTable).values({ ...base, memberId: null });
  await queueExternalNotices(portalCustomerId, payload);
}

/**
 * نفس الإشعار على القنوات الخارجية (إيميل/تيليجرام) للمستلمين اللي أكّدوا قناة. بيتكتب في صندوق الصادر (مضمون ومش مكرر)،
 * ولا بيكسّر الإشعار الداخلي أبدًا: أي خطأ هنا بيتسجّل بس.
 */
async function queueExternalNotices(portalCustomerId: number, payload: PortalNotificationPayload): Promise<void> {
  if (!isExternalNotice(payload.type)) return;
  try {
    const rows = await db
      .select({ id: portalMembersTable.id, userId: portalMembersTable.userId, isOwner: portalMembersTable.isOwner })
      .from(portalMembersTable)
      .where(
        and(
          eq(portalMembersTable.companyId, portalCustomerId),
          eq(portalMembersTable.status, "active"),
          or(eq(portalMembersTable.isOwner, true), payload.memberId ? eq(portalMembersTable.id, payload.memberId) : sql`false`),
        ),
      );
    const memberUserId = payload.memberId ? rows.find((r) => r.id === payload.memberId)?.userId ?? null : null;
    const ids = noticeRecipientIds({ memberUserId, ownerUserIds: rows.filter((r) => r.isOwner).map((r) => r.userId) });
    const bucket = hourBucket(new Date());
    const queued: number[] = [];
    for (const userId of ids) {
      const q = await enqueueOutbox(db, {
        type: "portal.notice",
        payload: { userId, companyId: portalCustomerId, type: payload.type, title: payload.title.slice(0, 300), body: payload.body.slice(0, 2000) },
        dedupeKey: dedupeKey("notice", userId, payload.type, payload.referenceType ?? "production_workflow", payload.referenceId, bucket),
      });
      if (!q.duplicate && q.id !== null) queued.push(q.id);
    }
    if (queued.length) await settleWithin(Promise.all(queued.map((id) => drainOutboxEvent(id))), NOTICE_WAIT_MS);
  } catch (e) {
    logger.warn("Portal notice could not be queued for external channels", { errorClass: e instanceof Error ? e.name : "unknown" });
  }
}
