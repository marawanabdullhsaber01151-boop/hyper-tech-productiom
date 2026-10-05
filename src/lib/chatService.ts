/** @format */

// Portal chat — database-backed service shared by the customer router
// (routes/portal-chat.ts) and the staff router (routes/chat-staff.ts).
//
// Concurrency rules:
// - Counters / pointers are updated with SQL expressions (x = x + 1,
//   GREATEST(...)) inside the same statement that reads them, never
//   read-modify-write in JS.
// - Idempotency: (conversation, sender_type, client_msg_id) is unique, so a
//   retried request returns the original message instead of duplicating it.
// - Escalation uses a conditional UPDATE ... WHERE escalated_at IS NULL
//   RETURNING, so exactly one concurrent sweeper wins.

import { and, eq, inArray, sql, desc, asc, gt, lt, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  chatAttachmentsTable,
  chatConversationsTable,
  chatMessagesTable,
  portalCustomersTable,
  portalPriceInquiriesTable,
  productionWorkflowOrdersTable,
  bomRecipesTable,
  systemUsersTable,
  type ChatConversation,
  type ChatMessage,
} from "../db/schema";
import {
  CHAT_AGENT_ROLES,
  CHAT_IMAGE_RETENTION_DAYS,
  CHAT_MANAGER_ROLES,
  CHAT_PAGE_SIZE,
  chatPreview,
  deriveDeliveryStatus,
  isEscalationDue,
  shouldSendAutoReply,
  type ChatContextType,
  type ParsedChatImage,
} from "./chatPolicy";
import { getChatConfig } from "./chatConfig";
import { pushTo } from "./chatPush";
import { chatPushSubscriptionsTable, chatStaffAccessTable } from "../db/schema";
import { effectiveChatMode } from "./chatPolicy";
import { notifyRole, notifyUser } from "./notifications";
import { notifyPortalCustomer } from "./portalNotifications";
import { sendCustomerAlert } from "./otpDelivery";

export type Sender =
  | { type: "customer"; customerId: number; name: string }
  | { type: "staff"; userId: number; name: string };

/* ============================================================
   Conversation lookup
============================================================ */

export async function getOrCreateConversation(
  customerId: number,
): Promise<ChatConversation> {
  const [existing] = await db
    .select()
    .from(chatConversationsTable)
    .where(eq(chatConversationsTable.portalCustomerId, customerId))
    .limit(1);
  if (existing) return existing;

  const [customer] = await db
    .select({
      fullName: portalCustomersTable.fullName,
      companyName: portalCustomersTable.companyName,
    })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId))
    .limit(1);
  if (!customer) {
    throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
  }

  // ON CONFLICT: two tabs opening the chat for the first time simultaneously.
  await db
    .insert(chatConversationsTable)
    .values({
      portalCustomerId: customerId,
      customerName: customer.fullName,
      customerCompany: customer.companyName,
    })
    .onConflictDoNothing({ target: chatConversationsTable.portalCustomerId });

  const [created] = await db
    .select()
    .from(chatConversationsTable)
    .where(eq(chatConversationsTable.portalCustomerId, customerId))
    .limit(1);
  return created;
}

/** المسؤول الفعلي = التعيين الصريح على المحادثة، وإلا مسؤول حساب العميل. */
export async function getEffectiveHandler(
  conversation: Pick<ChatConversation, "handlerUserId" | "portalCustomerId">,
): Promise<{ userId: number; name: string } | null> {
  let userId = conversation.handlerUserId;
  if (userId === null) {
    const [customer] = await db
      .select({ assigned: portalCustomersTable.assignedSalesUserId })
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.id, conversation.portalCustomerId))
      .limit(1);
    userId = customer?.assigned ?? null;
  }
  if (userId === null) return null;
  const [user] = await db
    .select({ id: systemUsersTable.id, name: systemUsersTable.fullName, status: systemUsersTable.status })
    .from(systemUsersTable)
    .where(eq(systemUsersTable.id, userId))
    .limit(1);
  if (!user || user.status !== "active") return null;
  return { userId: user.id, name: user.name };
}

/* ============================================================
   Serialization
============================================================ */

export type AttachmentView = { id: number; mime: string; expired: boolean };

