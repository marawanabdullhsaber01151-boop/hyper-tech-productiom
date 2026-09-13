-- Phase 2 note: this migration originally added created_by_id to
-- purchase_orders (a scope-filter fix for the "buyer" role). That whole
-- table was dropped along with the rest of the purchasing module — see
-- CHANGE-MANIFEST-PHASE-2.md and migration 0049. Left as a documented
-- no-op rather than deleted, so the migration history/numbering stays
-- intact.
SELECT 1;

