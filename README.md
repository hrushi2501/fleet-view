# FleetView ERP — Trial Build

A working **Vehicle & Fleet Management ERP** for road-construction & infrastructure, built for
**Mahadev Constructions**. Self-contained: full front end + back end + database with realistic
demo data. Hand it to a client and it runs anywhere — no cloud account or external DB needed.

## Tech stack
- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS v4** + custom design system + **Recharts** + **lucide-react** icons
- **Prisma 6 ORM** + **SQLite** (file-based DB — zero setup)
- Cookie session auth (demo) + role-based users

## Quick start

```bash
cd fleetview-erp
npm install          # install dependencies
npm run setup        # generate Prisma client, create DB, seed demo data
npm run dev          # start at http://localhost:3000
```

> `npm run setup` is only needed once (or to reset demo data). It runs
> `prisma generate && prisma db push && node prisma/seed.mjs`.

For a production-style run: `npm run build && npm start`.

## Demo logins

| Role | Email | Password |
|------|-------|----------|
| Administrator | `admin@mahadev.com` | `admin123` |
| Fleet Manager | `fleet@mahadev.com` | `fleet123` |
| Finance | `finance@mahadev.com` | `finance123` |
| Site Manager | `site@mahadev.com` | `site123` |

## What's included (modules)

| Module | Route | Highlights |
|--------|-------|-----------|
| **Executive Dashboard** | `/` | KPI cards, monthly cost chart, fleet status donut, fuel trend, alerts, attention list |
| **Assets & Equipment** | `/fleet` | Filterable/searchable register (class, status, ownership) + **Asset 360** detail (`/fleet/[id]`) |
| **Live Tracking** | `/tracking` | Interactive GPS map with status filters, live markers, asset side-list |
| **Projects** | `/projects` | Project cards with budget utilization & deployed assets |
| **Fuel Management** | `/fuel` | Issue/receipt KPIs, site-tank levels, **fuel-theft anomaly table** (issued vs sensor rise) |
| **Maintenance** | `/maintenance` | Work orders, breakdowns, MTTR, downtime, warranty, WO table |
| **Drivers & Operators** | `/drivers` | Safety/performance scores, leaderboard, license-expiry tracking |
| **Compliance** | `/compliance` | RC/Insurance/Fitness/Permit/PUC tracking + expiry watchlist |
| **Cost & Profitability** | `/costs` | Cost-by-head trends, distribution, most-expensive-asset TCO ranking |
| **Reports & KPIs** | `/reports` | Live KPI catalog vs targets + report library |
| **Alerts & Fraud** | `/alerts` | Multi-category alerts with **working acknowledge / resolve** actions |

## REST API (sample backend endpoints)
- `GET /api/stats` — fleet summary JSON (assets, fuel loss, alerts, cost)
- `GET /api/assets?class=EXCAVATOR&status=Active` — filtered asset list
- `GET /api/auth/logout` — clears session

(All API routes require an authenticated session cookie.)

## Demo data (seeded)
~47 assets across 11 classes (owned/leased/hired/contractor), 5 NHAI/metro projects, 30
drivers/operators, 14 days of trips, 30 days of fuel transactions (with injected theft anomalies),
45 work orders, 236 compliance docs, 43 alerts, and 6 months of cost data across 9 cost heads.

## Notes for the trial
- This is a **demo/trial**: auth passwords are plaintext in the seed and the DB is SQLite. For
  production, swap to Postgres (change the Prisma datasource), hash passwords, and add the
  hardening described in the companion design dossier (`../fleet-erp-design/`).
- To reset all demo data: `npm run seed`.

## Companion design dossier
The full enterprise product spec (12 modules, ERD, architecture, AI roadmap, fraud controls,
delivery plan) lives in `../fleet-erp-design/`.
