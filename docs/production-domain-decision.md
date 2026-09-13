# Production Domain Decision

## Decision

`production_workflow_orders` is the single source of truth for production
orders. All new production creation, workflow actions, dashboard data,
operations planning, portal conversion, and reporting must use this table and
the `/production-workflow` route family.

## Legacy boundary

The old `production_orders` table and `src/routes/production.ts` are retained
temporarily for migration and investigation only. The legacy router is no
longer mounted in `src/index.ts`, so new traffic cannot create or mutate
legacy production orders.

No table is dropped until all of the following are complete:

1. A production data audit confirms whether legacy rows exist.
2. Required rows are migrated with an auditable mapping.
3. External callers are checked and redirected.
4. Fresh and existing-data migrations are verified.
5. Backup and restore are verified.

## Canonical lifecycle

The canonical statuses and allowed transitions live in
`src/domain/production-status.ts`. Invalid transitions are conflicts, and
every workflow mutation remains responsible for authorization, stock effects,
notifications, and audit logging.

## Relationship rules

- A production request may become one workflow order after the architectural
  production-request decision is completed.
- Operations planning creates workflow orders, never legacy production orders.
- Dashboards and reports read workflow orders.
- `production_orders` must not receive new writes.

## Verification

- The legacy router is not registered.
- No frontend file calls `/production-orders`.
- The canonical status module has transition tests.
- The legacy table/schema remain explicitly deferred for migration.