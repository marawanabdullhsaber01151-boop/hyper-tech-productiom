# Phase 02 — Canonical Production Domain — Delivery 1

## Delivered boundary

This delivery establishes the data and concurrency foundation. It does not yet
include the redesigned production detail UI, split/partial-completion dialogs,
legacy reconciliation command, or the full conformance dashboard; those belong
to delivery 2.

## Decisions

- `production_workflow_orders` remains the only table allowed to receive new
  production-order writes.
- `workflow_status` remains the compatibility-facing status field. Every
  status mutation increments `lifecycle_revision` in PostgreSQL.
- A new production order stores a canonical source type/id/revision and frozen
  product, BOM, routing, customer-requirement, quantity, unit, due-date, and
  priority snapshots.
- Production requests and operations cases have one-to-one conversion guards.
- Historical `production_orders` rows are not deleted or silently converted.
  They will be audited and either mapped with evidence or quarantined.

## Files

See `CHANGE-MANIFEST-PHASE-2-PART-1.md` for the exact added/modified files.
The application integration records an initial event for every new canonical
order, records request conversion as an idempotent source-bound operation, and
records the Operations Manager claim with the same revision sequence.

## Migration and data reconciliation

`migrations/0055_phase2_canonical_production_domain.sql` is additive and
idempotent. It adds the canonical fields, transition-event table, legacy
mapping table, conversion uniqueness indexes, and the lifecycle revision
trigger. Existing workflow rows receive a conservative snapshot backfill; the
backfilled hash is marked as legacy by the SQL comments and must be
recomputed/verified by the reconciliation work in delivery 2.

## Verification

Executed in the supplied project copy:

- `npm ci --ignore-scripts` — passed; 213 packages audited.
- `npm test` — passed; 28 test files, 166 tests passed, 3 skipped.
- `npm run build` — passed; `dist/index.mjs` generated.
- `npm run check:repository` — passed; 55 migrations, no repository blockers.

The supplied archive did not include `DATABASE_URL`, so no database migration
or database-backed test is claimed as passed in this delivery. The target
environment still needs:

```bash
npm ci
npm test
npm run build
```

Against the target database, run:

```bash
npm run db:preflight
npm run db:migrate
```

## Recovery

Take a database backup before applying migration 0055. If the deployment needs
to roll back application code, restore the previous application bundle; do not
drop the new tables or columns until the reconciliation report confirms that
no canonical order references them.

## Open items for delivery 2

- Integrate transition-event writes into every mutation path, including
  operations-case conversion.
- Add the legacy audit/reconciliation command and mapping evidence report.
- Add hold, rework, split, partial-completion, correction, and closure API
  commands with permission and reason enforcement.
- Add the production detail state/timeline UI and blocked-gate view.
- Add exhaustive state-machine, conversion idempotency, concurrency, and
  permission tests.