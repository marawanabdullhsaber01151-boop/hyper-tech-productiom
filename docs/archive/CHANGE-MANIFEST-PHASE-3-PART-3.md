# CHANGE MANIFEST — PHASE 03 / DELIVERY 3

## Added

```text
migrations/0063_phase3_governed_master_data.sql
src/domain/foundation-governance.ts
src/domain/foundation-governance.test.ts
src/lib/foundation-governance.ts
src/routes/foundation.governance.test.ts
docs/reports/phase-03-foundation-part-3.md
CHANGE-MANIFEST-PHASE-3-PART-3.md
```

## Modified

```text
src/db/schema/foundation.ts   (bug fix: `active` was missing from 3 PATCH zod schemas, silently dropped by delivery 2's own endpoint; new governance columns/tables/schemas for foundation_items)
src/routes/foundation.ts      (critical-field approval gate; history/impact/duplicates/aliases/request-change/approve/reject/import/export endpoints)
public/JS/foundation.js       (status column; approve/reject/history/aliases row actions; duplicates/import/export toolbar buttons)
public/foundation.html        (three new toolbar buttons)
docs/PROJECT_STATUS.md        (status note for this delivery)
```

## Deleted

```text
None
```

## What this delivery closes, and what it does not

Adds lifecycle states, versioning, an approval workflow for critical
changes, duplicate-record detection, aliases, and bounded import/export —
scoped to `foundation_items` only. Locations, work centers, machines,
shifts, and effective-date *enforcement* (the columns exist; nothing reads
them yet), and the full master-data workspace UI the roadmap prompt
describes, remain open. See "What is not covered yet" in
`docs/reports/phase-03-foundation-part-3.md` for the complete list and
why each was left for a future delivery rather than guessed at.

## Migration

`migrations/0063_phase3_governed_master_data.sql`. Additive and
idempotent. One step (the case-insensitive `code` unique index) is
conditional on no existing case-insensitive duplicates — see the
migration's own comments and "Migration" in
`docs/reports/phase-03-foundation-part-3.md` for the exact follow-up if it
is skipped.

## Delivery method

Delta delivery, combined with delivery 2 in this same archive since
delivery 2 was authored in an earlier turn of this conversation but never
packaged into a delivered file until now. Copy over the existing project
root; do not extract into a nested directory.

```bash
npm ci
npx tsc --noEmit
npm test
npm run build
npm run db:migrate   # against a real staging database, not production directly
```

Then the manual/staging acceptance checklist in
`docs/reports/phase-03-foundation-part-3.md`.

## Verification executed in this delivery

Same sandbox limitation as every delivery in this conversation: no
outbound network, no `node_modules`, no reachable PostgreSQL — `npm ci`,
`npm test`, `npm run build`, and any real database call were **not**
executed here. One thing that *was* run successfully in this delivery and
is new to this report: `node --check` against every `.ts` file added or
modified across this delivery and the two before it in this conversation,
using this container's Node.js v22.22.2 built-in TypeScript syntax
stripping — confirms no syntax errors in any of them, but is not a
substitute for `tsc`'s real type checker (which could not run here — see
"Environment limitation for this delivery" in the linked report for
exactly why and what it produced instead). Three real bugs were caught
by manual cross-referencing against the actual schema/middleware/lib code
before this report was written, not after; they are listed in the linked
report rather than repeated here.
