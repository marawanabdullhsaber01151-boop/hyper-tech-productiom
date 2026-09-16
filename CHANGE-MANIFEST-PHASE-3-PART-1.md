# CHANGE-MANIFEST — PHASE 03 / DELIVERY 1

## Added

```text
scripts/foundation-reconciliation-audit.mjs
src/lib/foundation-reconciliation.ts
src/lib/foundation-reconciliation.test.ts
docs/reports/phase-03-foundation-part-1.md
```

## Modified

```text
package.json
```

## Deleted

```text
None
```

## Delivery method

This is a delta delivery. Extract the archive over the existing project root;
do not extract it into a nested directory. Unchanged project files are not
included.

## Verification

Confirmed locally before delivery:

```text
npx tsc --noEmit       passed
npm run build          passed
npm test               29 files, 171 passed, 3 skipped
node --check           passed for the new audit script
npm run check:repository passed; 56 migrations, no blockers
```

## Database execution

The audit was not executed against PostgreSQL because this workspace has no
`DATABASE_URL`. After backup and migration on the target database:

```bash
npm run db:preflight
npm run db:migrate
npm run audit:foundation
```

The default audit is report-only. The optional `--apply` mode only fills
`inventory_items.foundation_item_id` where `inventory_items.code` exactly
matches one unique `foundation_items.code`; it never overwrites existing links
or deletes data:

```bash
npm run audit:foundation -- --apply
```