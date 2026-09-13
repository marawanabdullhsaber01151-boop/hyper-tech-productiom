CREATE TABLE IF NOT EXISTS "engineering_products" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "product_type" text DEFAULT 'finished' NOT NULL,
  "base_unit" text DEFAULT 'وحدة' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "description" text,
  "created_by" integer REFERENCES "system_users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "engineering_products_code_unique" ON "engineering_products" ("code");
CREATE INDEX IF NOT EXISTS "engineering_products_status_idx" ON "engineering_products" ("status");

CREATE TABLE IF NOT EXISTS "engineering_product_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "product_id" integer NOT NULL REFERENCES "engineering_products"("id") ON DELETE CASCADE,
  "version" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "effective_from" date,
  "effective_to" date,
  "bom_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "routing_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "specifications" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "change_reason" text,
  "approved_by" integer REFERENCES "system_users"("id"),
  "approved_at" timestamptz,
  "created_by" integer REFERENCES "system_users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "engineering_product_versions_unique" ON "engineering_product_versions" ("product_id","version");
CREATE INDEX IF NOT EXISTS "engineering_product_versions_status_idx" ON "engineering_product_versions" ("product_id","status");

CREATE TABLE IF NOT EXISTS "engineering_routings" (
  "id" serial PRIMARY KEY NOT NULL,
  "product_version_id" integer NOT NULL REFERENCES "engineering_product_versions"("id") ON DELETE CASCADE,
  "operation_no" integer NOT NULL,
  "name" text NOT NULL,
  "work_center_id" integer,
  "machine_id" integer,
  "setup_minutes" integer DEFAULT 0 NOT NULL,
  "run_minutes_per_unit" numeric(12,4) DEFAULT '0' NOT NULL,
  "workers_required" integer DEFAULT 1 NOT NULL,
  "quality_point" boolean DEFAULT false NOT NULL,
  "safety_instructions" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "engineering_routings_operation_unique" ON "engineering_routings" ("product_version_id","operation_no");
CREATE INDEX IF NOT EXISTS "engineering_routings_version_idx" ON "engineering_routings" ("product_version_id");

CREATE TABLE IF NOT EXISTS "engineering_change_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "product_id" integer NOT NULL REFERENCES "engineering_products"("id"),
  "product_version_id" integer REFERENCES "engineering_product_versions"("id"),
  "request_number" text NOT NULL UNIQUE,
  "title" text NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "impact_summary" text,
  "requested_by" integer REFERENCES "system_users"("id"),
  "decided_by" integer REFERENCES "system_users"("id"),
  "decided_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "engineering_change_requests_product_idx" ON "engineering_change_requests" ("product_id","status");