# Hyper-Tech ERP — Operations Control stages 00–03 delivery

This package contains only the files modified or added for the stages 00–03 hardening pass. Copy the archive contents over the existing project root while preserving paths.

## Modified files

- `migrations/0037_operations_cases.sql`
- `public/CSS/operations-manager.css`
- `public/JS/operations-manager.js`
- `public/operations.html`
- `src/db/schema/sales.ts`
- `src/lib/actionRegistry.test.ts`
- `src/lib/actionRegistry.ts`
- `src/lib/operations-intake.test.ts`
- `src/lib/operations-intake.ts`
- `src/lib/permissions.ts`
- `src/routes/operations-control.ts`
- `src/routes/operations-manager.test.ts`
- `src/routes/operations-manager.ts`

## New files

- `migrations/0038_operations_stage_00_03_hardening.sql`
- `public/operations-manager.html`
- `src/lib/decimal-quantity.test.ts`
- `src/lib/decimal-quantity.ts`

## Included behavior

- Operations Control remains planning-only: no stock mutation, reservations, production orders, purchase orders, or plan execution.
- Sales Order intake validates status, quantities, units, conversion factors, revision, and immutable snapshots.
- Inbox ordering is due date, priority, then waiting age; list responses include line count and ordered quantity total.
- Validation is explicit: `received -> under_validation -> analysis_ready`, with optimistic locking and audit events.
- Analysis and Draft Plan routes use permissions; legacy `execute-plan` remains deprecated and returns `410`.
- Decimal quantity arithmetic uses scaled `BigInt` calculations rather than JavaScript floating point.

## Routes added or changed

- `POST /operations-manager/cases/:id/complete-validation`
- `GET /operations-manager/cases`
- `POST /operations-manager/cases/from-sales-order/:salesOrderId`
- `POST /operations-manager/cases/:id/start-validation`
- Operations Control analysis and Draft Plan routes now enforce permissions.
- `POST /operations-control/sales-orders/:id/execute-plan` remains closed with `410`.

## Verification

- `npm test`: 16 test files, 69 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- `node --check public/JS/operations-manager.js`: passed.
- No migration was run against a real PostgreSQL database; no connected database was available.

Stages 04–16 remain outside this package and were not implemented.
