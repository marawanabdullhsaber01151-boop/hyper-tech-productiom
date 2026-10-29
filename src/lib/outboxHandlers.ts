/** @format */
// معالجات أحداث صندوق الصادر. كل معالج بيشتغل جوه معاملة العامل: لو رمى خطأ، أثره كله بيتلغي والحدث بيتعاد.

import { eq } from "drizzle-orm";
import { notificationsTable, systemUsersTable } from "../db/schema";
import { deliver } from "./channels/deliver";
import type { Executor } from "./db-executor";
import { OUTBOX_PAYLOADS, type OutboxPayloadMap } from "./outboxCore";
import type { OutboxHandler } from "./outbox";

const notify: OutboxHandler = async (tx, raw) => {
  // نفس المعالج للنوعين: user و role (الاتنين بيتفرّدوا لإدراجات في جدول الإشعارات)
  const p = raw as { userId?: number; role?: string; type: string; title: string; body: string; referenceType?: string; referenceId?: number };
  const base = { type: p.type, title: p.title, body: p.body, referenceType: p.referenceType, referenceId: p.referenceId };
  if (typeof p.userId === "number") {
    await tx.insert(notificationsTable).values({ userId: p.userId, ...base });
    return;
  }
  const users: Array<{ id: number }> = await tx.select({ id: systemUsersTable.id }).from(systemUsersTable).where(eq(systemUsersTable.role, p.role as string));
  if (users.length) await tx.insert(notificationsTable).values(users.map((u) => ({ userId: u.id, ...base })));
};

const portalAlert: OutboxHandler = async (_tx: Executor, raw) => {
  const p = OUTBOX_PAYLOADS["portal.alert"].parse(raw) as OutboxPayloadMap["portal.alert"];
  const r = await deliver({ purpose: "alert", userId: p.userId, companyId: p.companyId ?? null, template: p.template, vars: {}, allowUnverified: false, only: ["email", "telegram"] });
  // أي قناة وصلت = تمام. مفيش قناة مضبوطة أو مفيش وجهة = مفيش داعي نعيد. كل المحاولات فشلت فعلًا = نعيد.
  const attempted = r.results.filter((x) => x.status === "sent" || x.status === "failed");
  if (!r.delivered && attempted.length > 0) throw new Error(`فشل إرسال التنبيه على ${attempted.length} قناة`);
};

export const OUTBOX_HANDLERS: Record<string, OutboxHandler> = {
  "notify.user": notify,
  "notify.role": notify,
  "portal.alert": portalAlert,
};
