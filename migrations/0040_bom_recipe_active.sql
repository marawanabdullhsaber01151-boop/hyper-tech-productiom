ALTER TABLE bom_recipes
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS bom_recipes_is_active_idx
  ON bom_recipes(is_active);