-- Phase 6 (Governance & Portal project) — "اطلب سعر" (ask-before-you-order).
-- See src/db/schema/portal-price-inquiries.ts for the performance rationale
-- (denormalized customer/product fields, snapshotted price, composite
-- indexes matching existing patterns in this codebase).

CREATE TABLE IF NOT EXISTS "portal_price_inquiries" (
  "id" serial PRIMARY KEY NOT NULL,
  "portal_customer_id" integer NOT NULL REFERENCES "portal_customers"("id") ON DELETE CASCADE,
  "bom_recipe_id" integer NOT NULL REFERENCES "bom_recipes"("id"),
  "product_name" text NOT NULL,
  "customer_name" text NOT NULL,
  "customer_company" text,
  "customer_phone" text NOT NULL,
  "requested_qty" numeric(12, 3) NOT NULL,
  "requested_unit" text DEFAULT 'piece' NOT NULL,
  "suggested_price" numeric(12, 2),
  "final_price" numeric(12, 2),
  "status" text DEFAULT 'pending' NOT NULL,
  "answered_by_user_id" integer,
  "answered_by_name" text,
  "answered_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_price_inquiries_status_created_idx"
  ON "portal_price_inquiries" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_price_inquiries_customer_created_idx"
  ON "portal_price_inquiries" ("portal_customer_id", "created_at");
