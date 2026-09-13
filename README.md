<!-- @format -->

# Hyper-Tech Production Portal

_(placeholder name — no final product name/domain has been chosen yet)_

A B2B order-to-production workflow system: customer portal (browse, order,
track) on one side, and an internal staff workflow (intake → production →
quality → dispatch) on the other. Built with Express + TypeScript +
PostgreSQL (Drizzle ORM).

This system intentionally carries **no accounting, payments, HR, or general
purchasing logic**. It tracks the physical and procedural flow of an order
through production — not money. See `production-portal-build-prompts.md`
(if present in your working copy) for the full phased build specification
this codebase is being developed against.

## Status

This codebase is under active, phased reconstruction from a larger source
ERP system. Each phase's exact scope and the changes made are recorded in
its own `CHANGE-MANIFEST-PHASE-N.md` file at the repo root — read those
before assuming what does or doesn't exist yet.

## Stack

- **Backend:** Express + TypeScript, PostgreSQL via Drizzle ORM
- **Frontend:** static HTML/CSS/vanilla JS served from `public/`
- **Hosting:** Vercel (API + static assets) + Neon (PostgreSQL)
- **Migrations:** plain SQL files in `migrations/`, applied in filename
  order via `npm run db:migrate` (see that script for why this project does
  not use `drizzle-kit migrate` directly)

## Local setup

```bash
npm ci --include=dev
cp .env.example .env   # fill in DATABASE_URL and the secrets described there
npm run build
npm run db:migrate
npm run db:seed        # creates the first admin user
npm run dev
```

Then visit `http://localhost:3000/login.html` (staff) or
`http://localhost:3000/portal.html` (customer portal).

## Tests

```bash
npm test
```
