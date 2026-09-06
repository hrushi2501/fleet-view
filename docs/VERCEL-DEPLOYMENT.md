# Deploy FleetView on Vercel

The production stack is **Vercel + the existing Supabase database + private Vercel Blob**.
No Docker, VM, terminal daemon, or separately hosted worker is required. Vercel Cron
runs the existing scheduled tasks, including the Fleet Edge pull every minute.

Use a **Vercel Pro team** for this deployment. Hobby does not support the configured
minute-by-minute cron. Do not downgrade it to daily: Fleet Edge snapshots cannot
backfill missed readings. See [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## First deployment: import, configure, deploy

1. In Vercel, choose **Add New → Project**, import this Git repository, and leave
   **Root Directory** at the repository root. The committed configuration selects
   Next.js, Node 24, `npm ci`, the build command, Mumbai region, and both cron jobs.
   Leave Output Directory at the framework default. No custom start command.
2. Add these **Production** environment variables before clicking Deploy:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Existing Supabase transaction-pooler connection string, port 6543, with `?pgbouncer=true&connection_limit=1`. Preserve any existing parameters using `&`. URL-encode special characters in the password. |
   | `AUTH_SECRET` | Existing production secret, or a new unique random secret of at least 32 bytes for a first deployment. |
   | `CRON_SECRET` | A different random secret of at least 32 bytes. Vercel automatically sends it as a bearer token to cron handlers. |

   To generate a new secret, run `openssl rand -base64 48` locally; run it twice for
   two different values. Save them privately. Do not rotate `AUTH_SECRET` on every
   deploy: rotating it signs everyone out. The name is `AUTH_SECRET`, not `SESSION_SECRET`.
3. Connect a **private Vercel Blob store** to this project in Storage for existing
   evidence/document uploads. Vercel supplies `BLOB_READ_WRITE_TOKEN`. For the
   existing integrations, copy the relevant values from your current deployment:

   | Existing function | Settings |
   | --- | --- |
   | Fleet Edge pull | `TATA_FLEET_EDGE_ENABLED=true`, `TATA_FLEET_EDGE_CLIENT_ID`, `TATA_FLEET_EDGE_CLIENT_SECRET`; copy any provider URL/path overrides from `.env.example` or the current deployment. |
   | Fleet Edge push | `TATA_PUSH_URL_TOKEN`; register `https://YOUR_PRODUCTION_DOMAIN/api/telematics/tata?token=YOUR_TOKEN` with Tata. Keep this URL secret. |
   | Device telemetry push | `FLEET_INGEST_KEY` |
   | Photo reading | `GOOGLE_GENERATIVE_AI_API_KEY`; without it, manual entry remains available. |
   | Browser notifications | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; preserve existing keys to preserve subscriptions. |

   Leave `TATA_FLEET_EDGE_AUTO_SYNC` and `TATA_PUSH_TRUST_ANY` unset. You do not run
   `worker:telematics` on Vercel. Other optional settings are listed in `.env.example`.
4. Click **Deploy**. The build validates settings with readable errors (never secret
   values), generates Prisma Client, and builds Next.js with Webpack. It does **not**
   migrate, seed, wipe, import, or sync the production database.
5. Open the production URL, sign in with an existing account, and confirm a real
   asset and its documents load. In Vercel's Cron Jobs view, check that
   `/api/telematics/sync` runs successfully and that new provider readings arrive.
   `/api/push/cron` runs daily at **08:30 IST** (03:00 UTC). Test an authorized
   document upload and a notification subscription if those integrations are enabled.

After setup, a push to the configured production branch triggers deployment.
Environment changes require a redeploy. No Docker commands or manual worker restart.

## Existing database, not a demo reset

For this live project, reuse the existing database and accounts. You do not need
`DATABASE_URL_UNPOOLED` or database-owner credentials in Vercel runtime settings.
Privileged schema operations belong in a separate operator workflow.

Before releasing changes that touch database access, run `npm run db:check` locally
against the intended database. This is read-only and checks table/column parity;
it does not prove indexes, RLS, or every workflow. The Vercel build runs the same
read-only gate before compiling, so a missing database column blocks deployment
instead of becoming a runtime page error. RLS checks and privileged changes are
covered in [Security operations](SECURITY-OPERATIONS.md).

### Additive fuel-evidence schema update

This revision adds the optional post-fill dashboard evidence field. **Before** its
first Vercel deployment, an operator with database-owner access must apply the
reviewed, additive SQL once:

```bash
node --env-file=.env.local scripts/run-sql-file.mjs prisma/sql/add-fuel-refuelling-evidence.sql
npm run db:check
npm run db:rls:verify
```

Run that against the intended production database only after confirming the
connection string. The deployment intentionally does not run migrations; applying
the column first makes the code rollout safe and keeps Vercel runtime credentials
unprivileged. The dashboard-before, pump, and dashboard-after photos remain
optional verification evidence, so fuel logging itself never depends on a camera.

An empty Supabase database is **not** initialized by deployment. Provision its schema,
access controls, and first administrator through a reviewed one-time setup. Never run
`npm run setup`, demo seeds, `db:clean-and-sync`, or `prisma/import-mcc.mjs` as a Vercel
build command or against this live database to resolve a deployment error.

## Safe previews

Use a separate non-production database and Blob store for Preview deployments,
a separate `AUTH_SECRET`, and disable live Tata integrations. Do not give feature
branches production credentials. Vercel schedules cron jobs on production only;
previews do not need the production `CRON_SECRET`. Do not register a preview URL
as Tata's callback. See [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Troubleshooting

| Build/runtime message | Fix |
| --- | --- |
| Deployment configuration error | Correct the named environment variable and redeploy. `npm run deploy:check` runs the same check locally without changing data. |
| Cron schedule rejected | Import into a Pro team; the current schedule exceeds Hobby limits. |
| Database unreachable / login fails | Check Supabase is running, pooler credentials and network restrictions are correct, and the database schema exists. Configuration checks do not test connectivity. |
| Sync returns 401 | Set the production `CRON_SECRET`, redeploy, and test through Vercel Cron, not an unauthenticated browser tab. |
| Sync returns `skipped` | Check `TATA_FLEET_EDGE_ENABLED=true` and the provider credentials. A 200 response marked skipped does not mean readings were received. |
| Evidence upload unavailable | Connect a private Blob store to the correct environment and redeploy. |
| Settings fixed but old behavior persists | Redeploy; Vercel environment edits do not update already deployed functions. |

Node 24 is pinned in `package.json` and `.nvmrc`; it is a
[supported Vercel runtime](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
For local verification: `nvm use`, `npm ci`, `npm run check`, `npm run deploy:check`,
then `npm run build`. These checks require no Docker.
