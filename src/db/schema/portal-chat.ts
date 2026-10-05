/** @format */
/**
 * Portal chat — محادثة العميل مع مسؤول حسابه.
 *
 * Design notes (see docs/chat/DESIGN.md):
 * - ONE perpetual thread per portal customer (unique portal_customer_id).
 *   "Open/closed" is a follow-up state for staff, not a new thread.
 * - Serverless-friendly: no sockets. Clients poll with an `afterId` cursor
 *   over (conversation_id, id), so an idle poll is one indexed lookup.
 * - Delivery/read ticks are DERIVED from four per-conversation pointers,
 *   so marking messages read is a single-row UPDATE, never N rows.
 * - Image bytes live in their own table (bytea) so message lists never pull
 *   blobs; bytes are purged after the retention window, metadata remains.
 * - Messages are immutable. Staff may only HIDE a violating message (manager),
 *   the original stays in the table for audit.
 */
import {
  jsonb,
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import { portalCustomersTable } from "./portal-customers";
import { systemUsersTable } from "./settings";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const chatConversationsTable = pgTable(
  "chat_conversations",
  {
    id: serial("id").primaryKey(),
    portalCustomerId: integer("portal_customer_id")
      .notNull()
      .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
    // Denormalized so the staff inbox renders without joins (same pattern as
    // portal_price_inquiries).
    customerName: text("customer_name").notNull(),
    customerCompany: text("customer_company"),

    // Explicit override set by claim/transfer. Effective handler is
    // COALESCE(handler_user_id, portal_customers.assigned_sales_user_id).
    handlerUserId: integer("handler_user_id").references(
      () => systemUsersTable.id,
      { onDelete: "set null" },
    ),

    status: text("status").notNull().default("open"), // open | closed
    topic: text("topic"), // price | order | product | complaint | other

    lastMessageId: integer("last_message_id").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastMessagePreview: text("last_message_preview").notNull().default(""),
    lastSenderType: text("last_sender_type"), // customer | staff | system

    customerUnread: integer("customer_unread").notNull().default(0),
    staffUnread: integer("staff_unread").notNull().default(0),

    // Pointers for derived delivery/read ticks.
    customerLastDeliveredId: integer("customer_last_delivered_id")
      .notNull()
      .default(0),
    customerLastReadId: integer("customer_last_read_id").notNull().default(0),
    staffLastDeliveredId: integer("staff_last_delivered_id")
      .notNull()
      .default(0),
    staffLastReadId: integer("staff_last_read_id").notNull().default(0),

    customerLastSeenAt: timestamp("customer_last_seen_at", {
      withTimezone: true,
    }),

    // SLA / escalation
    awaitingStaffSince: timestamp("awaiting_staff_since", {
      withTimezone: true,
    }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),

    lastAutoReplyAt: timestamp("last_auto_reply_at", { withTimezone: true }),
    // SMS throttle (cost control)
    lastSmsAt: timestamp("last_sms_at", { withTimezone: true }),

    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    customerUnique: uniqueIndex("chat_conversations_customer_unique").on(
      table.portalCustomerId,
    ),
    handlerIdx: index("chat_conversations_handler_idx").on(
      table.handlerUserId,
      table.lastMessageAt,
    ),
    statusIdx: index("chat_conversations_status_idx").on(
      table.status,
      table.lastMessageAt,
    ),
    awaitingIdx: index("chat_conversations_awaiting_idx").on(
      table.awaitingStaffSince,
    ),
  }),
);

export const chatMessagesTable = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => chatConversationsTable.id, { onDelete: "cascade" }),
    // customer | staff | system
    senderType: text("sender_type").notNull(),
    senderUserId: integer("sender_user_id"),
    senderName: text("sender_name"),
    // text | image | system
    kind: text("kind").notNull().default("text"),
    // system events: closed | reopened | claimed | transferred | escalated | auto_reply
    event: text("event"),
    body: text("body").notNull().default(""),
    // Staff-only note, NEVER returned by customer endpoints.
    isInternal: boolean("is_internal").notNull().default(false),

    topic: text("topic"),
    contextType: text("context_type"), // order | product | price_inquiry
    contextId: integer("context_id"),
    contextLabel: text("context_label"),

    // Client-generated UUID → retries / double taps are idempotent.
    clientMsgId: text("client_msg_id"),

    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenByUserId: integer("hidden_by_user_id"),
    hiddenReason: text("hidden_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    convIdIdx: index("chat_messages_conv_id_idx").on(
      table.conversationId,
      table.id,
    ),
    clientMsgUnique: uniqueIndex("chat_messages_client_msg_unique").on(
      table.conversationId,
      table.senderType,
      table.clientMsgId,
    ),
  }),
);

export const chatAttachmentsTable = pgTable(
  "chat_attachments",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => chatMessagesTable.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => chatConversationsTable.id, { onDelete: "cascade" }),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data"), // null after purge
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    messageIdx: index("chat_attachments_message_idx").on(table.messageId),
    expiryIdx: index("chat_attachments_expiry_idx").on(table.expiresAt),
  }),
);

export const chatRatingsTable = pgTable(
  "chat_ratings",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => chatConversationsTable.id, { onDelete: "cascade" }),
    // The system "closed" message this rating answers → one rating per closure.
    closureMessageId: integer("closure_message_id")
      .notNull()
      .references(() => chatMessagesTable.id, { onDelete: "cascade" }),
    stars: integer("stars").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    closureUnique: uniqueIndex("chat_ratings_closure_unique").on(
      table.closureMessageId,
    ),
  }),
);

export const chatQuickRepliesTable = pgTable("chat_quick_replies", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** تجاوز صلاحية الشات لكل موظف — يحدده مدير المبيعات/الرئيس. */
export const chatStaffAccessTable = pgTable("chat_staff_access", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => systemUsersTable.id, { onDelete: "cascade" }),
  // manager | agent | observer | none
  mode: text("mode").notNull(),
  updatedByUserId: integer("updated_by_user_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** إعدادات الشات (صف واحد id=1) — يحررها المدير من الواجهة. */
export const chatSettingsTable = pgTable("chat_settings", {
  id: integer("id").primaryKey().default(1),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  updatedByUserId: integer("updated_by_user_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** اشتراكات Web Push (مجانية) للعميل والموظف. */
export const chatPushSubscriptionsTable = pgTable(
  "chat_push_subscriptions",
  {
    id: serial("id").primaryKey(),
    audience: text("audience").notNull(), // customer | staff
    portalCustomerId: integer("portal_customer_id").references(
      () => portalCustomersTable.id,
      { onDelete: "cascade" },
    ),
    userId: integer("user_id").references(() => systemUsersTable.id, {
      onDelete: "cascade",
    }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    endpointUnique: uniqueIndex("chat_push_endpoint_unique").on(t.endpoint),
    customerIdx: index("chat_push_customer_idx").on(t.portalCustomerId),
    userIdx: index("chat_push_user_idx").on(t.userId),
  }),
);

export type ChatConversation = typeof chatConversationsTable.$inferSelect;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
