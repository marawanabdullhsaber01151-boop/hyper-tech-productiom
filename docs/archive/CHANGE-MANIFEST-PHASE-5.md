# Change Manifest — Phase 05

This manifest contains only files added or modified for the Phase 05 planning
cockpit delivery. Files inspected but unchanged are intentionally omitted.

## Added

- `migrations/0053_phase5_planning_cockpit.sql`
  - Adds deterministic planning runs, immutable input snapshots, capacity
    loads, shortage messages, pegging links, and release decisions.
- `src/domain/planning.ts`
  - Pure planning arithmetic, deterministic run keys, capacity evaluation and
    overlap merging, plus release-impact calculation.
- `src/domain/planning.test.ts`
  - Explicit tests for reservation/quarantine arithmetic, deterministic
    reruns, capacity overload, overlapping loads, and live-operation isolation.
- `CHANGE-MANIFEST-PHASE-5.md`

## Modified

- `src/db/schema/planning.ts`
  - Adds the Phase 05 database contract and validated run input schema.
- `src/routes/planning.ts`
  - Adds run creation, explainable cockpit reads, optimistic approval,
    release preview, and isolated release lifecycle routes.
  - Retains the existing `/planning/mrp` and requisition routes for API
    compatibility.
- `public/planning.html`
  - Adds horizon inputs and the scenario-risk cockpit surface.
- `public/JS/planning.js`
  - Uses the new run lifecycle and renders shortage/overload counts with
    approval and release actions.
- `src/db/schema/contacts.ts`
  - Removes a stale type reference to the deleted accounting ledger table so
    the supplied project compiles without restoring accounting behavior.

## Delivery and phase notes

- The supplied project remains npm-based. `package.json`, `package-lock.json`,
  and the existing SQL migration runner were preserved; no pnpm files or
  commands were introduced.
- Draft scenarios write only snapshot/run tables and the compatibility
  `production_plans` record. They do not mutate inventory quantities,
  reservations, production workflow orders, or purchase orders.
- Approval and release use a guarded status transition. A second concurrent
  transition receives a conflict instead of applying a second state change.
- The compatibility `production_plans` row is created inside the same
  transaction as the run and material requirements, so older consumers retain
  their existing contract.

## Migration and data-reconciliation notes

- Apply `migrations/0053_phase5_planning_cockpit.sql` after the existing
  migrations, using the repository runner:

  ```bash
  npm run db:migrate
  ```

- A live PostgreSQL migration was **not executed** in this environment because
  no `DATABASE_URL` was supplied. Take a backup and verify the current
  `phase0_number_sequences` data before using the cockpit in production.
- Existing `material_requirements` rows are untouched. New cockpit rows use a
  compatibility production plan plus the new `planning_runs` graph.

## Verification performed

- `npm ci --include=dev` — passed; npm lockfile preserved.
- `npm test -- --reporter=dot` — passed: 27 test files, 163 tests passed,
  3 skipped.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed.
- `node --check public/JS/planning.js` — passed.
- PostgreSQL migration and authenticated browser E2E — not run; both require a
  configured database/application session.

## Manual acceptance evidence

With a migrated database and a planning-role session:

1. Run a scenario with a material that has `reserved_qty` or `quarantine_qty`;
   the cockpit must show only free stock as available and explain the
   resulting shortage.
2. Submit two capacity lines for the same center/date/shift; they are merged
   before overload calculation.
3. Create the same scenario payload twice; the deterministic `run_key` returns
   the existing run instead of duplicating it.
4. Approve, preview release, and release. The preview explicitly reports that
   live reservations and live orders remain unchanged.
5. Attempt a second approval or release; the API must return a conflict.

## Recovery and rollback

- Before migration, create a PostgreSQL backup.
- To disable the new UI temporarily, keep the existing planning page and do
  not call `/planning/runs`; legacy `/planning/mrp` remains available.
- To revert the application code, restore the modified files in this manifest.
- The migration is additive and uses `IF NOT EXISTS`; dropping its tables is a
  destructive data action and must only be performed from a reviewed backup
  and rollback plan.

## Unresolved risks and dependencies

- Capacity inputs are currently supplied by the planner/API caller. Automatic
  extraction from routing calendars, skills, maintenance holds, and shift
  calendars is the next planning increment.
- Open supply is captured in the run input snapshot; it is not yet sourced
  automatically from purchase requisitions or inbound receipts.
- Live database validation, migration execution, and authenticated E2E remain
  deployment dependencies, not claims of completion in this package.