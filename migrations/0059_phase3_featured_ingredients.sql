-- Phase 3 (Governance & Portal project) — "أهم مكونات هذا المنتج".
-- Lets an admin deliberately mark specific recipe components as featured so
-- they appear in a dedicated section on the portal product page, each with
-- an optional image. Additive and defaulted, so every existing recipe item
-- keeps working unchanged (nothing is featured until someone marks it).

ALTER TABLE "bom_recipe_items"
  ADD COLUMN IF NOT EXISTS "is_featured" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "bom_recipe_items"
  ADD COLUMN IF NOT EXISTS "featured_image_data" text;
--> statement-breakpoint
-- Partial index: the portal only ever queries featured rows, and featured
-- rows are a small minority of all recipe items.
CREATE INDEX IF NOT EXISTS "bom_recipe_items_featured_idx"
  ON "bom_recipe_items" ("recipe_id")
  WHERE "is_featured" = true;
