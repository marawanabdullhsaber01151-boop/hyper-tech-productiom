-- 0087 — المهام البشرية بموعد وتصعيد + محرك الـsaga — الخطوة 30
--
-- human_tasks: مهمة لشخص أو دور (اتصل بالعميل، راجع الطلب...) بموعد نهائي. لو الموعد عدّى ولسه ما اتنفذتش
--   بتتصعّد لوحدها: مستوى 1 عند الموعد (تنبيه صاحب المهمة ومديره + رفع الأولوية)، مستوى 2 بعد 24 ساعة (الإدارة العليا).
-- human_task_events: سجل إضافة فقط لكل ما حصل في المهمة (للتتبع: مين عمل إيه ومتى ولماذا).
-- saga_instances: عملية طويلة من خطوات (ممكن تستنى مهمة بشرية) بحالة محفوظة تكمّل منها بعد أي انقطاع.
-- ما بيلمسش أي بيانات موجودة.
--
-- Rollback:
--   DROP TABLE IF EXISTS saga_instances;
--   DROP TABLE IF EXISTS human_task_events;
--   DROP TABLE IF EXISTS human_tasks;

CREATE TABLE IF NOT EXISTS "human_tasks" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL DEFAULT 'general',
  "title" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'in_progress', 'done', 'cancelled')),
  "priority" text NOT NULL DEFAULT 'normal' CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
  "assignee_user_id" integer,
  "assignee_role" text,
  "escalate_to_role" text NOT NULL DEFAULT 'executive_manager',
  "due_at" timestamptz,
  "escalation_level" integer NOT NULL DEFAULT 0,
  "next_escalation_at" timestamptz,
  "source_type" text,
  "source_id" integer,
  "dedupe_key" text,
  "created_by" integer,
  "claimed_by" integer,
  "completed_by" integer,
  "completed_at" timestamptz,
  "result_note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "human_tasks_assignee_chk" CHECK ("assignee_user_id" IS NOT NULL OR "assignee_role" IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "human_tasks_dedupe_unique" ON "human_tasks" ("dedupe_key") WHERE "dedupe_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "human_tasks_escalation_idx" ON "human_tasks" ("next_escalation_at") WHERE "status" IN ('open', 'in_progress') AND "next_escalation_at" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "human_tasks_assignee_idx" ON "human_tasks" ("assignee_user_id", "status");
CREATE INDEX IF NOT EXISTS "human_tasks_role_idx" ON "human_tasks" ("assignee_role", "status");
CREATE INDEX IF NOT EXISTS "human_tasks_source_idx" ON "human_tasks" ("source_type", "source_id");

CREATE TABLE IF NOT EXISTS "human_task_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "task_id" bigint NOT NULL REFERENCES "human_tasks"("id"),
  "event" text NOT NULL,
  "actor_user_id" integer,
  "detail" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "human_task_events_task_idx" ON "human_task_events" ("task_id", "id");

CREATE TABLE IF NOT EXISTS "saga_instances" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "saga_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running' CHECK ("status" IN ('running', 'waiting', 'completed', 'compensating', 'compensated', 'failed')),
  "step_index" integer NOT NULL DEFAULT 0,
  "state" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "subject_type" text,
  "subject_id" integer,
  "dedupe_key" text,
  "waiting_task_id" bigint,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "next_run_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "saga_instances_dedupe_unique" ON "saga_instances" ("dedupe_key") WHERE "dedupe_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "saga_instances_due_idx" ON "saga_instances" ("next_run_at") WHERE "status" IN ('running', 'waiting', 'compensating');