export type MessageView = {
  id: number;
  senderType: string;
  senderName: string | null;
  kind: string;
  event: string | null;
  body: string;
  isInternal?: boolean;
  hidden: boolean;
  topic: string | null;
  context: { type: string; id: number; label: string } | null;
  attachment: AttachmentView | null;
  status?: "sent" | "delivered" | "read";
  createdAt: string;
};

async function loadAttachments(
  messageIds: number[],
): Promise<Map<number, AttachmentView>> {
  const map = new Map<number, AttachmentView>();
  if (!messageIds.length) return map;
  const rows = await db
    .select({
      id: chatAttachmentsTable.id,
      messageId: chatAttachmentsTable.messageId,
      mime: chatAttachmentsTable.mime,
      purgedAt: chatAttachmentsTable.purgedAt,
    })
    .from(chatAttachmentsTable)
    .where(inArray(chatAttachmentsTable.messageId, messageIds));
  for (const row of rows) {
    map.set(row.messageId, {
      id: row.id,
      mime: row.mime,
      expired: row.purgedAt !== null,
    });
  }
  return map;
}

export async function serializeMessages(
  rows: ChatMessage[],
  conversation: ChatConversation,
  audience: "customer" | "staff",
): Promise<MessageView[]> {
  const visible =
    audience === "customer" ? rows.filter((r) => !r.isInternal) : rows;
  const attachments = await loadAttachments(
    visible.filter((r) => r.kind === "image").map((r) => r.id),
  );

  return visible.map((m) => {
    const hidden = m.hiddenAt !== null;
    // The viewer's OWN messages get ticks derived from the counterpart's pointers.
    const ownType = audience === "customer" ? "customer" : "staff";
    let status: MessageView["status"];
    if (m.senderType === ownType) {
      status =
        audience === "customer" ?
          deriveDeliveryStatus(m.id, conversation.staffLastDeliveredId, conversation.staffLastReadId)
        : deriveDeliveryStatus(m.id, conversation.customerLastDeliveredId, conversation.customerLastReadId);
    }
    return {
      id: m.id,
      senderType: m.senderType,
      senderName: m.senderName,
      kind: m.kind,
      event: m.event,
      body:
        hidden && audience === "customer" ? "تم إخفاء هذه الرسالة" : m.body,
      ...(audience === "staff" ? { isInternal: m.isInternal } : {}),
      hidden,
      topic: m.topic,
      context:
        m.contextType && m.contextId ?
          { type: m.contextType, id: m.contextId, label: m.contextLabel ?? "" }
        : null,
      attachment:
        hidden && audience === "customer" ? null : (attachments.get(m.id) ?? null),
      ...(status ? { status } : {}),
      createdAt: m.createdAt.toISOString(),
    };
  });
}

/** آخر `limit` رسالة (أو الأحدث من `afterId`) بترتيب تصاعدي. */
export async function fetchMessages(
  conversationId: number,
  audience: "customer" | "staff",
  opts: { afterId?: number; beforeId?: number; limit?: number } = {},
): Promise<ChatMessage[]> {
  const limit = Math.min(opts.limit ?? CHAT_PAGE_SIZE, 100);
  const conditions = [eq(chatMessagesTable.conversationId, conversationId)];
  if (audience === "customer") {
    conditions.push(eq(chatMessagesTable.isInternal, false));
  }
  if (opts.afterId !== undefined && opts.afterId > 0) {
    conditions.push(gt(chatMessagesTable.id, opts.afterId));
    return db
      .select()
      .from(chatMessagesTable)
      .where(and(...conditions))
      .orderBy(asc(chatMessagesTable.id))
      .limit(200);
  }
  if (opts.beforeId !== undefined && opts.beforeId > 0) {
    conditions.push(lt(chatMessagesTable.id, opts.beforeId));
  }
  const rows = await db
    .select()
    .from(chatMessagesTable)
    .where(and(...conditions))
    .orderBy(desc(chatMessagesTable.id))
    .limit(limit);
  return rows.reverse();
}

/* ============================================================
   Context references (order / product / price inquiry)
============================================================ */

