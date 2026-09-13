-- Foundation is the master definition; inventory remains the operational balance.
-- This migration also creates the Foundation tables because older installations
-- may have applied the TypeScript schema without a matching SQL migration.
CREATE TABLE IF NOT EXISTS "foundation_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "item_type" text DEFAULT 'raw_material' NOT NULL,
  "base_unit" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "lot_tracked" boolean DEFAULT true NOT NULL,
  "serial_tracked" boolean DEFAULT false NOT NULL,
  "shelf_life_days" integer,
  "min_stock" text DEFAULT '0' NOT NULL,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "foundation_items_code_unique" ON "foundation_items" ("code");
CREATE INDEX IF NOT EXISTS "foundation_items_type_idx" ON "foundation_items" ("item_type");
CREATE INDEX IF NOT EXISTS "foundation_items_active_idx" ON "foundation_items" ("active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "foundation_unit_conversions" (
  "id" serial PRIMARY KEY NOT NULL,
  "item_id" integer NOT NULL REFERENCES "foundation_items"("id") ON DELETE CASCADE,
  "from_unit" text NOT NULL,
  "to_unit" text NOT NULL,
  "factor" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "foundation_unit_conversions_item_idx" ON "foundation_unit_conversions" ("item_id");
CREATE UNIQUE INDEX IF NOT EXISTS "foundation_unit_conversions_pair_unique" ON "foundation_unit_conversions" ("item_id","from_unit","to_unit");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "foundation_locations" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "location_type" text DEFAULT 'warehouse' NOT NULL,
  "parent_id" integer,
  "active" boolean DEFAULT true NOT NULL,
  "allows_inventory" boolean DEFAULT true NOT NULL,
  "allows_production" boolean DEFAULT false NOT NULL,
  "requires_quarantine" boolean DEFAULT false NOT NULL,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "foundation_locations_code_unique" ON "foundation_locations" ("code");
CREATE INDEX IF NOT EXISTS "foundation_locations_parent_idx" ON "foundation_locations" ("parent_id");
CREATE INDEX IF NOT EXISTS "foundation_locations_type_idx" ON "foundation_locations" ("location_type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "foundation_work_centers" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "center_type" text DEFAULT 'production_line' NOT NULL,
  "location_id" integer REFERENCES "foundation_locations"("id"),
  "capacity_minutes_per_shift" integer DEFAULT 480 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "foundation_work_centers_code_unique" ON "foundation_work_centers" ("code");
CREATE INDEX IF NOT EXISTS "foundation_work_centers_location_idx" ON "foundation_work_centers" ("location_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "foundation_machines" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "work_center_id" integer NOT NULL REFERENCES "foundation_work_centers"("id"),
  "status" text DEFAULT 'available' NOT NULL,
  "serial_number" text,
  "calibration_due_date" date,
  "maintenance_due_date" date,
  "active" boolean DEFAULT true NOT NULL,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "foundation_machines_code_unique" ON "foundation_machines" ("code");
CREATE INDEX IF NOT EXISTS "foundation_machines_center_idx" ON "foundation_machines" ("work_center_id");
CREATE INDEX IF NOT EXISTS "foundation_machines_status_idx" ON "foundation_machines" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "foundation_shifts" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "break_minutes" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "foundation_shifts_code_unique" ON "foundation_shifts" ("code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "foundation_audit" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" integer,
  "action" text NOT NULL,
  "actor_id" text,
  "actor_role" text,
  "reason" text,
  "before_data" jsonb,
  "after_data" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "foundation_audit_entity_idx" ON "foundation_audit" ("entity_type","entity_id");
CREATE INDEX IF NOT EXISTS "foundation_audit_created_idx" ON "foundation_audit" ("created_at");
--> statement-breakpoint
-- Nullable by design so existing inventory rows stay readable during migration.
ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "foundation_item_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_foundation_item_idx"
  ON "inventory_items" ("foundation_item_id");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_items_foundation_item_fk'
  ) THEN
    ALTER TABLE "inventory_items"
      ADD CONSTRAINT "inventory_items_foundation_item_fk"
      FOREIGN KEY ("foundation_item_id") REFERENCES "foundation_items"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
-- Conservative backfill: only exact code matches are linked; ambiguous or missing
-- codes remain NULL and are reported for manual review.
UPDATE "inventory_items" i
SET "foundation_item_id" = f."id"
FROM "foundation_items" f
WHERE i."foundation_item_id" IS NULL
  AND i."code" IS NOT NULL
  AND i."code" = f."code";