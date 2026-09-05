# FleetView ERP — Mahadev Constructions

Vehicle & fleet management for road construction and infrastructure. **This is a live
system carrying a real client's commercial data** — 53 vehicles, their compliance
documents, and live telemetry from a Tata Fleet Edge subscription. It is not a demo,
and it is not seeded with sample data.

An earlier version of this file described a trial build with demo logins and seeded
demo data. Both are gone. Nothing you see in the app is invented.

## Stack

- **Next.js 16** (App Router, Webpack builds) · **React 19** · **TypeScript**
- **Prisma 6** · **PostgreSQL** (Supabase, transaction-mode pooler)
- **Tailwind v4** · Recharts · lucide-react
- **Vercel** (region `bom1`), Fleet Edge cron every minute

## Deploy on Vercel

Follow the [Vercel deployment guide](docs/VERCEL-DEPLOYMENT.md): import the repo
into a Pro team, add the database/auth/cron settings, connect private Blob storage,
and deploy. Node and build settings are committed. **No Docker or separate worker
server is required.** Existing integrations and preview isolation are covered there.

## Getting set up

```bash
nvm use               # Node 24, matching Vercel
npm ci                # also generates Prisma Client
npm run dev            # http://localhost:3000
```

You need a `.env.local`. It is gitignored and never committed — ask for the values.

| Variable | Required | What breaks without it |
|---|---|---|
| `DATABASE_URL` | yes | Nothing runs. Pooled URL, keep `?pgbouncer=true&connection_limit=1` |
| `DATABASE_URL_UNPOOLED` | operator only | Privileged schema operations; not required in Vercel runtime |
| `AUTH_SECRET` | production | Browser sessions cannot be issued safely |
| `TATA_FLEET_EDGE_*` | for telemetry | Vehicle tracking, fuel analysis |
| `TATA_PUSH_URL_TOKEN` | for Tata push | Strong provider-compatible webhook authentication |
| `FLEET_INGEST_KEY` | for device push | `/api/telematics` fails closed with 503 |
| `CRON_SECRET` | for cron | Scheduled sync returns 401 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | for photo reading | OCR degrades to manual entry (gracefully) |
| `BLOB_READ_WRITE_TOKEN` | for uploads | Evidence and document uploads fail safely |
| `BUSINESS_TIMEZONE` | no (defaults `Asia/Kolkata`) | Dates land in the wrong day/month |

**Do not run `prisma/import-mcc.mjs`.** It begins by deleting every asset, driver and
project. It was written to clear demo data on an empty system. Running it now
cascade-deletes the tracked vehicle and its telemetry history, which **cannot be
re-fetched** — the provider only ever returns a vehicle's *current* state.

## Checks

```bash
npm test        # unit tests (node's runner, no framework)
npm run check   # lint + typecheck + tests
npm run build
npm run deploy:check # validates Vercel settings without changing services
npm run db:check # verifies Prisma's runtime tables and columns against the DB
```

## Security operations

Production deployment, webhook registration, RLS verification, monitoring,
backup restore checks, and VAPID rotation are documented in
[Security operations](docs/SECURITY-OPERATIONS.md). Run `npm run db:rls` after
every production schema change; it applies and verifies the Supabase public API
deny-all boundary.

## How this codebase thinks

Five conventions run through everything. Breaking them is how the numbers stop being
trustworthy, which for this client is the whole product.

**1. A wrong number is worse than no number.** Where data cannot support a figure, the
UI shows `—` and says why. A percentage that cannot be computed returns `null`, never
`0` — a workshop with no jobs has not achieved 0% preventive discipline, and a person
nobody marked is not absent. See `fleet-analytics.ts`.

**2. Missing is never zero.** `?? 0` on a measurement turns *unknown* into a confident
reading. It has caused fabricated fuel-theft cases here before.

**3. Backend is complicated, frontend is simple.** All calculation, validation and
aggregation is server-side. The frontend displays results; it does not recompute them.
Terms like *telemetry*, *anomaly*, *TCO* stay in the code and never reach a screen a
site supervisor uses — see `TERMS` in `navigation.ts`.

**4. Authorisation is `ROLE → PERMISSIONS → DATA ACCESS → FRONTEND`, all server-side.**
Every page calls `requirePage()`; every API calls `requireApi()`; every query applies
`assetScope()` / `projectIdScope()`. Hiding a menu item is not access control. Three
bands: Admin, Supervisor, Driver.

**5. Dates use the business timezone, never the server's.** Vercel runs UTC, the client
works in IST. Use `businessDay()` / `businessMonth()` from `business-time.ts` — never
`toISOString().slice(0,10)`.

## Layout

```
src/app/(app)/       nine modules: dashboard, fleet, fuel, people, sites,
                     maintenance, compliance, reports, admin
src/app/(app)/my/    the driver app — scoped to their own vehicle only
src/app/api/         REST + ingest + cron
src/lib/             calculations, access control, provider adapters
  access.ts          who may see what, and which rows
  fleet-analytics.ts fuel, mileage, distance, confidence scoring
  navigation.ts      the nine modules + plain-language term map
prisma/schema.prisma the data model
```

Merged pages keep their sections in `_sections/` and appear as `?tab=` views, so each
stays addressable and only the selected one queries the database.

## Before you change a calculation

Read the header comment in the file first. Several carry the reasoning behind a
non-obvious decision — why consumption comes from endpoints rather than summing deltas,
why a sender's noise band is 1.5% of tank capacity, why `engineRunHour` is discarded.
Those comments exist because the obvious implementation was wrong in production.

Add a test for any calculation you touch. Every existing test states something the
business must never see.
