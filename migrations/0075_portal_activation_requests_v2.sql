-- Plan 07: طلبات التفعيل v2 — مراجع مسؤول، ملاحظات، تكرار الطلب، وجدول أحداث (إضافة فقط).
ALTER TABLE "portal_activation_requests"
  ADD COLUMN IF NOT EXISTS "assigned_reviewer_id" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "internal_notes" text,
  ADD COLUMN IF NOT EXISTS "request_count" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "last_requested_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "close_reason" text;

UPDATE "portal_activation_requests" SET "last_requested_at" = "created_at";

UPDATE "portal_activation_requests" SET "normalized_phone" = CASE
    WHEN regexp_replace("phone_entered", '\D', '', 'g') ~ '^0\d{10}$' THEN '+20' || substr(regexp_replace("phone_entered", '\D', '', 'g'), 2)
    WHEN regexp_replace("phone_entered", '\D', '', 'g') ~ '^20\d{10}$' THEN '+' || regexp_replace("phone_entered", '\D', '', 'g')
    ELSE regexp_replace("phone_entered", '\D', '', 'g') END
WHERE "normalized_phone" IS NULL;

CREATE INDEX IF NOT EXISTS "portal_activation_requests_norm_phone_idx" ON "portal_activation_requests" ("normalized_phone");

CREATE TABLE IF NOT EXISTS "portal_activation_request_events" (
  "id" bigserial PRIMARY KEY,
  "request_id" integer NOT NULL REFERENCES "portal_activation_requests"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "actor_user_id" integer,
  "actor_label" text NOT NULL,
  "note" text,
  "data" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "portal_activation_request_events_req_idx" ON "portal_activation_request_events" ("request_id", "id" DESC);
