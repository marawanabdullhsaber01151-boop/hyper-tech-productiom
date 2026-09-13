# CHANGE-MANIFEST-PHASE-2.md
## Phase 2 — Purge Accounting, HR, and General Purchasing

## Method
Before deleting anything, every file/table slated for removal was grepped
across the entire `src/` and `public/` trees to find external callers
(Task 1). Several non-obvious cross-references turned up; see
"Cross-reference resolutions" below. Everything in this phase is a
subtraction or a cleanup of a dangling reference to a subtraction —
no new business logic or capability was added.

## Files deleted
- `src/routes/accounting.ts`, `src/routes/hr.ts`, `src/routes/reports.ts`,
  `src/routes/admin-vault.ts`, `src/routes/purchases.ts`
- `src/db/schema/accounting.ts`, `src/db/schema/hr.ts`, `src/db/schema/purchases.ts`
- `src/lib/contactBalance.ts`, root-level `contactBalance.js`
- `src/lib/purchase-receiving.ts` (only ever called by the now-deleted
  `purchases.ts` and by the purchase-order approval branch removed from
  `governance.ts`, below)
- `public/accounting.html`, `public/hr.html`, `public/purchases.html`,
  `public/reports.html`, `public/secure-vault.html`
- `public/JS/accounting.js`, `public/JS/hr.js`, `public/JS/purchases.js`,
  `public/JS/reports.js`, `public/JS/secure-vault.js`

## Files modified
- **`src/main.ts`** — removed the imports and `apiRouter.use(...)` mounts
  for all five deleted routers.
- **`src/db/schema/index.ts`** — removed the barrel `export * from` lines
  for `./accounting`, `./hr`, `./purchases`.
- **`src/lib/departments.ts`** (nav data) — removed the whole "المشتريات"
  (purchasing) and "الموارد البشرية والحسابات" (hr-accounting) top-level
  department groups, and the "الخزنة الآمنة" (secure vault) page entry
  under governance. Left as-is: `purchasing_manager`/`buyer`/`hr`/
  `hr_manager` still exist as *roles* referenced elsewhere (e.g. as viewer
  roles on sales/contacts pages) — deciding whether those roles themselves
  should be retired is outside this phase's scope.
- **`src/lib/wipe.ts`, `src/lib/backup.ts`** — removed references to the six
  dropped tables from the "wipe everything" and "export/import all tables"
  utilities.
- **`src/routes/settings.ts`** — removed `purchases`/`employees`/
  `accounting` counters from the system-stats endpoint.
- **`src/routes/dashboard.ts`** — removed the `purchases`, `financial`
  (income/expenses/netProfit), and `hr` (employee counts) widgets, per
  Task 4's explicit instruction. Kept inventory, sales-order-count,
  production, and quality widgets unchanged.
- **`src/routes/governance.ts`** — removed the entire `purchase_order`
  approval-rollback branch (depended on `purchaseOrdersTable` and
  `purchase-receiving.ts`) and both `adjustContactBalance` calls in the
  `sales_order` rejection branch. Stock-reversal logic on rejection is
  untouched.
- **`src/routes/sales.ts`** — removed all 5 call sites that adjusted a
  customer's accounts-receivable balance or asserted a credit limit
  (on order creation, item add, item delete, item-total correction, and
  order cancellation), and the two "increaseBalance"/"decreaseBalance"
  effect branches in `applySalesTransitionPlan`. All stock
  reservation/release logic and the rest of the order lifecycle is
  unchanged.
- **`src/routes/contacts.ts`** + **`src/db/schema/contacts.ts`** — removed
  `contactLedgerTable`, the `openingBalance`/`openingBalanceNote` fields
  from `createContactSchema`, the `POST /contacts/:id/balance-adjustment`
  endpoint, and the `GET /contacts/:id/ledger` endpoint.
- **`src/routes/portal.ts`** — removed the entire customer-facing
  `/portal/finance/summary` and `/portal/finance/statement` endpoints and
  their six now-orphaned date/formatting helper functions, plus the dead
  `contactLedgerTable` import and two now-unused drizzle-orm operators
  (`gte`, `lt`).
- **`public/JS/portal.js`, `public/portal.html`** — removed the matching
  frontend: the header "كشف الحساب" button, the account-panel finance
  card (`renderFinanceSummary`), the whole statement modal and its JS
  (`openFinanceStatement`, `loadFinanceStatement`, `closeFinanceStatement`,
  and their date-range helpers), and all related event-listener wiring.
- **`public/JS/enhancements.js`** — `purchasing_manager`/`buyer` no longer
  point at the deleted `purchases.html` in the role→home-page map; they
  now point at `index.html` until Phase 5 adds a minimal purchase-request
  page.
- **`public/settings.html`, `public/JS/settings.js`** — removed the
  "الخزنة وسلة المهملات" (vault & trash) sidebar link and the export/
  import-backup and full-wipe cards (all pointed at the deleted
  `secure-vault.html`). Kept the client-side "clear cache" card, which
  never depended on that route.
- **`public/index.html`, `public/JS/index.js`** — removed the "تقرير"
  quick-action button (→ deleted `reports.html`) and the "المحاسبة" link
  (→ deleted `accounting.html`). Renamed the dashboard's "نظرة مالية
  وجودة سريعة" widget to "نظرة تشغيلية وجودة سريعة" and removed its
  "صافي الربح" (net profit) card, since that number no longer exists on
  the backend. Quality pass-rate/trend, sales-order count, and the
  low-stock watchlist are unchanged.
- **`README.md`** — replaced (the previous one was stale delivery notes
  from an unrelated earlier portal-auth task, with its own conflicting
  "Phase 1/Phase 2" numbering). New README describes the current project
  identity, stack, and local setup.

