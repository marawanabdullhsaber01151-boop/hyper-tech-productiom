-- Phase 7 (Governance & Portal project) — assign a responsible salesperson
-- to a portal customer. Used by the combined sales workspace (this phase)
-- and by direct customer↔salesperson chat routing (Phase 9). Additive and
-- fully optional — a customer with no assignment is simply handled by
-- whichever sales staff member picks up their order/inquiry, unchanged.

ALTER TABLE "portal_customers"
  ADD COLUMN IF NOT EXISTS "assigned_sales_user_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_customers_assigned_sales_idx"
  ON "portal_customers" ("assigned_sales_user_id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_customers_assigned_sales_fk') THEN
    ALTER TABLE "portal_customers"
      ADD CONSTRAINT "portal_customers_assigned_sales_fk"
      FOREIGN KEY ("assigned_sales_user_id") REFERENCES "system_users"("id")
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "portal_customers" VALIDATE CONSTRAINT "portal_customers_assigned_sales_fk";
