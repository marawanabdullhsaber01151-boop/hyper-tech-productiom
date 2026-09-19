# Phase 03 — Governed Master Data — Delivery 2

## Starting point and an honest gap assessment

Before writing any code, this delivery compared the roadmap's actual Phase
03 scope (`03-phase-governed-master-data-and-foundation-control-tower-en.md`)
against what the repository's own Phase 03 history had shipped so far:

- `CHANGE-MANIFEST-PHASE-3-PART-1.md` / `docs/reports/phase-03-foundation-part-1.md`
  — a read-only, `report-only`-by-default reconciliation script
  (`scripts/foundation-reconciliation-audit.mjs`) that counts orphaned
  inventory balances, dangling foundation references, invalid unit
  conversions, and broken location/work-center/machine parent links. No
  migration executed against a real database.
- `docs/reports/phase-03-foundation.md` — basic CRUD for foundation items,
  locations, work centers, machines, shifts, transitions, and number
  sequences (`public/foundation.html`, `src/routes/foundation.ts`), plus
  `migrations/0021_foundation_inventory_link.sql` linking
  `inventory_items.foundation_item_id` to `foundation_items.id`. Its own
  closing section calls the phase "مكتملة برمجيًا" (code-complete) — **that
  claim is about this basic CRUD screen, not about the roadmap prompt's
  actual Phase 03 requirements**, most of which do not exist yet:
  - No lifecycle states beyond a single `active` boolean anywhere (no
    draft / pending_approval / active / superseded / retired).
  - No ownership, effective dates, versions, or aliases on any master-data
    row.
  - No duplicate-record detection.
  - No import/export with dry-run.
  - No approval workflow for critical master-data changes.
  - No dependency/impact preview before inactivating a record — the
    generic `PATCH /foundation/items|locations|work-centers/:id` endpoints
    would flip `active` to `false` on a record with live dependents with
    no check at all, and no button in `public/JS/foundation.js` could even
    reach that field to begin with (it is not in any entity's edit-form
    `fields` list).
  - No master-data workspace UI with tabs/saved filters/dependency
    preview/import dry-run/approval status/change history/impact graph —
    `public/foundation.html` is a single generic table+dialog CRUD screen.

Given this gap, this delivery does not claim Phase 03 as a whole is
complete. It picks the single acceptance criterion with the clearest
safety consequence and delivers it end to end, the same way Phase 02
delivery 3 closed one specific, verifiable gap rather than attempting the
whole remaining surface at once in an environment where nothing can be
compiled or run against a real database.

## Delivered in this delivery

Acceptance criterion addressed: **"Inactivation cannot silently break open
work."**

- A pure decision module, `src/domain/foundation-inactivation.ts`
  (`isInactivationBlocked`, `activeBlockers`, `assertInactivationAllowed`):
  given a set of named "blocker" counts, refuses a `true → false`
  transition unless every count is zero, or the caller supplied an
  explicit `overrideReason` (>= 3 trimmed characters) — the "explicit
  impact decision" the acceptance criterion asks for, not a silent bypass.
  Throws a `409 INACTIVATION_BLOCKED` domain error with the blockers under
  `details`, matching the existing error-envelope contract in
  `src/middleware/errorHandler.ts` (`isDomainError` only serializes
  `details`, so the blockers had to be attached there, not under a
  made-up field name — checked against the actual handler before writing
  the throw).
- A DB-aware counting layer, `src/lib/foundation-inactivation.ts`, scoped
  strictly to relationships that already exist and were verified against
  the schema/migrations in this delivery (not guessed):
  - **Item** → count of `inventory_items` rows where
    `foundation_item_id = :id` and `qty`, `reserved_qty`, or
    `quarantine_qty` is greater than zero (link added by migration `0021`).
  - **Location** → count of active child `foundation_locations`
    (`parent_id = :id`) + count of active `foundation_work_centers`
    (`location_id = :id`).
  - **Work center** → count of active `foundation_machines`
    (`work_center_id = :id`).
  - **Machine** intentionally has no check in this delivery: it is a leaf
    node in the foundation schema itself. A machine may also be referenced
    by routing operations or execution/downtime records added in later
    phases, but this delivery did not inspect that schema and will not
    guess at a query against tables it has not verified.
  - Also intentionally out of scope: items referenced by BOM/routing
    (Engineering, Phase 04) or by open `production_workflow_orders`
    through a recipe. Blocking on inventory balance alone is a real, useful
    safety net (it is the one relationship Phase 03 itself created), not
    the complete picture.
