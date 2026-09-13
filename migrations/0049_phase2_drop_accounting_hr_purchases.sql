-- Phase 2 (Production Portal rebuild): remove all tables backing the
-- accounting, HR, purchasing, and contact-balance/credit-ledger features.
-- This system carries no accounting or payment logic — see
-- CHANGE-MANIFEST-PHASE-2.md for the full list of code-level removals that
-- accompany this migration.
--
-- Safe to run once; re-running is a no-op because every DROP uses
-- IF EXISTS. This does NOT touch contacts.balance or contacts.creditLimit —
-- those two columns are left in place as inert/historical data (nothing in
-- the app writes to them anymore after this phase). Whether to drop them
-- too is flagged as an open question in the manifest.

DROP TABLE IF EXISTS contact_ledger;
DROP TABLE IF EXISTS purchase_order_items;
DROP TABLE IF EXISTS purchase_orders;
DROP TABLE IF EXISTS attendance_logs;
DROP TABLE IF EXISTS employees;
DROP TABLE IF EXISTS accounting_transactions;