export async function resolveContext(
  customerId: number,
  type: ChatContextType,
  id: number,
): Promise<{ type: ChatContextType; id: number; label: string }> {
  const notFound = () =>
    Object.assign(new Error("العنصر المرفق غير موجود في حسابك"), { status: 404 });

  if (type === "order") {
    const [row] = await db
      .select({ orderNumber: productionWorkflowOrdersTable.orderNumber })
      .from(productionWorkflowOrdersTable)
      .where(
        and(
          eq(productionWorkflowOrdersTable.id, id),
          eq(productionWorkflowOrdersTable.portalCustomerId, customerId),
        ),
      )
      .limit(1);
    if (!row) throw notFound();
    return { type, id, label: `طلب ${row.orderNumber}` };
  }
  if (type === "price_inquiry") {
    const [row] = await db
      .select({ productName: portalPriceInquiriesTable.productName })
      .from(portalPriceInquiriesTable)
      .where(
        and(
          eq(portalPriceInquiriesTable.id, id),
          eq(portalPriceInquiriesTable.portalCustomerId, customerId),
        ),
      )
      .limit(1);
    if (!row) throw notFound();
    return { type, id, label: `طلب سعر: ${row.productName}` };
  }
  const [row] = await db
    .select({ productName: bomRecipesTable.productName })
    .from(bomRecipesTable)
    .where(eq(bomRecipesTable.id, id))
    .limit(1);
  if (!row) throw notFound();
  return { type, id, label: `منتج: ${row.productName}` };
}

/* ============================================================
   Posting a message
============================================================ */

export type PostMessageInput = {
  conversation: ChatConversation;
  sender: Sender;
  body: string;
  image?: ParsedChatImage | null;
  isInternal?: boolean;
  topic?: string | null;
  context?: { type: ChatContextType; id: number; label: string } | null;
  clientMsgId?: string | null;
  /** staff replying to an unassigned conversation claims it */
  claim?: boolean;
};

export type PostMessageResult = {
  message: ChatMessage;
  duplicate: boolean;
  conversation: ChatConversation;
};