- Wired into the three PATCH handlers in `src/routes/foundation.ts`
  (`/foundation/items/:id`, `/foundation/locations/:id`,
  `/foundation/work-centers/:id`): the impact check only runs on the exact
  `before.active === true && data.active === false` edge — re-saving an
  already-inactive record, or activating one, never pays the extra query.
  `overrideReason` is read directly from `req.body` by a small helper
  (`readOverrideReason`) rather than added to the zod entity schemas,
  because those schemas double as the exact shape spread into
  `db.update(...).set({ ...data })` — a schema-declared `overrideReason`
  would risk being written as a column value by a future edit. A
  source-assertion test guards this (see below).
- The reason (override or not) is now passed into `recordAudit(...)` for
  all three handlers, so the existing `foundation_audit` trail captures
  *why* a record was force-deactivated, not just that it changed.
- `public/JS/foundation.js`: the generic table row for the `items`,
  `locations`, and `work-centers` tabs now has a تفعيل/إلغاء تفعيل
  (activate/deactivate) button — previously `active` could not be reached
  from this screen at all. On `409 INACTIVATION_BLOCKED` it lists the
  returned blockers and prompts for an override reason (native `prompt()`,
  matching this file's existing style — no new dialog component
  introduced) before retrying with `overrideReason`; leaving the prompt
  empty cancels instead of retrying.

## Exact change manifest

### Added

```text
src/domain/foundation-inactivation.ts
src/domain/foundation-inactivation.test.ts
src/lib/foundation-inactivation.ts
src/routes/foundation.inactivation.test.ts
docs/reports/phase-03-foundation-part-2.md
CHANGE-MANIFEST-PHASE-3-PART-2.md
```

### Modified

```text
src/routes/foundation.ts     (items/locations/work-centers PATCH: impact check, overrideReason, audit reason)
public/JS/foundation.js      (activate/deactivate button + blocker prompt for items/locations/work-centers)
docs/PROJECT_STATUS.md       (status note for this delivery)
```

### Deleted

```text
None
```

## Migration

None required. No new column, table, or index. `inventory_items.foundation_item_id`
(migration `0021`) and the `active` booleans on `foundation_locations` /
`foundation_work_centers` / `foundation_machines` already exist.

## Environment limitation for this delivery

Same sandbox as Phase 02 delivery 3: **no outbound network access, no
`node_modules`, no reachable PostgreSQL instance.** None of `npm ci`,
`npx tsc --noEmit`, `npm test`, `npm run build`, or a real
`PATCH /foundation/.../:id` call against a database were executed here.
This is stated explicitly rather than implied by omission, per the master
prompt's rule against claiming an unexecuted build/test/migration result.

What was done to reduce risk without that tooling:

- Every new/edited file was re-read in full after editing to check
  import names against actual exports (`foundationLocationsTable`,
  `foundationWorkCentersTable`, `foundationMachinesTable` from
  `../db/schema/foundation`; `inventoryItemsTable` from
  `../db/schema/inventory`; column names `foundationItemId`, `qty`,
  `reservedQty`, `quarantineQty`, `parentId`, `locationId`,
  `workCenterId`, `active` all checked against the actual schema file, not
  assumed).
- The numeric-column comparison (`qty > 0`) follows the existing
  `sql\`${col}::numeric > 0\`` pattern already used in
  `src/routes/dashboard.ts`, rather than inventing a new one.
- The `details` field name in the thrown error was picked by reading
  `src/middleware/errorHandler.ts`'s `isDomainError` branch first — an
  earlier draft used a custom `blockers` field, which that handler would
  have silently dropped from the JSON response. Caught before delivery,
  not after.
- Two source-assertion tests (`foundation.inactivation.test.ts`) guard the
  three PATCH handlers still calling the three impact-check functions, and
  that `overrideReason` is never spread into a `.set(...)` call — same
  lightweight, dependency-free pattern already used in this repository
  (`production-workflow.cancel-reason.test.ts`,
  `production-workflow.masking.test.ts`).
