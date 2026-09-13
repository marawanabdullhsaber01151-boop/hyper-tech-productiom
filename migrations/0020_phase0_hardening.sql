CREATE TABLE IF NOT EXISTS "phase0_number_sequences" (
  "id" serial PRIMARY KEY NOT NULL,
  "sequence_key" text NOT NULL,
  "prefix" text NOT NULL,
  "next_value" integer DEFAULT 1 NOT NULL,
  "padding" integer DEFAULT 6 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "phase0_number_sequences_key_unique"
  ON "phase0_number_sequences" ("sequence_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phase0_number_sequences_active_idx"
  ON "phase0_number_sequences" ("active");
--> statement-breakpoint
INSERT INTO "phase0_number_sequences" ("sequence_key", "prefix", "next_value", "padding")
VALUES
  ('production_order', 'PO-', 1, 6),
  ('production_batch', 'B-', 1, 6),
  ('production_operation', 'OP-', 1, 6)
ON CONFLICT ("sequence_key") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "foundation_state_transitions" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity_type" text NOT NULL,
  "from_state" text NOT NULL,
  "to_state" text NOT NULL,
  "required_role" text NOT NULL,
  "requires_reason" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "foundation_state_transitions_unique"
  ON "foundation_state_transitions" ("entity_type", "from_state", "to_state", "required_role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "foundation_state_transitions_entity_idx"
  ON "foundation_state_transitions" ("entity_type");
--> statement-breakpoint
INSERT INTO "foundation_state_transitions"
  ("entity_type", "from_state", "to_state", "required_role", "requires_reason")
VALUES
  ('production_order', 'new', 'pending_supervisor', 'production_manager', false),
  ('production_order', 'pending_supervisor', 'materials_requested', 'supervisor', false),
  ('production_order', 'materials_requested', 'materials_approved', 'warehouse_manager', false),
  ('production_order', 'materials_requested', 'materials_partial', 'warehouse_manager', true),
  ('production_order', 'materials_requested', 'materials_rejected', 'warehouse_manager', true),
  ('production_order', 'materials_approved', 'in_production', 'supervisor', false),
  ('production_order', 'in_production', 'quality_check', 'quality_controller', false),
  ('production_order', 'quality_check', 'completed', 'quality_controller', false),
  ('production_order', 'completed', 'delivered_customer', 'production_manager', false),
  ('production_order', 'completed', 'delivered_warehouse', 'production_manager', false),
  ('production_order', 'new', 'cancelled', 'manager', true),
  ('production_order', 'pending_supervisor', 'cancelled', 'manager', true)
ON CONFLICT ("entity_type", "from_state", "to_state", "required_role") DO NOTHING;
--> statement-breakpoint
UPDATE "stock_movements"
SET "reference_type" = 'adjustment',
    "reference_id" = "id"
WHERE "reference_type" IS NULL OR "reference_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "stock_movements"
  ALTER COLUMN "reference_type" SET NOT NULL,
  ALTER COLUMN "reference_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_reference_pair_check"
  CHECK ("reference_type" IS NOT NULL AND "reference_id" IS NOT NULL);