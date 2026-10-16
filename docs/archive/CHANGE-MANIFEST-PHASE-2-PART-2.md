# CHANGE-MANIFEST — PHASE 02 / DELIVERY 2

## Added

```text
migrations/0056_phase2_lifecycle_controls.sql
scripts/phase2-lifecycle-audit.mjs
src/lib/production-lifecycle-transition.ts
src/routes/production-lifecycle.ts
docs/reports/phase-02-canonical-domain-part-2.md
```

## Modified

```text
CHANGE-MANIFEST-PHASE-2-PART-1.md
docs/PROJECT_STATUS.md
public/JS/production.js
public/CSS/production.css
src/db/schema/production-lifecycle.ts
src/domain/production-lifecycle.ts
src/domain/production-lifecycle.test.ts
src/lib/operations-claim.ts
src/main.ts
```

## Deleted

```text
None
```

## Delivery method

This is a delta delivery. Copy the archive contents over the existing project
root; do not extract it into a nested project directory. The archive contains
only added or modified files and does not replace unchanged project files.

Run from the project root:

```bash
npm ci
npm run db:preflight
npm run db:migrate
npm test
npm run build
```

Before `--apply`, take a database backup and run:

```bash
node scripts/phase2-lifecycle-audit.mjs
```

Only after reviewing the JSON report:

```bash
node scripts/phase2-lifecycle-audit.mjs --apply
```

No database-backed command is marked as passed in this archive because the
source package did not contain `DATABASE_URL`.