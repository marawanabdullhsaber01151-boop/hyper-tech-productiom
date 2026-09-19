# Phase 04 — Engineering Product Lifecycle, BOM & Routing — Delivery 1

## The critical finding — read this before anything else in this report

Before writing any code, this delivery inspected the existing engineering
module (`engineering_products` / `engineering_product_versions` /
`engineering_routings`, migration `0022`, already in the repository) and
compared it against how production orders are actually created
(`src/routes/production-workflow.ts`).

**Production orders are created and driven entirely by `bom_recipes`** — a
flat, older table with no `status`, no `version`, no approval columns at
all (`src/db/schema/bom.ts`). Nothing in `production-workflow.ts`, or
anywhere else searched, reads from `engineering_products`,
`engineering_product_versions`, or `engineering_routings`. The engineering
module's own approve endpoint
(`POST /engineering/bom-versions/:id/approve`, before this delivery) did
no validation at all before flipping `status` to `"approved"`, and nothing
in the codebase ever set `status` to anything past `"approved"` — the
`"released"`/`"superseded"`/`"retired"` states the roadmap prompt asks for
did not exist in application code.

**Consequence for this delivery's acceptance criteria:** "Only an
approved/released engineering revision can drive released work" is
currently false — production does not consume an engineering revision at
all, governed or not. Rewiring `production-workflow.ts` to consume
`engineering_product_versions` instead of `bom_recipes` is the change that
would actually make that criterion true, and it is **not attempted in this
delivery**. It touches the order-creation code path directly (the same
file Phase 02 spent two deliveries making transactionally safe and
audited), would need to migrate or dual-write for every existing
`bom_recipes` row and every open order that already references one, and
none of it can be verified against a real database in this sandbox. A
delivery that guesses at that rewrite without the ability to run it is a
worse outcome than a delivery that says plainly it has not been attempted
yet and explains exactly what stands in the way.

What this delivery does instead: makes the engineering module itself
internally governed and safe to build on — real BOM/routing structure,
validation, a real six-state lifecycle, and immutable release snapshots —
so that a future, dedicated delivery that does the order-creation rewiring
has a governed source to point at, has real acceptance-criteria groundwork
already in place, and can be scoped to "point production at engineering"
rather than also having to build the governance layer at the same time.

## What was delivered

1. **Structured BOM components** (`engineering_bom_components`, migration
   `0064`) replacing the untyped `bom_snapshot jsonb` array as the
   *editable* representation for draft/in_review versions. Each row is
   exactly one of: consumes a Foundation item, or is itself a sub-assembly
   produced by another engineering product (a `CHECK` constraint enforces
   exactly one), with `component_type` covering raw_material /
   sub_assembly / substitute / co_product / by_product, `scrap_factor_pct`,
   and an alternate-group marker for interchangeable substitutes.
2. **A real six-state lifecycle**: `draft → in_review → approved →
   released → superseded/retired`, enforced by a pure state machine
   (`src/domain/engineering-governance.ts`) reused across every transition
   endpoint, the same pattern already used for production orders (Phase
   02) and foundation items (Phase 03).
3. **Immutability**: `draft`/`in_review` are the only editable statuses.
   Adding or deleting a BOM component, or adding a routing operation, on
   any other status is refused before any database write
   (`VERSION_NOT_EDITABLE`). The pre-existing routing-operations endpoint
   had no such guard at all before this delivery — an approved version's
   routing could be silently changed in place.
