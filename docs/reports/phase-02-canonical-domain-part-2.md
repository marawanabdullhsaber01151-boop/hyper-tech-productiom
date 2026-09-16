# Phase 02 — Canonical Production Domain — Delivery 2

## Delivered scope

This delivery completes the missing operational half of Phase 02 on top of
delivery 1:

- A single guarded transition service with row locking, optimistic
  `lifecycleRevision`, actor, reason, and transition-event evidence.
- Explicit lifecycle adjustment records for cancellation, split, partial
  completion, correction, and closure.
- Idempotent Operations Case conversion. A case links to one canonical root;
  additional production lines are represented as traceable split children.
- Production detail data endpoint with record type, blocked gates, frozen
  source snapshot, conformance result, adjustments, children, and timeline.
- Operator actions for hold, rework, partial completion, correction, and
  closure evidence.
- Legacy audit report and quarantine path. No legacy row is silently converted.
- Conformance endpoint for impossible statuses, missing snapshot identity, and
  broken event revisions.
- RTL detail drawer additions for gates, snapshot source, revision, timeline,
  and controlled lifecycle actions.

## Exact change manifest

### Added

```text
migrations/0056_phase2_lifecycle_controls.sql
scripts/phase2-lifecycle-audit.mjs
src/lib/production-lifecycle-transition.ts
src/routes/production-lifecycle.ts
docs/reports/phase-02-canonical-domain-part-2.md
```

### Modified

```text
src/db/schema/production-lifecycle.ts
src/db/schema/index.ts
src/domain/production-lifecycle.ts
src/domain/production-lifecycle.test.ts
src/lib/operations-claim.ts
src/main.ts
public/JS/production.js
public/CSS/production.css
```

## Migration and reconciliation

Migration `0056_phase2_lifecycle_controls.sql` is additive and idempotent.
Apply it only after `0055_phase2_canonical_production_domain.sql`. It creates
`production_lifecycle_adjustments`, indexes the lifecycle read paths, and adds
an unvalidated source-type constraint so existing history does not block the
deployment.

Before applying to a real database:

```bash
npm run db:preflight
npm run db:migrate
node scripts/phase2-lifecycle-audit.mjs
```

After backup and an explicit review decision, quarantine legacy evidence:

```bash
node scripts/phase2-lifecycle-audit.mjs --apply
```

`--apply` writes one `quarantined` mapping per `production_orders` row. It does
not create or delete a canonical order.

## Verification executed in this delivery

```text
npm ci --ignore-scripts        passed; 213 packages audited
npm run build                  passed; dist/index.mjs generated
npm test                       passed; 28 files, 168 tests passed, 3 skipped
npx tsc --noEmit               passed
node --check public/JS/production.js   passed
node --check scripts/phase2-lifecycle-audit.mjs passed
npm run check:repository      passed; 56 migrations, no blockers
```

No database migration, legacy audit, or E2E result is claimed here because the
supplied project has no `DATABASE_URL`. Those commands must be run against the
target environment and recorded in the deployment log.

## Recovery

Take a database backup before migration. If application rollback is needed,
restore the previous application bundle but keep migration 0056 in place while
any canonical orders or adjustment records reference it. Do not drop the
tables until the lifecycle reconciliation report confirms that no deployment
still depends on them.

## Known risks and dependencies

- Existing routes still expose legacy-compatible status mutations; they remain
  guarded and audited, while new lifecycle corrections use the centralized
  transition endpoint. A follow-up can migrate every historical mutation to
  the single command service without changing the response contract.
- `production_orders` remains read-only legacy data. Human review is required
  to map rows whose product, recipe, or status cannot be proven.
- Real database execution, login, happy-path E2E, and concurrency against the
  target PostgreSQL instance remain deployment-gate evidence, not local-test
  evidence.