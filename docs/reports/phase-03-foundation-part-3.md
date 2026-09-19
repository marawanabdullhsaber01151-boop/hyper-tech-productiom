# Phase 03 — Governed Master Data — Delivery 3

## Scope of this delivery

Delivery 2 closed one acceptance criterion ("inactivation cannot silently
break open work"). This delivery adds the core governance layer the
roadmap prompt actually asks for, applied to `foundation_items` as the
pilot entity (items are named first in the roadmap's "governed record
types" list, and are the entity every other governance feature — approval,
versioning, duplicate detection, import — most directly protects
inventory/production math for):

1. Lifecycle states beyond a single boolean: `draft → pending_approval →
   active → superseded/retired`.
2. Ownership, effective dates, and version history on every change.
3. An approval workflow for critical changes (unit of measure, item type,
   minimum stock) — request-change → approve/reject, restricted to a
   narrower role set than ordinary editing.
4. Duplicate-record detection, by name and by code, done with an indexed
   database query rather than an application-side scan (performance — see
   "Performance choices" below).
5. Aliases (alternate names/codes).
6. Bounded, all-or-nothing import with a dry-run mode, and export.

## Performance choices, since this delivery was asked to keep them in mind

- **Duplicate-name detection is an indexed `GROUP BY`, not an application
  scan.** `name_normalized` is a `GENERATED ALWAYS ... STORED` column
  (migration `0063`) computed by PostgreSQL itself from `name`, with a
  partial index (`WHERE status <> 'retired'`) backing it. `GET
  /foundation/items/duplicates` runs `GROUP BY name_normalized HAVING
  count(*) > 1` against that index — it never loads the item catalog into
  Node to normalize in JavaScript, so the cost stays roughly proportional
  to the number of *duplicate groups*, not the number of items, as the
  catalog grows. The trade-off, made explicit rather than left implicit: a
  generated SQL column and a JS pure function
  (`normalizeForDuplicateMatch` in `../domain/foundation-governance.ts`)
  now both encode the same normalization rule in two places, and nothing
  in this delivery enforces they stay identical. A future delivery could
  close that gap with a small script that feeds a reference set of names
  through both and asserts equality, run in CI. Not built here — flagged,
  not fixed under time pressure that would have meant guessing.
- **Import is capped at 500 rows per call and runs inside a single
  transaction.** A larger request is rejected up front (`413`) rather than
  accepted and left to run long or hold a connection from the pool
  indefinitely. Row-level pre-validation (`preValidateImportRow`, a pure
  function) runs *before* any database access, so a batch with any bad row
  is rejected with zero queries, not part-way through a scan.
- **The version-history table is append-only and indexed on
  `(item_id, created_at)`,** so "show me this item's history" stays a
  narrow index range scan regardless of how large the table grows
  globally, and the `(item_id, version)` unique constraint gives the same
  query a second, even narrower path when a specific version is requested.
- Every new list-shaped endpoint (`duplicates`, `history`) takes a bounded
  `limit` (defaulted, capped at 200) rather than returning an unbounded
  result set.

## What is *not* covered yet (read before assuming Phase 03 is closed)

- **Only `foundation_items` has this governance layer.** Locations, work
  centers, machines, shifts, and number sequences still have only the
  single `active` boolean plus the delivery-2 inactivation guard — no
  status machine, versions, aliases, or approval workflow. Extending the
  same pattern to them is mechanical (the domain module's transition table
  and the version/alias table shapes are already entity-agnostic in
  design, just not in code) but was not done here, to avoid multiplying
  unverified surface area in one delivery.
- **Effective dating is a schema field, not enforced behavior.**
  `effective_from`/`effective_to` exist as columns and can be set via
  `request-change`, but nothing in this delivery reads them — no route
  checks "is this item within its effective window" before allowing it to
  be used elsewhere (e.g. in a BOM or a sales order line). That
  enforcement point lives outside `foundation.ts` (in Engineering/Sales
  routes this delivery did not touch) and was not guessed at.
- **The master-data workspace UI the roadmap describes** — tabs, saved
  filters, a dependency/impact graph, an import-dry-run screen, approval
  queue, change-history timeline — does not exist. `public/foundation.html`
  is still the same single generic table+dialog screen from the original
  delivery, now with more row-level buttons (approve/reject/history/
  aliases) and three new toolbar buttons (duplicates/import/export), all
  using `prompt()`/`alert()` for input and output rather than dedicated
  dialogs, matching this file's existing minimal style rather than
  introducing a new UI component system. This is functional, not the rich
  workspace the roadmap prompt describes.
- **Duplicate detection only looks at `foundation_items`.** No alias-aware
  fuzzy matching (an alias "Steel Rod" would not currently flag against an
  item literally named "Steel Rod" unless the item's own `name` collides).
- A caveat noted for the record, not fixed: the approval workflow's
  `approve` handler applies `pendingChangePayload` by spreading it
  directly into `.set(...)` without re-running it through
  `foundationItemSchema` at approval time (it was already validated by
  `requestFoundationItemChangeSchema`'s narrower `changes` schema at
  request time). This is intentional — the payload was validated once, by
  the same person who is now also being asked to trust it was not
  tampered with between request and approval, which the database (no
  external write path to that jsonb column) already guarantees — but it is
  worth a second pair of eyes given it could not be exercised against a
  real request/approve cycle in this environment.

## Exact change manifest (deliveries 2 and 3 combined — delivery 2 was
authored in the previous turn but never packaged into a delivered archive
until now)

### Added

```text
src/domain/foundation-inactivation.ts
src/domain/foundation-inactivation.test.ts
src/lib/foundation-inactivation.ts
src/routes/foundation.inactivation.test.ts
docs/reports/phase-03-foundation-part-2.md
CHANGE-MANIFEST-PHASE-3-PART-2.md
migrations/0063_phase3_governed_master_data.sql
src/domain/foundation-governance.ts
src/domain/foundation-governance.test.ts
src/lib/foundation-governance.ts
src/routes/foundation.governance.test.ts
docs/reports/phase-03-foundation-part-3.md
CHANGE-MANIFEST-PHASE-3-PART-3.md
```

### Modified

```text
src/db/schema/foundation.ts   (active field added to 3 PATCH schemas — bug fix; new status/version/owner/effective-date/pending-change columns and tables; new zod schemas)
src/routes/foundation.ts      (inactivation guard; critical-field approval gate; history/impact/duplicates/aliases/request-change/approve/reject/import/export endpoints)
public/JS/foundation.js       (activate/deactivate button; status column; approve/reject/history/aliases row actions; duplicates/import/export toolbar buttons)
public/foundation.html        (three new toolbar buttons)
docs/PROJECT_STATUS.md        (status notes for both deliveries)
```

### Deleted

```text
None
```

## Migration

`migrations/0063_phase3_governed_master_data.sql`. Additive and idempotent
(`IF NOT EXISTS` throughout). The one non-trivial step is the
case-insensitive unique index on `code`: the migration counts
case-insensitive duplicate codes first; if any exist, it records them in a
new `foundation_items_duplicate_code_review` table and skips creating the
index (logged via `RAISE NOTICE`) instead of failing the whole migration.
**If that notice appears when this migration is actually run, the
case-insensitive constraint is not yet enforced** — check
`foundation_items_duplicate_code_review` and resolve the collisions, then
run `CREATE UNIQUE INDEX foundation_items_code_ci_unique ON
foundation_items(lower(code));` manually.

## Environment limitation for this delivery — and what changed about how
that limitation was handled

Same sandbox as every delivery so far in this conversation: no outbound
network, no `node_modules`, no reachable PostgreSQL. `npm ci`, `npm test`,
`npm run build`, and any real database call remain **not executed**, for
the same reason stated in every earlier report in this series.

One thing was different this delivery, and is reported precisely rather
than glossed over: this environment's Node.js version (v22.22.2) has
built-in TypeScript syntax stripping, so `node --check <file>.ts` could
actually run and did run, successfully, against every `.ts` file added or
modified in this delivery and in the two earlier ones from this
conversation:

```text
src/domain/foundation-governance.ts
src/domain/foundation-governance.test.ts
src/domain/foundation-inactivation.ts
src/domain/foundation-inactivation.test.ts
src/lib/foundation-governance.ts
src/lib/foundation-inactivation.ts
src/routes/foundation.ts
src/routes/foundation.inactivation.test.ts
src/routes/foundation.governance.test.ts
src/db/schema/foundation.ts
src/db/schema/production-workflow.ts
src/routes/production-workflow.ts
src/routes/production-lifecycle.ts
src/routes/production-workflow.cancel-reason.test.ts
```

**What this does and does not prove.** `node --check` confirms every one
of these files is free of syntax errors — no mismatched braces, no
malformed TypeScript type syntax, nothing that would fail to parse. It
does **not** run `tsc`'s type checker: it does not know that
`foundationItemsTable.status` is a real column, that
`recordFoundationItemVersion`'s third argument is the right type, or that
`inventoryItemsTable.foundationItemId` is spelled correctly. An attempt to
run the real `tsc --noEmit` was also made and is reported honestly: it
starts (a global `tsc` binary happens to be available in this container)
but fails immediately with `Cannot find module 'zod'` /
`'drizzle-orm/pg-core'` / etc. on every file in the project, including
ones untouched by this delivery, because `node_modules` does not exist —
so it produces no usable signal here and its output is not included as
evidence of anything.

What substituted for real type-checking, same as the previous two
deliveries: every new export was checked with `grep` against the exact
file that defines it before being imported elsewhere (shown inline in this
report's predecessor for the loose `Tx`/`Executor` type pattern, reused
here from `../lib/production-lifecycle-transition.ts` specifically to
avoid a `typeof db` vs. transaction-callback-parameter type mismatch that
is not just theoretical — it is exactly the reason that file already
carries the same workaround). Three real mistakes were caught and fixed
this way before this report was written, not after:

1. `db.execute(sql...)` returns `{ rows: T[] }`, not `T[]` directly — the
   duplicate-detection functions in `../lib/foundation-governance.ts`
   originally returned the whole result object; fixed to return `.rows`,
   matching the exact pattern already used in `src/routes/settings.ts`.
2. `foundationItemSchema`/`foundationLocationSchema`/
   `foundationWorkCenterSchema` did not declare an `active` field, so
   delivery 2's PATCH-based inactivation toggle was actually inert —
   `.partial().parse()` silently dropped `active` from every request
   before the route ever saw it. Fixed by adding
   `active: z.boolean().optional()` to all three schemas.
3. `assertInactivationAllowed`'s thrown error originally attached a custom
   `blockers` field; `src/middleware/errorHandler.ts`'s `isDomainError`
   branch only serializes a `details` field, so `blockers` would have been
   silently dropped from every `409` response. Fixed before delivery 2's
   report was written.

## Required before this delivery is accepted into the target environment

Run `npm ci`, `npx tsc --noEmit`, `npm test`, `npm run build` first. Then,
against a real staging database:

1. Run `npm run db:migrate` and confirm migration `0063` applies cleanly;
   check `foundation_items_duplicate_code_review` afterward — if it has
   rows, the case-insensitive unique index was **not** created (by design,
   not by failure) and needs manual follow-up as described above.
2. `PATCH /foundation/items/:id` with `{ "baseUnit": "g" }` on an item
   whose `status` is `active` → expect `409 USE_REQUEST_CHANGE_ENDPOINT`,
   no write. Same call on a `draft` item → expect `200`.
3. `POST /foundation/items/:id/request-change` with a valid `changes` +
   `reason` on an active item → expect `200`, `status` now
   `pending_approval`, `pendingChangePayload` populated, item's *visible*
   field values unchanged.
4. `POST /foundation/items/:id/approve` as a role in `APPROVAL_ROLES` →
   expect `200`, the proposed changes now live, `status` back to `active`,
   `version` incremented by 1, a new `foundation_item_versions` row
   holding the pre-approval snapshot. As a role only in `FOUNDATION_ROLES`
   (e.g. `warehouse_manager`) but not `APPROVAL_ROLES` → expect `403`.
5. `POST /foundation/items/:id/reject` with a reason → expect `200`,
   `status` back to `active`, field values unchanged from before
   request-change, `pendingChangePayload` cleared.
6. `GET /foundation/items/duplicates` after inserting two items named
   `"Steel  Bar"` and `"steel-bar"` → expect both in the same `byName`
   group. `EXPLAIN` the underlying query to confirm it uses
   `foundation_items_name_normalized_active_idx`, not a sequential scan.
7. `POST /foundation/items/import` with `dryRun: true` (default) and one
   row missing `code` → expect `200`, `canApply: false`, the row's error
   listed, **no database write** (confirm row count unchanged). Retry with
   `dryRun: false` and a valid batch → expect the items created as
   `status: "draft"`, `active: false`; re-run the same batch → expect the
   existing rows updated (matched case-insensitively by code) with
   `version` incremented, not duplicated.
8. `POST /foundation/items/import` with 501 rows → expect `413` before any
   row is read.
9. Browser check: `foundation.html`, "الأصناف" tab — status column shows
   Arabic labels; an item with `status: pending_approval` shows
   اعتماد/رفض buttons; "الأصناف المكررة" / "استيراد" / "تصدير" buttons only
   appear on the items tab.

## Recovery

Migration `0063` is additive (new columns default-nullable except
`status`/`version`, new tables, new indexes) — nothing existing is
dropped or altered destructively, so no data-loss rollback is needed to
revert the schema. To revert the behavior change, restore the previous
versions of the five modified files listed above; the new tables/columns
can be left in place unused.

## Known risks and next-phase dependencies

- Everything listed under "What is not covered yet" above.
- The `name_normalized` SQL expression and the JS
  `normalizeForDuplicateMatch` function must be kept in sync by hand; no
  automated check enforces this yet.
- Real database execution, the full checklist above, and browser evidence
  remain deployment-gate evidence, not local-test evidence — consistent
  with every report in this series.
