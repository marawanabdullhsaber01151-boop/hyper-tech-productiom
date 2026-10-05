/** @format */
// Free instant notifications via Web Push (VAPID). No SMS/WhatsApp provider needed.
// Disabled (no-op) until VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are configured:
//   npx web-push generate-vapid-keys
import webpush from "web-push";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { chatPushSubscriptionsTable } from "../db/schema";

const PUBLIC = process.env.VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
let ready = false;
if (PUBLIC && PRIVATE) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
    ready = true;
  } catch (e) {
    console.error("[chat-push] invalid VAPID config", e);
  }
}

export const pushEnabled = () => ready;
export const pushPublicKey = () => (ready ? PUBLIC! : null);

export type PushPayload = { title: string; body: string; url: string; tag: string };

type Target = { customerId: number } | { userIds: number[] };

async function send(rows: { id: number; endpoint: string; p256dh: string; auth: string }[], payload: PushPayload) {
  const dead: number[] = [];
  await Promise.all(
    rows.map(async (r) => {
      try {
        await webpush.sendNotification(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24, urgency: "normal" },
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(r.id); // الاشتراك انتهى
        else console.error("[chat-push] send failed", code ?? (err as Error).message);
      }
    }),
  );
  if (dead.length) {
    await db.delete(chatPushSubscriptionsTable).where(inArray(chatPushSubscriptionsTable.id, dead));
  }
}

/** لا يرمي أبدًا — الإشعار تحسين وليس شرطًا لنجاح الرسالة. */
export async function pushTo(target: Target, payload: PushPayload): Promise<void> {
  if (!ready) return;
  try {
    const where =
      "customerId" in target ?
        and(eq(chatPushSubscriptionsTable.audience, "customer"), eq(chatPushSubscriptionsTable.portalCustomerId, target.customerId))
      : and(eq(chatPushSubscriptionsTable.audience, "staff"), inArray(chatPushSubscriptionsTable.userId, target.userIds.length ? target.userIds : [-1]));
    const rows = await db
      .select({ id: chatPushSubscriptionsTable.id, endpoint: chatPushSubscriptionsTable.endpoint, p256dh: chatPushSubscriptionsTable.p256dh, auth: chatPushSubscriptionsTable.auth })
      .from(chatPushSubscriptionsTable)
      .where(where);
    if (rows.length) await send(rows, payload);
  } catch (e) {
    console.error("[chat-push] failed", e);
  }
}
