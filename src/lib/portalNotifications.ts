/** @format */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { portalMembersTable, portalNotificationsTable } from "../db/schema";

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
}