## New migration
- `migrations/0049_phase2_drop_accounting_hr_purchases.sql` — drops
  `contact_ledger`, `purchase_order_items`, `purchase_orders`,
  `attendance_logs`, `employees`, `accounting_transactions`. All drops use
  `IF EXISTS`; safe to re-run. **Not yet applied** — see "Verification
  status" below.

## Cross-reference resolutions (the real judgment calls in this phase)
1. **`sales.ts`/`contacts.ts` are NOT accounting modules and were kept.**
   They weren't on either the explicit removal or keep list in the prompt,
   but grepping showed `salesOrdersTable` is the core order record used by
   `operations-manager.ts`, `portal-orders.ts`, `production-workflow.ts`,
   `dashboard.ts`, and `governance.ts` — it's the backbone of the
   production workflow, not an accounting artifact. `contacts.ts` is core
   CRM data used the same way. Deleting either would have broken the
   entire kept workflow.
2. **`contactBalance.ts` (explicitly listed for removal) was load-bearing
   in those two kept files, plus `governance.ts`.** It's a genuine
   accounts-receivable/credit-limit ledger — banned by the "no accounting
   logic" rule regardless of which file imports it. Resolution: delete
   the library, and surgically remove all 9 call sites across the three
   files rather than leaving them broken or keeping the library around.
3. **`portal.ts` had its own dependency on `contactLedgerTable`** — a
   customer-facing "finance summary + account statement" feature — that a
   plain grep for `contactBalance` (the library name) did not surface,
   because it queried the table directly. Found this on the second,
   table-name-based sweep. Since it's a customer balance/statement
   feature, it falls under the same "no accounting logic" rule and was
   removed along with its frontend (button, modal, JS).
4. **`purchase-receiving.ts`** was only called from the deleted
   `purchases.ts` and from the purchase-order branch of `governance.ts`'s
   approval flow — both gone now, so the file itself was deleted rather
   than left as dead code.
5. **Trash browsing/restore had no other home.** `admin-vault.ts` (deleted
   per the explicit list) was not purely a "secure vault for
   backup/wipe" — it was also the *only* API surface for `GET
   /vault/trash` and `POST /vault/trash/:id/restore` (browsing and
   un-deleting soft-deleted records). Deleting it as instructed means
   **there is currently no way to browse or restore trashed items**
   through any route or page, even though `moveToTrash`/`restoreFromTrash`
   (in `src/lib/trash.ts`) and the `trash` table itself are untouched and
   still populated on every delete. `wipeEverythingExcept` (`wipe.ts`) and
   `exportAllTables`/`importAllTables` (`backup.ts`) are now dead code
   with zero callers, for the same reason. **This needs a decision**:
   leave trash-restore inaccessible for now, or add a plain (non-vault-
   gated) trash endpoint in a later phase.
6. **`contactsTable.balance` and `.creditLimit` columns were left in
   place** rather than dropped. Every code path that wrote to them is now
   gone, so they're inert/historical, but the prompt's removal list named
   `contactBalance.ts`/`.js` specifically, not these columns, and dropping
   them is a one-way migration. **Flagging as an open question** rather
   than deciding unilaterally — let me know if you want a follow-up
   migration to drop them too.
7. **"Hyper-Tech ERP" branding was left in place in several spots** —
   code comments (harmless), `settings.js`'s default company-name field
   (`name`/`nameEn`, which is business identity data, not a hardcoded
   page title), and printed invoice/report template headers/footers in
   `sales.js`/`movements.js`/`material.js`. None of the browser-tab
   `<title>` elements said "ERP" to begin with (they already say "هايبر
   تك"), so the rebrand task's actual goal was already satisfied there.
   Renaming the registered business name across printed documents felt
   like a business decision outside this phase's scope — flagging it
   rather than changing it silently.

## Explicit confirmation
No route, schema, domain, or middleware file **outside the ones listed
above** was touched. Everything else in Phase 1's "keep" list (portal*,
foundation, inventory, production-workflow/execution/cycle, quality,
engineering, operations*, movements, notifications, governance, settings,
auth, dashboard, nav, state) is untouched except for the specific,
itemized removals of dead references documented above.

## Verification status — IMPORTANT, same limitation as Phase 1
This session has no network access, so none of the following could be run
here. Please run these locally before we call Phase 2 done:

```bash
npm ci --include=dev      # if not already done in Phase 1
npm run build             # confirms no import/reference errors anywhere above
npm run db:migrate        # applies migration 0049 against your Neon database
npm test                  # confirms nothing in the existing suite broke —
                           # pay special attention to any sales.ts / contacts.ts /
                           # governance.ts / portal.ts tests, since those are
                           # the files that got surgery rather than deletion
```

Also worth a manual click-through once deployed: log in as `chairman`,
open Settings (confirm the vault link and backup cards are gone and
nothing 404s), open the dashboard (confirm the renamed operational
widget renders without errors), and open the customer portal account
panel (confirm it loads without the old finance card and without
JS console errors).

## Acceptance criteria status
- [x] No lingering references to any deleted table/route/file anywhere in
      `src/` or `public/` (verified by repo-wide grep — see above).
- [x] Cross-reference resolutions documented (this file, section above).
- [ ] `npm run build` succeeds — **pending, run locally** (no network here).
- [ ] `npm test` passes unmodified — **pending, run locally**.
- [ ] Migration 0049 applied cleanly to Neon — **pending, requires your
      credentials**.
- [x] `CHANGE-MANIFEST-PHASE-2.md` exists and is accurate (this file).

**Once you run the verification commands above and confirm they pass —
and let me know your call on the two open questions (trash-restore
access, and the inert `balance`/`creditLimit` columns) — tell me and
we'll move to Phase 3.**
