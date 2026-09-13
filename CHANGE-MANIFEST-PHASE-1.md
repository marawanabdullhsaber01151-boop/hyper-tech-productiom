# CHANGE-MANIFEST-PHASE-1.md
## Phase 1 — Deployment Parity & Clean Baseline

## Files deleted
- `railway.json` — legacy Railway deployment config; this project standardizes exclusively on Vercel + Neon (rule 0.2.2).
- `nixpacks.toml` — legacy Railway build config; same reason as above.

## Files modified
- `package.json`
  - `name`: `hyper-tech-erp` → `hyper-tech-production-portal` **(placeholder — no final product name/domain chosen yet, per task instructions)**.
  - `description`: updated to describe the new production-workflow-only system instead of the full ERP.
  - No scripts, dependencies, or the `version` field were changed.
- `.env.example`
  - Removed the Railway-specific comment on `DATABASE_URL` and replaced it with guidance to use a new, independent Neon project's connection string.
  - `PORTAL_PUBLIC_URL` and `CORS_ORIGIN` values replaced with an explicit `REPLACE-WITH-NEW-VERCEL-DOMAIN.vercel.app` placeholder (the old values pointed at the source ERP's live Vercel domain, which this new project must not reuse).
  - No environment variable was added, removed, or renamed — the same set from task 4 is preserved: `DATABASE_URL`, `PORT`, `NODE_ENV`, `JWT_SECRET`, `PORTAL_JWT_SECRET`, `JWT_EXPIRES_IN`, `PORTAL_PUBLIC_URL`, `PORTAL_SUPPORT_PHONE`, `PORTAL_SMS_PROVIDER_*`, `PORTAL_OTP_TTL_MINUTES`, `PORTAL_OTP_MAX_ATTEMPTS`, `CORS_ORIGIN`, `SEED_ADMIN_PASSWORD`.

## Files checked, found already compliant, left untouched
- No `pnpm-lock.yaml`, `yarn.lock`, `.yarnrc*`, or `.npmrc` forcing a different package manager were found anywhere in the repo.
- No `"packageManager"` field was present in `package.json`.
- `vercel.json` was left exactly as-is: `framework: "express"`, `installCommand: "npm ci --include=dev"`, `buildCommand: "npm run build"`, no Output Directory — already correct.

## Explicit confirmation
**No route, schema, domain, or middleware logic file was modified in this phase.** Nothing under `src/routes/`, `src/domain/`, `src/db/`, or `src/middleware/` was touched. Only deployment-config files and project-identity/env-template metadata were changed, as scoped by Phase 1.

## Verification status — IMPORTANT, read before proceeding
This phase's code-level tasks (1–4) are complete. Tasks 5 and 6 (local build/migrate/seed/test verification, and the live Vercel + Neon deployment) **could not be executed from this session**, because the sandbox this assistant runs in has no network access — it cannot reach the npm registry, a Neon database, or Vercel. These steps must be run by you, locally or via a networked environment (e.g. Claude Code on your machine), using the commands below.

### What you need to run locally, in order

```bash
# 1. Install dependencies
npm ci --include=dev

# 2. Build — confirms dist/index.mjs is produced with no errors
npm run build

# 3. Set up your local .env from .env.example, filling in:
#    - DATABASE_URL from your NEW Neon project (pooled connection string)
#    - JWT_SECRET and PORTAL_JWT_SECRET (generate separately, e.g.
#      node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
#    - SEED_ADMIN_PASSWORD (min 8 chars, upper+lower+number)

# 4. Apply all migrations to the new Neon database, in order
npm run db:migrate

# 5. Seed the first admin user
npm run db:seed

# 6. Run locally and verify:
npm run dev
#    - GET  http://localhost:3000/api/v1/health         -> { status: "ok", ... }
#    - POST http://localhost:3000/api/v1/auth/login      -> succeeds with seeded admin
#    - http://localhost:3000/login.html and /index.html load without 404s/console errors

# 7. Run the existing test suite — must pass unmodified
npm test
```

### Vercel + Neon deployment (manual dashboard steps)
1. Create a **new Vercel project** pointing at this repository.
   - Root Directory: repo root
   - Framework Preset: Other/Express (already set via the committed `vercel.json`)
   - Install Command: `npm ci --include=dev` (leave as-is)
   - Build Command: `npm run build` (leave as-is)
   - Output Directory: leave empty
   - Node.js version: 20.x or newer
2. In both the **Production** and **Preview** environment scopes, set every variable from `.env.example`:
   - `DATABASE_URL` — pooled connection string from the new Neon project
   - `PORT` — usually unnecessary on Vercel (it assigns its own), but keep for local parity
   - `NODE_ENV` — `production`
   - `JWT_SECRET` — internal staff auth signing secret
   - `PORTAL_JWT_SECRET` — separate signing secret isolating portal-customer tokens from staff tokens
   - `JWT_EXPIRES_IN` — staff token lifetime (e.g. `7d`)
   - `PORTAL_PUBLIC_URL` — this new deployment's actual assigned domain, once known
   - `PORTAL_SUPPORT_PHONE` — support contact shown to portal customers
   - `PORTAL_SMS_PROVIDER_API_KEY` / `PORTAL_SMS_PROVIDER_URL` / `PORTAL_SMS_FROM` — leave blank (no SMS provider wired yet)
   - `PORTAL_OTP_TTL_MINUTES` / `PORTAL_OTP_MAX_ATTEMPTS` — OTP policy for portal login
   - `CORS_ORIGIN` — same new deployment domain
   - `SEED_ADMIN_PASSWORD` — used only when you next run the seed script
3. After setting variables and deploying, verify:
   - `GET https://<new-vercel-domain>/api/v1/health` → HTTP 200
   - Login page loads and the seeded admin can log in against the live Neon database
4. Confirm migrations were applied to the **same** `DATABASE_URL` the live Vercel deployment uses — migrations do not run automatically during the Vercel build; they must be run manually (step 4 above) against that exact database before/after the first deploy.

## Acceptance criteria status
- [x] No pnpm/yarn artifacts anywhere in the repo (verified — none existed).
- [ ] `npm ci --include=dev && npm run build` succeeds — **pending, run locally** (no network access in this session).
- [ ] `npm test` passes unmodified — **pending, run locally**.
- [ ] Migrations applied cleanly to the new Neon database — **pending, requires your Neon credentials**.
- [ ] Seeded admin can log in locally and on the live Vercel deployment — **pending**.
- [ ] `GET /api/v1/health` returns 200 on the live deployment — **pending**.
- [x] `CHANGE-MANIFEST-PHASE-1.md` exists and is accurate (this file).

**Once you run the verification commands above and confirm they pass, tell me and we'll mark Phase 1 fully done and move to Phase 2.**
