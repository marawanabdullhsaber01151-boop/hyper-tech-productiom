-- Plan 06: طلبات الانضمام v2 — مراحل، مراجع، اكتمال، ملاحظات، أحداث (expand-only).
ALTER TABLE "portal_applications"
  ADD COLUMN IF NOT EXISTS "stage" text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS "assigned_reviewer_id" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "completeness" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "internal_notes" text,
  ADD COLUMN IF NOT EXISTS "duplicate_company_id" integer,
  ADD COLUMN IF NOT EXISTS "duplicate_contact_id" integer,
  ADD COLUMN IF NOT EXISTS "decision" text,
  ADD COLUMN IF NOT EXISTS "approved_company_id" integer,
  ADD COLUMN IF NOT EXISTS "customer_response_at" timestamptz;

UPDATE "portal_applications" SET "stage" = CASE "status"
  WHEN 'needs_info' THEN 'needs_info'
  WHEN 'approved' THEN 'approved'
  WHEN 'rejected' THEN 'rejected'
  ELSE 'new' END
WHERE "stage" = 'new' AND "status" <> 'pending';

UPDATE "portal_applications" SET "completeness" = LEAST(100,
    (CASE WHEN length(trim(coalesce("full_name",''))) > 1 THEN 15 ELSE 0 END)
  + (CASE WHEN length(trim(coalesce("company_name",''))) > 1 THEN 15 ELSE 0 END)
  + (CASE WHEN length(trim(coalesce("phone",''))) > 7 THEN 15 ELSE 0 END)
  + (CASE WHEN length(trim(coalesce("address",''))) > 3 THEN 10 ELSE 0 END)
  + (CASE WHEN coalesce("city",'') <> '' THEN 10 ELSE 0 END)
  + (CASE WHEN coalesce("email",'') <> '' THEN 10 ELSE 0 END)
  + (CASE WHEN coalesce("commercial_register_no",'') <> '' THEN 10 ELSE 0 END)
  + (CASE WHEN coalesce("tax_id",'') <> '' THEN 10 ELSE 0 END)
  + (CASE WHEN coalesce("expected_monthly_volume",'') <> '' THEN 5 ELSE 0 END));

ALTER TABLE "portal_applications" DROP CONSTRAINT IF EXISTS "portal_applications_stage_check";
ALTER TABLE "portal_applications" ADD CONSTRAINT "portal_applications_stage_check"
  CHECK ("stage" IN ('new','needs_info','ready','approved','rejected','duplicate_auto_closed'));

CREATE INDEX IF NOT EXISTS "portal_applications_stage_created_idx" ON "portal_applications" ("stage", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "portal_applications_norm_phone_idx" ON "portal_applications" ("normalized_phone");

CREATE TABLE IF NOT EXISTS "portal_application_events" (
  "id" bigserial PRIMARY KEY,
  "application_id" integer NOT NULL REFERENCES "portal_applications"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "stage_from" text,
  "stage_to" text,
  "actor_user_id" integer,
  "actor_label" text NOT NULL,
  "note" text,
  "data" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "portal_application_events_app_idx" ON "portal_application_events" ("application_id", "id" DESC);

-- تعبئة normalized_phone للطلبات القديمة (نفس منطق normalizePhone للأرقام المصرية).
UPDATE "portal_applications" SET "normalized_phone" = CASE
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^0\d{10}$' THEN '+20' || substr(regexp_replace("phone", '\D', '', 'g'), 2)
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^20\d{10}$' THEN '+' || regexp_replace("phone", '\D', '', 'g')
    ELSE regexp_replace("phone", '\D', '', 'g') END
WHERE "normalized_phone" IS NULL;
