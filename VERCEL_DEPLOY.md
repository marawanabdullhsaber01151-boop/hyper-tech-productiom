# Deploying Hyper-Tech ERP on Vercel

This repository is now configured for Vercel's Node.js server runtime. The
`server.mjs` entrypoint starts the compiled Express application, which Vercel
captures and routes requests to. Do not configure an Output Directory: this is
an Express application, not a static-only site.

## Vercel project settings

- **Root Directory:** the directory containing this file and `package.json`
- **Framework Preset:** Other / Express (the committed `vercel.json` sets this)
- **Install Command:** leave it as `npm ci --include=dev` so Vercel installs the
  build tool (`esbuild`) before running the build
- **Build Command:** leave it as `npm run build`
- **Output Directory:** leave empty
- **Node.js version:** 20.x or newer

## Required environment variables

Add these in **Settings → Environment Variables** for Production, Preview, and
Development as appropriate:

| Name | Required value |
| --- | --- |
| `DATABASE_URL` | The Neon pooled PostgreSQL connection string, including SSL settings supplied by Neon. |
| `JWT_SECRET` | A random secret of at least 32 characters. |
| `PORTAL_JWT_SECRET` | A different random secret; recommended to keep customer-portal sessions independent. |
| `JWT_EXPIRES_IN` | Optional; defaults to `7d`. |
| `CORS_ORIGIN` | Optional. Set it only when a separate frontend origin must call this API; use comma-separated origins. |
| `PGSSL_STRICT` | Optional. Set to `true` only if the database certificate chain is fully verifiable by Node. |

Do not add `PORT`: Vercel provides it. Do not commit `.env`.

## Database

Deploying code does not apply schema migrations. Before using production, run
the project's migrations against the same Neon `DATABASE_URL`:

```bash
npm run db:migrate
```

Then redeploy and verify this URL returns HTTP 200:

```text
https://YOUR-VERCEL-DOMAIN/api/v1/health
```
