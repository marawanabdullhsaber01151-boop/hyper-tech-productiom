# Change Manifest — Phase 00 Baseline Recovery and Audit

This delivery is the independently verified Phase 00 baseline. It does not
claim that later roadmap phases are complete.

## Added

- `scripts/phase0-baseline-audit.mjs`
  - Reads the repository itself and generates a machine-readable inventory of
    routes, pages, schema tables, migration files/checksums, roles, permission
    actions, statuses, settings candidates, notifications, tests, duplicates,
    and source-of-truth declarations.
- `docs/audits/phase-00-baseline-inventory.json`
  - Generated inventory with file/line evidence.
- `docs/audits/phase-00-baseline-report.md`
  - Generated baseline findings and verification boundary.
- `CHANGE-MANIFEST-PHASE-00.md`

## Modified

- `scripts/run-migrations.mjs`
  - Bootstraps the canonical `drizzle/0000_0000_initial_schema.sql` before
    incremental migrations on a genuinely empty database.
  - Rejects a partially initialized database instead of guessing or applying
    migrations against an unknown shape.
  - Keeps the ordered `migrations/*.sql` runner and npm workflow unchanged.
- `public/planning.html`
  - Removes stale `admin` and `manager` frontend roles that were not declared
    by the canonical `src/lib/roles.ts` list.
- `package.json`
  - Adds the reproducible `npm run audit:baseline` command.
- `scripts/phase0-baseline-audit.mjs`
  - Distinguishes the intentionally unmounted legacy production route from
    unexpected route mounting gaps.

## Evidence from the independent audit

- 249 API route declarations scanned.
- 31 public HTML pages scanned.
- 74 Drizzle tables scanned.
- 53 ordered SQL migrations scanned.
- 18 canonical roles scanned.
- 33 fine-grained permission actions scanned.
- 29 test files scanned.
- Duplicate routes: 0.
- Duplicate schema table definitions: 0.
- Frontend role drift after correction: 0.
- Unexpected unmounted route modules: 0.
- The only unmounted route is the intentionally retained legacy
  `src/routes/production.ts`, documented as non-canonical in `src/main.ts`.
- The initial tables that are not recreated by incremental migrations are now
  explicitly recognized as coming from the canonical drizzle baseline and are
  bootstrapped by the migration runner.

## Verification performed

- `node scripts/phase0-baseline-audit.mjs` — passed; generated the JSON and
  Markdown audit artifacts.
- `node --check scripts/run-migrations.mjs` — passed.
- `node --check scripts/phase0-baseline-audit.mjs` — passed.
- `npx tsc --noEmit` — passed.
- `npm test -- --reporter=dot` — passed: 27 test files, 163 tests passed,
  3 skipped.
- `npm run check:roles` — passed.
- `npm run build` — must be rerun after this baseline-only change before
  deployment; the prior application build was successful.

## Verification boundary

Phase 00 static inspection is complete. A claim of 100% operational closure
is not honest until the following are run against a disposable PostgreSQL
database or an approved test database:

1. `npm run db:migrate` from an empty database, including the new baseline
   bootstrap.
2. `npm run db:migrate` against an existing database with a complete backup.
3. Authenticated smoke/E2E flows for canonical workflow, portal, governance,
   settings, and role boundaries.
4. Re-run the inventory against the resulting database to compare live tables
   and migration markers with the static inventory.

No `DATABASE_URL` was present in this environment, so those database-backed
checks are explicitly unverified rather than marked as passed.

## Recovery

- Restore `scripts/run-migrations.mjs` and `public/planning.html` from the
  previous revision if needed.
- Do not run the baseline bootstrap against a partial database. The runner
  intentionally stops and requires reconciliation.
- Take a database backup before applying any pending migration.