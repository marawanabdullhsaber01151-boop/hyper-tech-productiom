CREATE TABLE IF NOT EXISTS "planning_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "run_key" text NOT NULL UNIQUE,
  "scenario_code" text DEFAULT 'baseline' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "horizon_start" date NOT NULL,
  "horizon_end" date NOT NULL,
  "input_hash" text NOT NULL,
  "assumptions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" integer NOT NULL REFERENCES "system_users"("id"),
  "approved_by" integer REFERENCES "system_users"("id"),
  "approved_at" timestamptz,
  "released_by" integer REFERENCES "system_users"("id"),
  "released_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "planning_runs_status_idx" ON "planning_runs" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "planning_runs_scenario_idx" ON "planning_runs" ("scenario_code", "created_at");

CREATE TABLE IF NOT EXISTS "planning_run_inputs" (
  "id" serial PRIMARY KEY NOT NULL,
  "run_id" integer NOT NULL REFERENCES "planning_runs"("id") ON DELETE CASCADE,
  "source_type" text NOT NULL,
  "source_id" text,
  "inventory_item_id" integer REFERENCES "inventory_items"("id"),
  "gross_qty" numeric(14,3) NOT NULL,
  "required_by" date,
  "snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "planning_run_inputs_run_idx" ON "planning_run_inputs" ("run_id", "required_by");

CREATE TABLE IF NOT EXISTS "planning_capacity_loads" (
  "id" serial PRIMARY KEY NOT NULL,
  "run_id" integer NOT NULL REFERENCES "planning_runs"("id") ON DELETE CASCADE,
  "work_center_id" integer,
  "machine_id" integer,
  "shift_id" integer,
  "load_date" date NOT NULL,
  "required_minutes" integer DEFAULT 0 NOT NULL,
  "available_minutes" integer DEFAULT 0 NOT NULL,
  "overload_minutes" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'within_capacity' NOT NULL,
  "explanation" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "planning_capacity_loads_run_date_idx" ON "planning_capacity_loads" ("run_id", "load_date");

CREATE TABLE IF NOT EXISTS "planning_shortage_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "run_id" integer NOT NULL REFERENCES "planning_runs"("id") ON DELETE CASCADE,
  "material_requirement_id" integer REFERENCES "material_requirements"("id") ON DELETE CASCADE,
  "severity" text DEFAULT 'warning' NOT NULL,
  "code" text NOT NULL,
  "message" text NOT NULL,
  "explanation" text NOT NULL,
  "recommended_action" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "planning_shortage_messages_run_idx" ON "planning_shortage_messages" ("run_id", "severity");

CREATE TABLE IF NOT EXISTS "planning_pegging_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "run_id" integer NOT NULL REFERENCES "planning_runs"("id") ON DELETE CASCADE,
  "material_requirement_id" integer NOT NULL REFERENCES "material_requirements"("id") ON DELETE CASCADE,
  "demand_type" text NOT NULL,
  "demand_id" text,
  "pegged_qty" numeric(14,3) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "planning_pegging_links_run_idx" ON "planning_pegging_links" ("run_id", "material_requirement_id");

CREATE TABLE IF NOT EXISTS "planning_release_decisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "run_id" integer NOT NULL REFERENCES "planning_runs"("id") ON DELETE CASCADE,
  "decision" text NOT NULL,
  "decided_by" integer NOT NULL REFERENCES "system_users"("id"),
  "impact_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "planning_release_decisions_run_decision_unique" UNIQUE ("run_id", "decision")
);
