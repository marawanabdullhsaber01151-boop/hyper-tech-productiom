# CHANGE-MANIFEST-PHASE-4.md
## Phase 4 — Operations Manager Production-Line Claim Gate

## Scope delivered

Phase 4 adds a mandatory, per-production-line Operations Manager gate. A line
is created in `awaiting_operations_claim`; either portal sales can push it
forward during confirmation or an Operations Manager can claim it from the
Operations Manager portal. Both paths use the same compare-and-set database
update, so only one actor can win a race.

## New files

- `migrations/0052_phase4_operations_claim_gate.sql` — adds claim ownership
  columns, the partial waiting-line index, the new default status, and moves
  legacy `new` rows into the explicit gate.
- `src/lib/operations-claim.ts` — shared atomic claim service, conflict
  response (`409` / `OPERATIONS_LINE_ALREADY_CLAIMED`), and transaction-scoped
  `audit_events` write.
- `src/lib/operations-claim.test.ts` — concurrent simulated sales/Operations
  Manager attempts; asserts exactly one winner, one clear loser, one owner,
  and one audit event.
- `src/routes/production-workflow.masking.test.ts` — raw parsed-response
  assertions for the factory-floor PII boundary.

## Files modified

### Production workflow and database

- `src/db/schema/production-workflow.ts` — adds
  `claimedById`, `claimedByName`, `claimedAt`, and makes the Phase 4 waiting
  status the schema default.
- `src/domain/production-status.ts` — adds
  `awaiting_operations_claim` and `claimed`, including the only valid path
  from the gate to `materials_requested`.
- `src/routes/production-workflow.ts` — creates lines in the waiting state,
  allows production receipt only after `claimed`, includes the new dashboard
  statuses, notifies Operations Manager at intake, and applies serialization
  masking to every response from this router.
- `src/routes/production-requests.ts` — direct production-request approvals
  now create waiting lines and notify Operations Manager instead of bypassing
  the gate.
- `src/routes/portal.ts` — portal-created lines start at the gate and notify
  Operations Manager.
- `src/routes/portal-orders.ts` — confirmation uses the shared atomic claim
  path for portal sales, adds an explicit per-line sales claim endpoint, and
  sends the required Operations Manager / production notifications without
  leaking customer data to factory roles.

### Operations Manager portal

- `src/routes/operations-manager.ts` — adds
  `GET /operations-manager/production-orders` and
  `POST /operations-manager/production-orders/:id/claim`, with sales-facing
  notifications after a successful Operations Manager claim.
- `public/operations-manager.html` — adds the production-line gate panel.
- `public/JS/operations-manager.js` — loads waiting/claimed lines, renders
  ownership, and handles claim/conflict refresh behavior.

### Serialization and tests

- `src/lib/fieldMasking.ts` — adds the production workflow serialization
  boundary for `production_manager`, `supervisor`,
  `production_controller`, and `production_quality_controller`; Operations
  Manager, sales, chairman, and executive roles retain full fields.
- `src/lib/fieldMasking.test.ts` — verifies raw JSON has no customer name,
  phone, email, address, or portal customer identifier for each protected
  role and preserves fields for allowed roles.
- `src/routes/operations-control.ts` — applies the same serialization
  boundary to operations-control responses.
- `src/domain/production-status.test.ts` — updates the canonical transition
  test for the new gate.

## Explicit decisions

1. The ownership boundary lives on `production_workflow_orders`, because each
   product line already has an independent lifecycle and `salesOrderRef`
   groups lines without making them one workflow row.
2. Portal sales confirmation claims only lines still waiting. If Operations
   Manager won first, confirmation remains valid and preserves that owner.
3. The losing claimant receives a `409` with the winner name and claim time;
   no silent retry or overwrite is allowed.
4. Audit and ownership update execute in the same transaction. Notifications
   execute after commit, so a failed transaction cannot announce a claim that
   did not persist.
5. PII masking is applied by wrapping `res.json` inside the production and
   operations-control routers. This covers list, detail, dashboard, and
   mutation responses instead of relying on individual handlers to remember
   masking.

## Verification status

The project instructions prohibit installing dependencies, running migrations,
connecting to Neon/Vercel, or running build/test commands in this session.

- [ ] `npm run build`
- [ ] `npm run db:migrate`
- [ ] `npm test`
- [ ] Manual race check against the deployed PostgreSQL database
- [ ] Manual click-through of Operations Manager → بوابة استلام سطور الإنتاج

No files are scheduled for deletion.