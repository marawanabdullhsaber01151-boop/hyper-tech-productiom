# Change Manifest — Phase 01 Baseline Recovery

This manifest describes the Phase 01 implementation in this delivery. It
does not claim a live database or browser run when `DATABASE_URL` is absent.

## Added

- `migrations/0054_phase1_baseline_metadata.sql`
  - migration ledger metadata columns;
  - `system_health_checks`;
  - `command_idempotency`;
  - `data_audit_findings`.
- `src/db/schema/phase1.ts` and its schema export.
- `src/contracts/command.ts`.
- `src/middleware/requestContext.ts`.
- `src/lib/command.ts` — transaction-bound idempotent mutation helper.
- `src/routes/health.ts`
  - readiness check;
  - protected administrator health view;
  - audit findings endpoint;
  - “why unavailable?” diagnostic endpoint.
- `scripts/migration-preflight.mjs`.
- `scripts/phase1-data-audit.mjs`.
- `scripts/repository-self-check.mjs`.
- `public/admin-health.html`.

## Modified

- `src/main.ts`
  - correlation-ID middleware;
  - safe CORS headers for mutation contracts;
  - health router mount.
- `src/middleware/apiEnvelope.ts`
  - preserves legacy payloads and attaches correlation metadata when present.
- `src/middleware/requestLogger.ts` and `src/middleware/errorHandler.ts`
  - correlation-aware logs.
- `scripts/run-migrations.mjs`
  - ordered runner with checksums, durations, transaction rollback, baseline
    guard, and machine-readable `MIGRATION_REPORT`.
- `src/contracts/api-response.ts` and `src/contracts/index.ts`
  - versioned contract metadata types.
- `src/lib/departments.ts`
  - administrator health screen in governed navigation.
- `package.json`
  - preflight, Phase 01 audit, and repository self-check commands.

## Data reconciliation notes

- The audit is read-only for business tables.
- `production_orders` is classified as a legacy source; it is not deleted or
  silently migrated.
- `production_workflow_orders`, `operations_cases`, active master data, and
  generic foreign-key orphan counts are reported separately.
- Findings are persisted only when `0054_phase1_baseline_metadata.sql` has
  already created `data_audit_findings`.

## Commands

```bash
npm run check:repository
npm run db:preflight
npm run build
npm test
npm run db:migrate
npm run audit:phase1
```

`check:repository`, `db:preflight`, and the static parts of the audit are
local-only. `db:migrate`, `audit:phase1`, readiness, and authenticated browser
checks require the configured target PostgreSQL database. They must not be
reported as passed without executing them.

## Recovery

1. Take a database backup before applying `0054`.
2. If a migration fails, the runner rolls back that migration and leaves the
   previous ledger state intact.
3. Do not edit an applied SQL file. Create a new numbered migration.
4. Keep the generated Phase 01 audit JSON/Markdown as the reconciliation
   evidence for any later legacy migration decision.

## Unresolved risks

- No live `DATABASE_URL` was supplied, so database-backed migration, audit,
  login, and E2E evidence remain pending.
- Existing later migrations may expose historical schema assumptions; the
  preflight and checksum ledger now make those assumptions visible.
- Legacy external callers of `production_orders` still require an explicit
  audit before the table can be retired.