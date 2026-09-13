/** @format */

import { db } from "../db";
import { portalNotificationsTable } from "../db/schema";

export interface PortalNotificationPayload {
  type: string;
  title: string;
  body: string;
  referenceType?: string;
  referenceId?: number;
}

export async function notifyPortalCustomer(
  portalCustomerId: number,
  payload: PortalNotificationPayload,
) {
  await db.insert(portalNotificationsTable).values({
    portalCustomerId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    referenceType: payload.referenceType ?? "production_workflow",
    referenceId: payload.referenceId,
  });
}