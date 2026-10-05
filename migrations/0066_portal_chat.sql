-- Portal chat (customer <-> sales). See src/db/schema/portal-chat.ts and
-- docs/chat/DESIGN.md. Idempotent (IF NOT EXISTS) like the other migrations.

CREATE TABLE IF NOT EXISTS "chat_conversations" (
  "id" serial PRIMARY KEY NOT NULL,
  "portal_customer_id" integer NOT NULL REFERENCES "portal_customers"("id") ON DELETE CASCADE,
  "customer_name" text NOT NULL,
  "customer_company" text,
  "handler_user_id" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "topic" text,
  "last_message_id" integer DEFAULT 0 NOT NULL,
  "last_message_at" timestamptz DEFAULT now() NOT NULL,
  "last_message_preview" text DEFAULT '' NOT NULL,
  "last_sender_type" text,
  "customer_unread" integer DEFAULT 0 NOT NULL,
  "staff_unread" integer DEFAULT 0 NOT NULL,
  "customer_last_delivered_id" integer DEFAULT 0 NOT NULL,
  "customer_last_read_id" integer DEFAULT 0 NOT NULL,
  "staff_last_delivered_id" integer DEFAULT 0 NOT NULL,
  "staff_last_read_id" integer DEFAULT 0 NOT NULL,
  "customer_last_seen_at" timestamptz,
  "awaiting_staff_since" timestamptz,
  "escalated_at" timestamptz,
  "last_auto_reply_at" timestamptz,
  "last_sms_at" timestamptz,
  "closed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "chat_conversations_status_check" CHECK ("status" IN ('open','closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversations_customer_unique"
  ON "chat_conversations" ("portal_customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_conversations_handler_idx"
  ON "chat_conversations" ("handler_user_id", "last_message_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_conversations_status_idx"
  ON "chat_conversations" ("status", "last_message_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_conversations_awaiting_idx"
  ON "chat_conversations" ("awaiting_staff_since")
  WHERE "awaiting_staff_since" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "conversation_id" integer NOT NULL REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
  "sender_type" text NOT NULL,
  "sender_user_id" integer,
  "sender_name" text,
  "kind" text DEFAULT 'text' NOT NULL,
  "event" text,
  "body" text DEFAULT '' NOT NULL,
  "is_internal" boolean DEFAULT false NOT NULL,
  "topic" text,
  "context_type" text,
  "context_id" integer,
  "context_label" text,
  "client_msg_id" text,
  "hidden_at" timestamptz,
  "hidden_by_user_id" integer,
  "hidden_reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "chat_messages_sender_check" CHECK ("sender_type" IN ('customer','staff','system')),
  CONSTRAINT "chat_messages_kind_check" CHECK ("kind" IN ('text','image','system')),
  CONSTRAINT "chat_messages_body_len_check" CHECK (char_length("body") <= 2000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_conv_id_idx"
  ON "chat_messages" ("conversation_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_messages_client_msg_unique"
  ON "chat_messages" ("conversation_id", "sender_type", "client_msg_id")
  WHERE "client_msg_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "chat_attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "message_id" integer NOT NULL REFERENCES "chat_messages"("id") ON DELETE CASCADE,
  "conversation_id" integer NOT NULL REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
  "mime" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "data" bytea,
  "expires_at" timestamptz NOT NULL,
  "purged_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_attachments_message_idx"
  ON "chat_attachments" ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_attachments_expiry_idx"
  ON "chat_attachments" ("expires_at")
  WHERE "purged_at" IS NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "chat_ratings" (
  "id" serial PRIMARY KEY NOT NULL,
  "conversation_id" integer NOT NULL REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
  "closure_message_id" integer NOT NULL REFERENCES "chat_messages"("id") ON DELETE CASCADE,
  "stars" integer NOT NULL,
  "comment" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "chat_ratings_stars_check" CHECK ("stars" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_ratings_closure_unique"
  ON "chat_ratings" ("closure_message_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "chat_quick_replies" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "chat_quick_replies" ("title", "body")
SELECT * FROM (VALUES
  ('ترحيب', 'أهلًا بحضرتك في هايبر تك، أنا معاك وتحت أمرك. تحب أساعدك في إيه؟'),
  ('جاري المراجعة', 'تمام، هراجع الموضوع وأرجعلك في أقرب وقت.'),
  ('طلب تفاصيل', 'ممكن توضّح لي الكمية المطلوبة وموعد التسليم المناسب لحضرتك؟'),
  ('شكرًا', 'شكرًا لتواصلك معانا، لو احتجت أي حاجة تانية أنا موجود.')
) AS seed("title", "body")
WHERE NOT EXISTS (SELECT 1 FROM "chat_quick_replies");
