-- Phase 3 (Portal Identity, Multi-Product Orders, Due Dates & Delivery
-- Rules): add the two new recipe-level fields the due-date suggestion
-- formula and the portal's reference-only pricing depend on.
--
-- Both are nullable — existing recipes created before this phase simply
-- have NULL here until someone fills them in; src/lib/dueDateSuggestion.ts
-- falls back to a documented system default when expected_production_days
-- is NULL, and the portal UI shows "السعر غير محدد بعد" when
-- reference_price is NULL rather than failing.

ALTER TABLE bom_recipes
  ADD COLUMN IF NOT EXISTS reference_price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS expected_production_days integer;
