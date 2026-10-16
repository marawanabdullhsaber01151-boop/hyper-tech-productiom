# CHANGE MANIFEST — PHASE 03 / DELIVERY 2

## Added

```text
src/domain/foundation-inactivation.ts
src/domain/foundation-inactivation.test.ts
src/lib/foundation-inactivation.ts
src/routes/foundation.inactivation.test.ts
docs/reports/phase-03-foundation-part-2.md
CHANGE-MANIFEST-PHASE-3-PART-2.md
```

## Modified

```text
src/routes/foundation.ts     (items/locations/work-centers PATCH: dependency-impact check before deactivation, overrideReason, audit reason)
public/JS/foundation.js      (activate/deactivate button — did not exist before this delivery — + blocker prompt for items/locations/work-centers)
docs/PROJECT_STATUS.md       (status note for this delivery)
```

## Deleted

```text
None
```

## What this delivery closes

One acceptance criterion from the Phase 03 roadmap prompt: "Inactivation
cannot silently break open work." See
`docs/reports/phase-03-foundation-part-2.md` for the full gap assessment
(most of Phase 03's actual scope — lifecycle states, effective dating,
approval workflow, duplicate detection, aliases, import/export, the
workspace UI — was still missing at the start of this delivery and mostly
still is at the end of it; delivery 3 closes more of it) and the exact
dependency relationships this guard checks.

## Migration

None required. No new column, table, or index — `inventory_items.foundation_item_id`
(migration `0021`) and the `active` booleans already existed.

## Delivery method

Delta delivery. Copy over the existing project root; do not extract into a
nested directory.

```bash
npm ci
npx tsc --noEmit
npm test
npm run build
```

Then the manual/staging acceptance checklist in
`docs/reports/phase-03-foundation-part-2.md` against a real PostgreSQL
instance.

## Verification executed in this delivery

None of the commands above were executed in this delivery's authoring
environment (no outbound network, no `node_modules`, no reachable
PostgreSQL). See "Environment limitation for this delivery" in
`docs/reports/phase-03-foundation-part-2.md` for what manual review was
done instead.
