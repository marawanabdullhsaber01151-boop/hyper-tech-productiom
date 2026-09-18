-- Phase 2 (Governance & Portal project) — product images.
-- See src/db/schema/product-images.ts for the storage-decision rationale
-- (base64-in-Postgres, chosen because this project has no existing
-- file-upload/object-storage infrastructure and runs on Vercel's
-- ephemeral serverless filesystem).

CREATE TABLE IF NOT EXISTS "product_images" (
  "id" serial PRIMARY KEY NOT NULL,
  "bom_recipe_id" integer NOT NULL REFERENCES "bom_recipes"("id") ON DELETE CASCADE,
  "role" text DEFAULT 'secondary' NOT NULL,
  "image_data" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "uploaded_by_user_id" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_images_recipe_idx" ON "product_images" ("bom_recipe_id");
--> statement-breakpoint
-- At most one primary image per recipe.
CREATE UNIQUE INDEX IF NOT EXISTS "product_images_one_primary_per_recipe"
  ON "product_images" ("bom_recipe_id")
  WHERE "role" = 'primary';
