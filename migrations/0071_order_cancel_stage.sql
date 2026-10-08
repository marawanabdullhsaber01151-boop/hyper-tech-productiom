-- Plan 02: remember the stage an order was in when it was cancelled, so a late
-- cancel (after production started) can be handled by a later policy without
-- losing information. Expand-only, idempotent.
ALTER TABLE "production_workflow_orders"
  ADD COLUMN IF NOT EXISTS "cancel_stage" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pwo_portal_submitter_idx"
  ON "production_workflow_orders" ("portal_customer_id", "submitted_by_member_id");
