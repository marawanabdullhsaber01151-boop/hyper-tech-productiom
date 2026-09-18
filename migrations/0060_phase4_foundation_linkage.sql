-- Phase 4 (Governance & Portal project) — Foundation linkage audit.
--
-- Findings: several tables already store what are semantically Foundation
-- master-data ids (work centers, machines, shifts, finished-good products)
-- as bare integers with NO foreign key at all, so nothing prevented them
-- pointing at a row that doesn't exist or that was later deleted. This
-- migration closes those gaps.
--
-- Every constraint below is added as NOT VALID first, then validated
-- separately: NOT VALID means the constraint applies to new/changed rows
-- immediately but does not block the migration on pre-existing bad data,
-- and the VALIDATE step takes only a SHARE UPDATE EXCLUSIVE lock rather
-- than blocking writes. Any pre-existing row pointing at a missing record
-- is NULLed out first (and reported in the phase report) rather than
-- silently failing the deploy.

-- ── 1. engineering_routings → foundation_work_centers / foundation_machines ──
UPDATE "engineering_routings" r
SET "work_center_id" = NULL
WHERE r."work_center_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "foundation_work_centers" f WHERE f."id" = r."work_center_id");
--> statement-breakpoint
UPDATE "engineering_routings" r
SET "machine_id" = NULL
WHERE r."machine_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "foundation_machines" f WHERE f."id" = r."machine_id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engineering_routings_work_center_fk') THEN
    ALTER TABLE "engineering_routings"
      ADD CONSTRAINT "engineering_routings_work_center_fk"
      FOREIGN KEY ("work_center_id") REFERENCES "foundation_work_centers"("id")
      ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engineering_routings_machine_fk') THEN
    ALTER TABLE "engineering_routings"
      ADD CONSTRAINT "engineering_routings_machine_fk"
      FOREIGN KEY ("machine_id") REFERENCES "foundation_machines"("id")
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "engineering_routings" VALIDATE CONSTRAINT "engineering_routings_work_center_fk";
--> statement-breakpoint
ALTER TABLE "engineering_routings" VALIDATE CONSTRAINT "engineering_routings_machine_fk";
--> statement-breakpoint

-- ── 2. planning_capacity_loads → work centers / machines / shifts ──
UPDATE "planning_capacity_loads" p
SET "work_center_id" = NULL
WHERE p."work_center_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "foundation_work_centers" f WHERE f."id" = p."work_center_id");
--> statement-breakpoint
UPDATE "planning_capacity_loads" p
SET "machine_id" = NULL
WHERE p."machine_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "foundation_machines" f WHERE f."id" = p."machine_id");
--> statement-breakpoint
UPDATE "planning_capacity_loads" p
SET "shift_id" = NULL
WHERE p."shift_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "foundation_shifts" f WHERE f."id" = p."shift_id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'planning_capacity_loads_work_center_fk') THEN
    ALTER TABLE "planning_capacity_loads"
      ADD CONSTRAINT "planning_capacity_loads_work_center_fk"
      FOREIGN KEY ("work_center_id") REFERENCES "foundation_work_centers"("id")
      ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'planning_capacity_loads_machine_fk') THEN
    ALTER TABLE "planning_capacity_loads"
      ADD CONSTRAINT "planning_capacity_loads_machine_fk"
      FOREIGN KEY ("machine_id") REFERENCES "foundation_machines"("id")
      ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'planning_capacity_loads_shift_fk') THEN
    ALTER TABLE "planning_capacity_loads"
      ADD CONSTRAINT "planning_capacity_loads_shift_fk"
      FOREIGN KEY ("shift_id") REFERENCES "foundation_shifts"("id")
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "planning_capacity_loads" VALIDATE CONSTRAINT "planning_capacity_loads_work_center_fk";
--> statement-breakpoint
ALTER TABLE "planning_capacity_loads" VALIDATE CONSTRAINT "planning_capacity_loads_machine_fk";
--> statement-breakpoint
ALTER TABLE "planning_capacity_loads" VALIDATE CONSTRAINT "planning_capacity_loads_shift_fk";
--> statement-breakpoint

-- ── 3. production_operation_confirmations → foundation_machines ──
UPDATE "production_operation_confirmations" c
SET "machine_id" = NULL
WHERE c."machine_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "foundation_machines" f WHERE f."id" = c."machine_id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_operation_confirmations_machine_fk') THEN
    ALTER TABLE "production_operation_confirmations"
      ADD CONSTRAINT "production_operation_confirmations_machine_fk"
      FOREIGN KEY ("machine_id") REFERENCES "foundation_machines"("id")
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "production_operation_confirmations" VALIDATE CONSTRAINT "production_operation_confirmations_machine_fk";
--> statement-breakpoint

-- ── 4. engineering_products → foundation_items ──
-- engineering_products duplicates the Foundation item concept (code, name,
-- base unit, type, status). Same additive nullable-FK + conservative
-- exact-code-match backfill pattern used for inventory_items in 0021 and
-- bom_recipes in 0057. Unmatched rows stay NULL and keep working.
ALTER TABLE "engineering_products"
  ADD COLUMN IF NOT EXISTS "foundation_item_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engineering_products_foundation_item_idx"
  ON "engineering_products" ("foundation_item_id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engineering_products_foundation_item_fk') THEN
    ALTER TABLE "engineering_products"
      ADD CONSTRAINT "engineering_products_foundation_item_fk"
      FOREIGN KEY ("foundation_item_id") REFERENCES "foundation_items"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "engineering_products" e
SET "foundation_item_id" = f."id"
FROM "foundation_items" f
WHERE e."foundation_item_id" IS NULL
  AND e."code" = f."code"
  AND f."active" = true;