export async function postMessage(
  input: PostMessageInput,
): Promise<PostMessageResult> {
  const { conversation: conv, sender } = input;
  const now = new Date();
  const isCustomer = sender.type === "customer";
  const isInternal = !isCustomer && input.isInternal === true;
  const kind = input.image ? "image" : "text";

  const txResult = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(chatMessagesTable)
      .values({
        conversationId: conv.id,
        senderType: sender.type,
        senderUserId: sender.type === "staff" ? sender.userId : null,
        senderName: sender.name,
        kind,
        body: input.body,
        isInternal,
        topic: input.topic ?? null,
        contextType: input.context?.type ?? null,
        contextId: input.context?.id ?? null,
        contextLabel: input.context?.label ?? null,
        clientMsgId: input.clientMsgId ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (!inserted.length) {
      // Retry of an already-stored message → return the original.
      const [original] = await tx
        .select()
        .from(chatMessagesTable)
        .where(
          and(
            eq(chatMessagesTable.conversationId, conv.id),
            eq(chatMessagesTable.senderType, sender.type),
            eq(chatMessagesTable.clientMsgId, input.clientMsgId ?? ""),
          ),
        )
        .limit(1);
      return { message: original, duplicate: true, updated: conv, firstUnread: false };
    }
    const message = inserted[0];

    if (input.image) {
      const expires = new Date(
        now.getTime() + CHAT_IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      await tx.insert(chatAttachmentsTable).values({
        messageId: message.id,
        conversationId: conv.id,
        mime: input.image.mime,
        sizeBytes: input.image.bytes.length,
        data: input.image.bytes,
        expiresAt: expires,
      });
    }

    const preview = chatPreview(input.body, Boolean(input.image));
    let updated: ChatConversation;
    let firstUnread = false;

    if (isCustomer) {
      const [row] = await tx
        .update(chatConversationsTable)
        .set({
          lastMessageId: message.id,
          lastMessageAt: now,
          lastMessagePreview: preview,
          lastSenderType: "customer",
          staffUnread: sql`${chatConversationsTable.staffUnread} + 1`,
          // the customer has obviously read/seen everything up to now
          customerLastDeliveredId: message.id,
          customerLastReadId: message.id,
          customerUnread: 0,
          customerLastSeenAt: now,
          awaitingStaffSince: sql`COALESCE(${chatConversationsTable.awaitingStaffSince}, ${now.toISOString()}::timestamptz)`,
          topic: input.topic ?
            input.topic
          : sql`${chatConversationsTable.topic}`,
          status: "open",
          closedAt: null,
        })
        .where(eq(chatConversationsTable.id, conv.id))
        .returning();
      updated = row;
      firstUnread = row.staffUnread === 1;
    } else if (isInternal) {
      // Internal notes never touch counters, preview or the SLA clock.
      updated = conv;
    } else {
      const [row] = await tx
        .update(chatConversationsTable)
        .set({
          lastMessageId: message.id,
          lastMessageAt: now,
          lastMessagePreview: preview,
          lastSenderType: "staff",
          customerUnread: sql`${chatConversationsTable.customerUnread} + 1`,
          staffUnread: 0,
          staffLastDeliveredId: message.id,
          staffLastReadId: message.id,
          awaitingStaffSince: null,
          escalatedAt: null,
          ...(input.claim && sender.type === "staff" ?
            { handlerUserId: sender.userId }
          : {}),
        })
        .where(eq(chatConversationsTable.id, conv.id))
        .returning();
      updated = row;
      firstUnread = row.customerUnread === 1;
    }

    return { message, duplicate: false, updated, firstUnread };
  });

  if (txResult.duplicate) {
    return {
      message: txResult.message,
      duplicate: true,
      conversation: txResult.updated,
    };
  }

  // Side effects AFTER commit; their failure must never fail the send.
  try {
    if (isCustomer) {
      await afterCustomerMessage(txResult.updated, input, now, txResult.firstUnread);
    } else if (!isInternal) {
      await afterStaffMessage(txResult.updated, now, txResult.firstUnread);
    }
  } catch (error) {
    console.error("[chat] side-effect failure", error);
  }

  return {
    message: txResult.message,
    duplicate: false,
    conversation: txResult.updated,
  };
}

async function insertSystemMessage(
  conversationId: number,
  event: string,
  body: string,
  opts: { internal?: boolean; bump?: boolean } = {},
): Promise<ChatMessage> {
  const [row] = await db
    .insert(chatMessagesTable)
    .values({
      conversationId,
      senderType: "system",
      senderName: "النظام",
      kind: "system",
      event,
      body,
      isInternal: opts.internal === true,
    })
    .returning();
  if (opts.bump && !opts.internal) {
    await db
      .update(chatConversationsTable)
      .set({
        lastMessageId: row.id,
        lastMessageAt: new Date(),
        lastMessagePreview: body.slice(0, 100),
        lastSenderType: "system",
      })
      .where(eq(chatConversationsTable.id, conversationId));
  }
  return row;
}

export { insertSystemMessage };

/** موظفون لديهم اشتراك Push ووضعهم الفعلي يسمح بالرد (مدير/يرد). */
async function staffPushRecipients(handlerUserId: number | null): Promise<number[]> {
  const rows = await db
    .selectDistinct({
      userId: chatPushSubscriptionsTable.userId,
      role: systemUsersTable.role,
      override: chatStaffAccessTable.mode,
    })
    .from(chatPushSubscriptionsTable)
    .innerJoin(systemUsersTable, eq(systemUsersTable.id, chatPushSubscriptionsTable.userId))
    .leftJoin(chatStaffAccessTable, eq(chatStaffAccessTable.userId, systemUsersTable.id))
    .where(and(eq(chatPushSubscriptionsTable.audience, "staff"), eq(systemUsersTable.status, "active")));
  const out: number[] = [];
  for (const r of rows) {
    if (r.userId === null) continue;
    const mode = effectiveChatMode(r.role, r.override);
    if (handlerUserId !== null) {
      if (r.userId === handlerUserId || mode === "manager") out.push(r.userId);
    } else if (mode === "manager" || mode === "agent") out.push(r.userId);
  }
  return out;
}

async function afterCustomerMessage(
  conv: ChatConversation,
  input: PostMessageInput,
  now: Date,
  firstUnread: boolean,
) {
  // 1) رد تلقائي خارج الدوام
  const config = await getChatConfig();
  if (shouldSendAutoReply({ now, lastAutoReplyAt: conv.lastAutoReplyAt, config })) {
    await insertSystemMessage(conv.id, "auto_reply", config.autoReplyText, {
      bump: false,
    });
    await db
      .update(chatConversationsTable)
      .set({ lastAutoReplyAt: now })
      .where(eq(chatConversationsTable.id, conv.id));
  }

  // 2) إشعار الموظف — فقط عند أول رسالة غير مقروءة (تخفيف الإزعاج)
  if (firstUnread) {
    const handler = await getEffectiveHandler(conv);
    const payload = {
      type: "chat_message",
      title: `رسالة جديدة من ${conv.customerName}`,
      body: chatPreview(input.body, Boolean(input.image)) || "رسالة جديدة",
      referenceType: "chat_conversation",
      referenceId: conv.id,
    };
    void staffPushRecipients(handler?.userId ?? null).then((userIds) =>
      pushTo(
        { userIds },
        { title: payload.title, body: payload.body, url: `chat-staff.html?c=${conv.id}`, tag: `chat-${conv.id}` },
      ),
    );
    if (handler) {
      await notifyUser(handler.userId, payload);
    } else {
      await Promise.all(
        [...CHAT_MANAGER_ROLES, ...CHAT_AGENT_ROLES].map((role) =>
          notifyRole(role, payload),
        ),
      );
    }
  }
}

async function afterStaffMessage(
  conv: ChatConversation,
  now: Date,
  firstUnread: boolean,
) {
  if (!firstUnread) return;
  // Web Push مجاني — نص عام (لا نكشف محتوى الرسالة على شاشة القفل)
  void pushTo(
    { customerId: conv.portalCustomerId },
    { title: "هايبر تك", body: "لديك رد جديد من فريق المبيعات", url: "portal-chat.html", tag: `chat-${conv.id}` },
  );
  await notifyPortalCustomer(conv.portalCustomerId, {
    type: "portal_chat_message",
    title: "رد جديد من فريق المبيعات",
    body: conv.lastMessagePreview || "لديك رسالة جديدة",
    referenceType: "chat",
    referenceId: conv.id,
  });

  // SMS: اختياري ومكلف → مغلق افتراضيًا، فقط لو العميل غير متصل، مرة كل 6 ساعات.
  if (process.env.CHAT_SMS_ENABLED !== "true") return;
  const offline =
    !conv.customerLastSeenAt ||
    now.getTime() - conv.customerLastSeenAt.getTime() > 5 * 60 * 1000;
  const cooled =
    !conv.lastSmsAt || now.getTime() - conv.lastSmsAt.getTime() > 6 * 60 * 60 * 1000;
  if (!offline || !cooled) return;

  const [customer] = await db
    .select({ phone: portalCustomersTable.phone })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, conv.portalCustomerId))
    .limit(1);
  if (!customer) return;
  const result = await sendCustomerAlert({
    channel: "phone",
    destination: customer.phone,
    message: "هايبر تك: لديك رد جديد من فريق المبيعات على بوابة العملاء.",
    event: "portal_chat_message",
  });
  if (result.delivered) {
    await db
      .update(chatConversationsTable)
      .set({ lastSmsAt: now })
      .where(eq(chatConversationsTable.id, conv.id));
  }
}