- The pure decision module's tests
  (`foundation-inactivation.test.ts`) need no database and were written to
  be run by `npm test`, but **were not run** in this environment.

## Required before this delivery is accepted into the target environment

Run `npm ci`, `npx tsc --noEmit`, `npm test`, `npm run build` first as fast
static gates. Then, against a real staging database seeded with
representative data:

1. Create a `foundation_locations` row `A`, a child location `B` with
   `parentId = A.id` (active), and a `foundation_work_centers` row with
   `locationId = A.id` (active). `PATCH /foundation/locations/:A.id` with
   `{ "active": false }` → expect `409`, `code: "INACTIVATION_BLOCKED"`,
   `details` containing both `child_locations` and `work_centers` with
   `count >= 1`.
2. Same call with `{ "active": false, "overrideReason": "نقل يدوي" }` →
   expect `200`, the location now `active: false`, and a
   `foundation_audit` row for this location with `reason: "نقل يدوي"`.
3. Create a `foundation_work_centers` row with an active
   `foundation_machines` row under it. `PATCH .../work-centers/:id` with
   `{ "active": false }` → expect `409` with a `machines` blocker; with a
   valid `overrideReason` → expect `200`.
4. Create a `foundation_items` row, link an `inventory_items` row to it via
   `foundation_item_id` with `qty > 0`. `PATCH /foundation/items/:id` with
   `{ "active": false }` → expect `409` with an
   `active_inventory_balance` blocker; set the linked inventory row's
   `qty`, `reserved_qty`, and `quarantine_qty` all to `0` and retry with no
   override → expect `200` (this is the "no blockers, no override needed"
   path — confirms the check does not always demand a reason).
5. Confirm `PATCH .../:id` with `{ "active": true }` on an already-active
   record, and with `{ "name": "..." }` (no `active` field at all) on any
   record, never run the impact query (e.g. via a query-count assertion or
   log inspection) — the guard must only fire on the `true → false` edge.
6. Browser check: open `foundation.html`, "الأصناف" (items) tab, click
   "إلغاء تفعيل" on an item with stock → confirm the blocker list appears
   in the prompt and cancelling (empty input) leaves the item active;
   retry with a reason → item flips to "غير نشط" and the list refreshes.

## Recovery

No schema change in this delivery, so there is nothing to roll back at the
database level. To revert the behavior change, restore the previous
versions of `src/routes/foundation.ts` and `public/JS/foundation.js`; the
new files (`src/domain/foundation-inactivation.ts`,
`src/lib/foundation-inactivation.ts`) can be left in place unused if only a
partial revert is wanted.

## Known risks and next-phase dependencies

- This is one acceptance criterion out of five in the roadmap's Phase 03
  scope. Still open, in roughly descending order of how much they change
  daily operation: lifecycle states (draft/pending_approval/active/
  superseded/retired) instead of a single `active` boolean; effective
  dating; approval workflow for critical changes; duplicate-record
  detection; aliases; import/export with row-level dry-run errors; the
  master-data workspace UI itself (tabs, saved filters, dependency
  preview, import dry-run, approval status, change history, impact
  graph) — the current `foundation.html` is still the same single
  generic table+dialog screen from the original delivery.
- The item-inactivation check only looks at `inventory_items`. It does not
  yet look at BOM/routing (Engineering) or open production orders that
  reference the item through a recipe, because this delivery did not
  inspect that schema. A future delivery extending this guard into
  Engineering should read that schema first, the same way this delivery
  read `inventory_items` and `errorHandler.ts` before writing any query.
- The impact check and the actual update are two separate, unlocked
  statements (`before.active` re-read, then the impact query, then the
  update) — a dependent row could in theory be created in the gap between
  the check and the write. This matches the pre-existing concurrency
  posture of every other foundation route (none of them use a transaction
  or row lock today), so it is not a regression introduced by this
  delivery, but it is weaker than the row-locked compare-and-swap pattern
  used in `production-workflow.ts`. Worth revisiting if foundation
  mutations move to that same pattern in a later delivery.
- Real database execution and browser evidence for the checklist above
  remain deployment-gate evidence, not local-test evidence, exactly as
  stated in delivery 1's own report.
