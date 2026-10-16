# CHANGE MANIFEST — PHASE 02 / DELIVERY 1

## Added

- `src/domain/production-lifecycle.ts`
- `src/domain/production-lifecycle.test.ts`
- `src/db/schema/production-lifecycle.ts`
- `src/lib/production-lifecycle.ts`
- `migrations/0055_phase2_canonical_production_domain.sql`
- `docs/reports/phase-02-canonical-domain-part-1.md`
- `CHANGE-MANIFEST-PHASE-2-PART-1.md`

## Modified

- `src/db/schema/index.ts`
- `src/db/schema/production-workflow.ts`
- `src/db/schema/operations-manager.ts`
- `src/domain/production-status.ts`
- `src/routes/production-workflow.ts`
- `src/routes/production-requests.ts`
- `src/lib/operations-claim.ts`

## Not included yet

The second delivery will add the mutation/API integration, legacy audit
reconciliation, lifecycle commands, UI, and high-assurance tests.

Completed by `docs/reports/phase-02-canonical-domain-part-2.md` and the exact
change manifest in that report.

## Contract

Only files added or modified for this delivery are included in the delivery
archive. Unchanged project files are intentionally not resent.