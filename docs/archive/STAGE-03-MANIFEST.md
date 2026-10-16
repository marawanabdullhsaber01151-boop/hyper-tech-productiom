# Hyper-Tech ERP — Stage 03 Changed Files

This package contains only the files modified or added for Stage 03: Operations Manager Inbox and permissions.

## Modified files

- `src/routes/operations-manager.ts`
- `src/lib/permissions.ts`
- `src/middleware/auth.ts`
- `src/routes/operations-manager.test.ts`
- `public/operations.html`

## Added files

- `public/JS/operations-manager.js`
- `public/CSS/operations-manager.css`

## Database

- No migration was added or executed.
- Risk level is calculated server-side from the existing due date and case status.

## Verification

- `npm test`: 15 test files passed, 66 tests passed.
- `npm run build`: passed.
- `npm run test:e2e`: 1 file and 2 tests skipped because no integration environment was configured.

## Included functionality

- Server-side pagination.
- Search by case number, sales order number, and customer name.
- Filters for status, priority, due dates, risk level, assigned user, and overdue cases.
- Permission-based access using `operations.case.view` and `operations.case.edit`.
- Operations Manager Inbox UI with case details.
- No production batch, cost, or transfer tools displayed in the planning screen.