/* ============================================================
   Read / delivered pointers
============================================================ */

/** تُستدعى من استعلام العميل — تحدّث "تم التسليم" و"آخر ظهور" بكتابة واحدة على الأكثر كل 20 ثانية. */
export async function touchCustomerPresence(conversationId: number) {
  await db.execute(sql`
    UPDATE chat_conversations
       SET customer_last_delivered_id = GREATEST(customer_last_delivered_id, last_message_id),
           customer_last_seen_at = now()
     WHERE id = ${conversationId}
       AND (customer_last_delivered_id < last_message_id
            OR customer_last_seen_at IS NULL
            OR customer_last_seen_at < now() - interval '20 seconds')
  `);
}

export async function markCustomerRead(conversationId: number) {
  await db.execute(sql`
    UPDATE chat_conversations
       SET customer_last_read_id = last_message_id,
           customer_last_delivered_id = GREATEST(customer_last_delivered_id, last_message_id),
           customer_unread = 0,
           customer_last_seen_at = now()
     WHERE id = ${conversationId}
       AND (customer_last_read_id < last_message_id OR customer_unread > 0)
  `);
}

export async function markStaffDelivered(conversationId: number) {
  await db.execute(sql`
    UPDATE chat_conversations
       SET staff_last_delivered_id = GREATEST(staff_last_delivered_id, last_message_id)
     WHERE id = ${conversationId}
       AND staff_last_delivered_id < last_message_id
  `);
}

