-- Phase 1 (Governance & Portal project) — link bom_recipes to foundation_items
-- so the wholesale portal catalog is sourced from the Foundation / master-data
-- page instead of free-text product code/name typed directly on the BOM screen.
-- Nullable by design so existing recipes stay readable during migration.

ALTER TABLE "bom_recipes"
  ADD COLUMN IF NOT EXISTS "foundation_item_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bom_recipes_foundation_item_idx"
  ON "bom_recipes" ("foundation_item_id");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bom_recipes_foundation_item_fk'
  ) THEN
    ALTER TABLE "bom_recipes"
      ADD CONSTRAINT "bom_recipes_foundation_item_fk"
      FOREIGN KEY ("foundation_item_id") REFERENCES "foundation_items"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
-- Conservative backfill: only exact code matches against an active
-- "finished_good" Foundation item are linked; ambiguous or missing codes
-- remain NULL and keep working exactly as before (denormalized fields only).
UPDATE "bom_recipes" b
SET "foundation_item_id" = f."id"
FROM "foundation_items" f
WHERE b."foundation_item_id" IS NULL
  AND b."product_code" IS NOT NULL
  AND b."product_code" = f."code"
  AND f."item_type" = 'finished_good'
  AND f."active" = true;
