# Hyper-Tech ERP — Stage 00 / 01 / 02 Delivery

This package contains only the files modified or added while implementing Stages 01 and 02.
It does not contain the full project, node_modules, dist, or generated build output.

## Stage 00 — Discovery and Baseline

- Modified files: none
- Added files: none
- Deleted files: none
- Migrations: none

## Stage 01 — Planning Boundary

### Modified
- src/routes/operations-control.ts
- public/operations.html
- public/JS/operations.js
- public/CSS/operations.css
- src/lib/permissions.ts

### Added
- src/lib/operations-control-policy.ts
- src/lib/operations-control-policy.test.ts
- migrations/0036_operations_planning_boundary.sql

## Stage 02 — Operations Case and Snapshot

### Modified
- src/routes/operations-control.ts (also modified in Stage 01)
- src/db/schema/index.ts
- src/db/schema/sales.ts
- src/routes/sales.ts

### Added
- src/db/schema/operations-manager.ts
- src/lib/operations-intake.ts
- src/lib/operations-intake.test.ts
- src/routes/operations-manager.ts
- src/routes/operations-manager.test.ts
- migrations/0037_operations_cases.sql

## Deleted files

None.

## Validation completed

- npm test: 15 test files passed, 65 tests passed
- npm run build: passed
- npm run test:e2e: configured tests skipped because the integration database environment is not enabled
- No migration was executed against a real database.