export async function markStaffRead(conversationId: number) {
  await db.execute(sql`
    UPDATE chat_conversations
       SET staff_last_read_id = last_message_id,
           staff_last_delivered_id = GREATEST(staff_last_delivered_id, last_message_id),
           staff_unread = 0
     WHERE id = ${conversationId}
       AND (staff_last_read_id < last_message_id OR staff_unread > 0)
  `);
}

/* ============================================================
   Escalation sweep (lazy — no cron needed)
============================================================ */

let lastSweepAt = 0;
const SWEEP_MIN_INTERVAL_MS = 20_000;

/**
 * يصعّد المحادثات التي تجاوزت مهلة الرد. يُستدعى عند أي نشاط شات، لكن
 * بحد أقصى مرة كل 20 ث لكل instance حتى لا يتحول لعبء على قاعدة البيانات.
 * (Vercel Hobby يسمح بكرون يومي فقط، لذلك التقييم "كسول" عند القراءة.)
 */
export async function sweepEscalations(force = false): Promise<number> {
  const nowMs = Date.now();
  if (!force && nowMs - lastSweepAt < SWEEP_MIN_INTERVAL_MS) return 0;
  lastSweepAt = nowMs;

  const now = new Date(nowMs);
  const config = await getChatConfig();
  // Pre-filter on wall-clock (cheap, uses the partial index); the exact
  // business-minutes check happens in JS.
  const candidates = await db
    .select({
      id: chatConversationsTable.id,
      customerName: chatConversationsTable.customerName,
      awaitingStaffSince: chatConversationsTable.awaitingStaffSince,
      escalatedAt: chatConversationsTable.escalatedAt,
    })
    .from(chatConversationsTable)
    .where(
      and(
        eq(chatConversationsTable.status, "open"),
        isNull(chatConversationsTable.escalatedAt),
        sql`${chatConversationsTable.awaitingStaffSince} IS NOT NULL
            AND ${chatConversationsTable.awaitingStaffSince} < now() - make_interval(mins => ${config.escalationMinutes})`,
      ),
    )
    .limit(50);

  let escalated = 0;
  for (const c of candidates) {
    if (
      !isEscalationDue({
        awaitingStaffSince: c.awaitingStaffSince,
        escalatedAt: c.escalatedAt,
        now,
        config,
      })
    ) {
      continue;
    }
    const [won] = await db
      .update(chatConversationsTable)
      .set({ escalatedAt: now })
      .where(
        and(
          eq(chatConversationsTable.id, c.id),
          isNull(chatConversationsTable.escalatedAt),
        ),
      )
      .returning({ id: chatConversationsTable.id });
    if (!won) continue; // another instance escalated it first
    escalated += 1;
    await insertSystemMessage(
      c.id,
      "escalated",
      "تم تصعيد المحادثة لمدير المبيعات لتأخر الرد.",
      { internal: true },
    );
    void staffPushRecipients(0).then((userIds) =>
      pushTo({ userIds }, { title: "محادثة متأخرة الرد", body: `${c.customerName} ينتظر الرد`, url: `chat-staff.html?c=${c.id}`, tag: `chat-${c.id}` }),
    );
    await notifyRole("sales_manager", {
      type: "chat_escalated",
      title: "محادثة متأخرة الرد",
      body: `${c.customerName} ينتظر رد منذ أكثر من ${config.escalationMinutes} دقيقة عمل.`,
      referenceType: "chat_conversation",
      referenceId: c.id,
    });
  }
  return escalated;
}

/* ============================================================
   Retention
============================================================ */

/** يمسح بايتات الصور المنتهية (الميتاداتا والرسائل تبقى). */
export async function purgeExpiredAttachments(): Promise<number> {
  const rows = await db
    .update(chatAttachmentsTable)
    .set({ data: null, purgedAt: new Date() })
    .where(
      and(
        isNull(chatAttachmentsTable.purgedAt),
        sql`${chatAttachmentsTable.expiresAt} < now()`,
      ),
    )
    .returning({ id: chatAttachmentsTable.id });
  return rows.length;
}
