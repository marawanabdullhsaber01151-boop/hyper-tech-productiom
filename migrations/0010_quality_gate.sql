ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS requires_quality_check boolean NOT NULL DEFAULT false;

-- Phase 2 note: the "accepted_qty"/"rejected_qty" columns this migration
-- originally added to purchase_order_items are gone — that whole table
-- was dropped along with the rest of the purchasing module (see
-- CHANGE-MANIFEST-PHASE-2.md and migration 0049). Nothing else in this
-- file depended on that table, so removing those two lines is safe.