4. **Manufacturability validation**
   (`POST /engineering/product-versions/:id/validate`), covering every
   item the roadmap prompt names: BOM cycles (real graph cycle detection
   across sub-assembly references, with the actual cycle path reported,
   not just yes/no), missing units, inactive materials (joined against
   Foundation's `active` flag), impossible quantities, duplicate routing
   operation numbers, and missing work centers. The result is persisted on
   the version row and automatically invalidated (`not_validated`) by
   every component/routing edit, so a stale "passed" result from before
   the day's edits can never be used to approve — enforced structurally
   (see the source-assertion test for the exact ordering check), not just
   as a documented expectation.
5. **Approval now requires that persisted, current validation to have
   passed** (`VALIDATION_REQUIRED` otherwise), restricted to a narrower
   `engineeringApprovalRoles` set than ordinary editing — matching the
   pattern already established for foundation items (Phase 03) and
   production cancellation review points.
6. **Release freezes an immutable snapshot**
   (`POST /engineering/product-versions/:id/release`): the currently
   persisted components and routing rows are copied into
   `bom_snapshot`/`routing_snapshot` and the version marked `released`, in
   one transaction, so a released row's snapshot can never disagree with
   what its own status claims.
7. **Supersede** (`POST /engineering/product-versions/:id/supersede`)
   requires the replacement version to belong to the same engineering
   product before accepting the transition.
8. **Real, honest change-impact for ECRs**
   (`GET /engineering/change-requests/:id/impact`): other engineering
   product versions that consume the affected product as a sub-assembly —
   computable and correct. The response explicitly states
   `"غير متاح حاليًا — أوامر الإنتاج لا تستهلك مراجعات الهندسة بعد"`
   for production-order impact rather than returning an empty array that
   could be misread as "confirmed: no orders affected." A fabricated or
   silently-empty impact list would be a worse failure mode than an
   explicit "not available yet."
9. `public/JS/engineering.js`/`public/engineering.html`: the engineering
   screen was previously read-mostly (list products, list change requests,
   three creation forms) with no way to see a product's versions at all.
   Added a per-product "عرض الإصدارات الهندسية" expander showing each
   version's status and the lifecycle actions valid for that status
   (validate always available; submit-review only from draft; approve only
   from in_review; release only from approved), using `alert()`/`confirm()`
   for validation results and confirmations, matching this screen's
   existing minimal style rather than introducing a new dialog system.

## What is deliberately not covered by this delivery

- **The order-creation rewiring described above** — the single largest
  remaining gap, and the reason the acceptance criterion about released
  work is not yet true end to end.
- **No BOM component editor, routing board, revision tree, visual diff, or
  effectivity calendar UI.** Components and routing operations can be
  managed via the API (and a component-adding form could be added
  cheaply), but this delivery only added the version status/action list
  described above. The roadmap's "engineering workspace" is a materially
  larger UI project than this delivery's scope.
- **Alternates/substitutes are represented in the schema
  (`is_alternate`/`alternate_group`) but nothing enforces or reasons about
  them yet** — no "pick one from this alternate group" logic anywhere.
- **Effectivity dates (`effective_from`/`effective_to`) are unchanged from
  before this delivery**: present as columns, not read by any validation
  or by order creation (moot while order creation does not consume this
  module at all).
- **ECO (engineering change *order*, i.e. an approved ECR's actual
  execution) is not distinguished from ECR (the request).** The existing
  `engineering_change_requests` table and its `status` field (still just
  `"open"` by default, never transitioned by any code before or after this
  delivery) is unchanged in this delivery beyond the new `/impact` endpoint.
- **Concurrent release / order-creation tests, and an
  engineering-to-production E2E snapshot test**, both explicitly asked for
  in the roadmap prompt's verification list, are moot until the rewiring
  above exists — there is no production-order-creation path that reads
  this module yet to test end to end.

## Exact change manifest

### Added

```text
migrations/0064_phase4_engineering_bom_governance.sql
src/domain/engineering-governance.ts
src/domain/engineering-governance.test.ts
src/lib/engineering-governance.ts
src/routes/engineering.governance.test.ts
docs/reports/phase-04-engineering-part-1.md
CHANGE-MANIFEST-PHASE-4-PART-1.md
```

### Modified

```text
src/db/schema/engineering.ts   (new engineering_bom_components table; new governance columns on engineering_product_versions; new zod schemas)
src/routes/engineering.ts      (component CRUD with editability guard; validate/submit-review/release/supersede endpoints; approve now requires passing validation and narrower roles; routing-operation endpoint now guarded; change-request impact endpoint)
public/JS/engineering.js       (per-product version list with status + lifecycle action buttons — did not exist before this delivery)
public/engineering.html        (unchanged structurally; existing containers reused by the new script)
```

### Deleted

```text
None
```

## Migration

`migrations/0064_phase4_engineering_bom_governance.sql`. Additive:
one new table (`engineering_bom_components`, with a `CHECK` constraint
requiring exactly one component source and a positive quantity), new
nullable/defaulted columns on `engineering_product_versions`, and a new
`CHECK` constraint on `status` widening the allowed set from the implicit
`{draft, approved}` application code produced before this delivery to the
full six-state set — compatible with any existing row, since no code path
ever wrote anything outside that pair.

## Environment limitation for this delivery

Same sandbox as every delivery in this conversation: no outbound network,
no `node_modules`, no reachable PostgreSQL. `npm ci`, `npm test`,
`npm run build`, and any real database call were **not** executed.

What was done instead, continuing the practice from the last two
deliveries: `node --check` (this container's Node.js v22.22.2 built-in
TypeScript syntax stripping) was run successfully against every `.ts` file
in this delivery — confirms no syntax errors, not real type-checking (see
the Phase 03 delivery 3 report for the full explanation of what this does
and does not prove; a real `tsc --noEmit` still fails immediately here on
`Cannot find module 'zod'`/`'drizzle-orm/pg-core'` for the same
no-`node_modules` reason, on every file in the project, not just this
delivery's). Every new export was cross-checked with `grep` against the
file that actually defines it before being imported elsewhere. The loose
structural `Executor` transaction-type workaround in
`src/lib/engineering-governance.ts` reuses the exact pattern already
proven in `src/lib/production-lifecycle-transition.ts` (Phase 02) and
`src/lib/foundation-governance.ts` (Phase 03), for the same reason: a
drizzle transaction callback's `tx` parameter is not exactly `typeof db`.

## Required before this delivery is accepted into the target environment

Run `npm ci`, `npx tsc --noEmit`, `npm test`, `npm run build`, then
`npm run db:migrate` against a real staging database. Then:

1. Create an engineering product and a draft version. `POST
   .../components` with a component that sets both `foundationItemId` and
   `subAssemblyProductId` → expect `400` (zod refine). With neither →
   expect `400`. With `qty: "0"` or a negative quantity → expect `400`
   (zod refine added in this same delivery after noticing the gap while
   writing this report — `createBomComponentSchema.qty` now rejects
   non-positive values itself rather than relying only on the database's
   `engineering_bom_components_positive_qty` CHECK constraint to catch it).
2. `POST .../validate` on a version with zero components → expect
   `EMPTY_BOM` error, `passed: false`.
3. Add a valid component, a routing step with no `workCenterId` → validate
   → expect `MISSING_WORK_CENTER`, `passed: false`.
4. Fix the routing step, validate again → expect `passed: true`,
   `validationStatus` on the version row now `"passed"`.
5. `POST .../submit-review`, then `POST bom-versions/:id/approve` → expect
   `200` (validation still fresh). Add another component after approval →
   expect `409 VERSION_NOT_EDITABLE`.
6. Create a second product B whose BOM has a sub-assembly component
   referencing product A, and give product A's BOM a sub-assembly
   component referencing product B → validate either version → expect
   `BOM_CYCLE` with the actual cycle path in the message.
7. `POST .../release` on an approved version → expect `200`, `status:
   "released"`, `bom_snapshot`/`routing_snapshot` populated with the exact
   components/routing rows, and a further `POST .../components` on it →
   `409 VERSION_NOT_EDITABLE`.
8. `GET /engineering/change-requests/:id/impact` for an ECR on product A
   (from step 6) → expect product B's version listed under
   `affectedEngineeringVersions`, and `productionOrderImpact` as the fixed
   "not available yet" string, never a fabricated list.
9. Browser check: `engineering.html`, click "عرض الإصدارات الهندسية" on a
   product with versions → status list renders with the correct action
   buttons per status; "فحص القابلية للتصنيع" shows the issue list via
   `alert()`.

## Recovery

Migration `0064` is additive; nothing existing is dropped or altered
destructively. To revert the behavior change, restore the previous
versions of `src/db/schema/engineering.ts`, `src/routes/engineering.ts`,
and `public/JS/engineering.js`; the new table/columns can be left in place
unused.

## Known risks and next-phase dependencies

- The order-creation rewiring described at the top of this report is the
  central remaining item and should be its own dedicated delivery with
  real database access, not attempted blind.
- No UI exists yet for adding/removing BOM components or routing
  operations (API-only); the version-list UI added here shows status and
  lifecycle actions, not the BOM/routing content itself.
- Real database execution, the full checklist above, and browser evidence
  remain deployment-gate evidence, not local-test evidence, consistent
  with every report in this series.
