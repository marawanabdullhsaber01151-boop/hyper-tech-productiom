# Phase 00 Baseline Audit

Generated from repository inspection by `scripts/phase0-baseline-audit.mjs`.

## Verification boundary

- Static repository audit: **complete**
- PostgreSQL schema/data verification: **not verified — DATABASE_URL is absent**
- Authenticated end-to-end verification: **blocked until DATABASE_URL is configured**
- Overall Phase 00 closure: **not closable as 100% because live checks are unavailable**

## Inventory counts

| Surface | Count |
|---|---:|
| API route declarations | 253 |
| Public HTML pages | 32 |
| Drizzle schema tables | 78 |
| Ordered SQL migrations | 54 |
| Declared roles | 18 |
| Fine-grained action definitions | 33 |
| Test files | 29 |

## Static findings

- Duplicate route declarations: **0**
- Duplicate schema table definitions: **0**
- Frontend roles not present in `USER_ROLES`: **0**
- Route modules not directly detected as mounted in `src/main.ts`: **1**
- Intentional legacy/unmounted route modules: **1**
- Unexpected unmounted route modules: **0**
- Schema tables without a migration CREATE match: **21**
- Those tables are supplied by the canonical drizzle baseline and bootstrapped by the migration runner: **40**
- Schema tables without any baseline or migration delivery source: **1**
- Migration-created tables without a Drizzle schema definition: **0**

The complete machine-readable inventory, including file/line evidence, is in
`docs/audits/phase-00-baseline-inventory.json`.
