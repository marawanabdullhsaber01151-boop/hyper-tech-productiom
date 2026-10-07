-- Plan 00 (hotfix): track real activation + force password change after a manual reset.
-- Expand-only and idempotent.
ALTER TABLE "portal_customers"
  ADD COLUMN IF NOT EXISTS "activated_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Backfill: an account counts as activated unless it was created through the
-- admin approval flow (has activation tokens) and never used any of them nor
-- ever logged in. Accounts without any token were self-registered, so the
-- owner already knew the password.
UPDATE "portal_customers" c
SET "activated_at" = c."created_at"
WHERE c."activated_at" IS NULL
  AND (
    NOT EXISTS (SELECT 1 FROM "portal_activation_tokens" t WHERE t."portal_customer_id" = c."id")
    OR EXISTS (SELECT 1 FROM "portal_activation_tokens" t WHERE t."portal_customer_id" = c."id" AND t."consumed_at" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "portal_sessions" s WHERE s."portal_customer_id" = c."id")
  );
