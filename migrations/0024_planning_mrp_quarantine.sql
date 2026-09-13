ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "quarantine_qty" numeric(12,3) DEFAULT '0' NOT NULL;

INSERT INTO "phase0_number_sequences" ("sequence_key", "prefix", "next_value", "padding")
VALUES
  ('production_plan', 'PLAN-', 1, 6),
  ('purchase_requisition', 'PR-', 1, 6)
ON CONFLICT ("sequence_key") DO NOTHING;

CREATE TABLE IF NOT EXISTS "production_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "plan_number" text NOT NULL UNIQUE,
  "status" text DEFAULT 'draft' NOT NULL,
  "demand_source" text DEFAULT 'manual' NOT NULL,
  "due_date" date,
  "assumptions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" integer NOT NULL REFERENCES "system_users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "material_requirements" (
  "id" serial PRIMARY KEY NOT NULL,
  "plan_id" integer NOT NULL REFERENCES "production_plans"("id") ON DELETE CASCADE,
  "inventory_item_id" integer NOT NULL REFERENCES "inventory_items"("id"),
  "workflow_order_id" integer REFERENCES "production_workflow_orders"("id"),
  "gross_qty" numeric(14,3) NOT NULL,
  "available_qty" numeric(14,3) NOT NULL,
  "net_qty" numeric(14,3) NOT NULL,
  "required_by" date,
  "status" text DEFAULT 'planned' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "material_requirements_plan_idx" ON "material_requirements" ("plan_id","status");
CREATE INDEX IF NOT EXISTS "material_requirements_item_idx" ON "material_requirements" ("inventory_item_id");
CREATE TABLE IF NOT EXISTS "planning_purchase_requisitions" (
  "id" serial PRIMARY KEY NOT NULL,
  "requisition_number" text NOT NULL UNIQUE,
  "plan_id" integer NOT NULL REFERENCES "production_plans"("id"),
  "material_requirement_id" integer NOT NULL REFERENCES "material_requirements"("id"),
  "inventory_item_id" integer NOT NULL REFERENCES "inventory_items"("id"),
  "requested_qty" numeric(14,3) NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_by" integer NOT NULL REFERENCES "system_users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);