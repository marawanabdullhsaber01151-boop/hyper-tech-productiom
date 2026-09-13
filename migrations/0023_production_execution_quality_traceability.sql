INSERT INTO "phase0_number_sequences" ("sequence_key", "prefix", "next_value", "padding")
VALUES ('production_ncr', 'NCR-', 1, 6)
ON CONFLICT ("sequence_key") DO NOTHING;

CREATE TABLE IF NOT EXISTS "production_downtimes" (
  "id" serial PRIMARY KEY NOT NULL,
  "batch_id" integer NOT NULL REFERENCES "production_batches"("id"),
  "workflow_order_id" integer NOT NULL REFERENCES "production_workflow_orders"("id"),
  "reason_code" text NOT NULL,
  "minutes" integer NOT NULL,
  "notes" text,
  "started_at" timestamptz,
  "ended_at" timestamptz,
  "recorded_by" integer NOT NULL REFERENCES "system_users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "production_downtimes_batch_idx" ON "production_downtimes" ("batch_id","created_at");
CREATE INDEX IF NOT EXISTS "production_downtimes_reason_idx" ON "production_downtimes" ("reason_code");

CREATE TABLE IF NOT EXISTS "production_operation_confirmations" (
  "id" serial PRIMARY KEY NOT NULL,
  "batch_id" integer NOT NULL REFERENCES "production_batches"("id"),
  "workflow_order_id" integer NOT NULL REFERENCES "production_workflow_orders"("id"),
  "operation_no" integer NOT NULL,
  "machine_id" integer,
  "shift_code" text,
  "good_qty" text NOT NULL,
  "scrap_qty" text DEFAULT '0' NOT NULL,
  "rework_qty" text DEFAULT '0' NOT NULL,
  "notes" text,
  "recorded_by" integer NOT NULL REFERENCES "system_users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "production_operation_confirmations_batch_idx" ON "production_operation_confirmations" ("batch_id","operation_no");

CREATE TABLE IF NOT EXISTS "production_ncrs" (
  "id" serial PRIMARY KEY NOT NULL,
  "ncr_number" text NOT NULL UNIQUE,
  "batch_id" integer REFERENCES "production_batches"("id"),
  "workflow_order_id" integer NOT NULL REFERENCES "production_workflow_orders"("id"),
  "defect_code" text NOT NULL,
  "affected_qty" text NOT NULL,
  "disposition" text,
  "root_cause" text,
  "corrective_action" text,
  "status" text DEFAULT 'open' NOT NULL,
  "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by" integer NOT NULL REFERENCES "system_users"("id"),
  "closed_by" integer REFERENCES "system_users"("id"),
  "closed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "production_ncrs_queue_idx" ON "production_ncrs" ("status","created_at");
CREATE INDEX IF NOT EXISTS "production_ncrs_batch_idx" ON "production_ncrs" ("batch_id");

CREATE TABLE IF NOT EXISTS "production_traceability" (
  "id" serial PRIMARY KEY NOT NULL,
  "batch_id" integer NOT NULL REFERENCES "production_batches"("id"),
  "workflow_order_id" integer NOT NULL REFERENCES "production_workflow_orders"("id"),
  "trace_type" text NOT NULL,
  "lot_number" text NOT NULL,
  "item_code" text,
  "quantity" text,
  "reference_type" text,
  "reference_id" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "recorded_by" integer NOT NULL REFERENCES "system_users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "production_traceability_lot_idx" ON "production_traceability" ("lot_number");
CREATE INDEX IF NOT EXISTS "production_traceability_batch_idx" ON "production_traceability" ("batch_id");