# FleetView ERP — Client Handover

**Mahadev Constructions — Fleet & Equipment Management**

---

## 🌐 App link

**https://fleetview-erp-indol.vercel.app**

Install page (share this with the team, or scan to install):
**https://fleetview-erp-indol.vercel.app/install**

## 📲 Install (one app for everyone)

- **Android:** open the link in Chrome → tap **Install App** (or menu ⋮ → Add to Home screen).
- **iPhone:** open the link in **Safari** → **Share** → **Add to Home Screen**.
- It is the **same app** for office and site — the login decides what each person sees.

---

## 🔑 Login

| Role | Email | Password |
|------|-------|----------|
| **Administrator** (full ERP) | `administrator@madevcons.com` | issued separately |

> Passwords are **not written in this document**. They are handed over directly and
> should be kept in a password manager. Add the rest of your team under
> **Users & Access**, and control what each role may do under **Roles & Permissions**.

---

## 📦 What is in the system today

**Read this section carefully — it is deliberately short.**

| | |
|---|---|
| **1 vehicle** | `TRU-053` — Tata truck **RJ21GE3220**, chassis MAT567005R3C08725 |
| **Live telemetry** | GPS position, odometer, fuel level and ignition, pulled from Tata Fleet Edge |
| **8 roles** | with permissions and rupee approval limits |
| **19 detection rules** | fuel, hire, meter, compliance and loss-prevention controls |
| **27 norms** | fuel-consumption and production baselines |

**Everything else is empty.** There are no assets beyond that one truck, no compliance
documents, no drivers, no projects, no fuel or cost transactions. The system is
configured and working, and it is waiting for your data.

An earlier version of this document described a loaded fleet of 64 machines with
169 compliance documents and a list of compliance findings. **That data was
generated sample data, not your register**, and it has been removed. No decision
should be based on anything reported by the system before this handover.

---

## 🛰️ Live tracking — what is connected

One truck reports live, through a **Tata Fleet Edge Basic Pull** subscription.

- **Covered vehicle:** RJ21GE3220 only
- **Subscription valid:** 10 Aug 2026 → **09 Sep 2026**
- **Refresh:** every 2 minutes. Fleet Edge allows roughly one call a minute, so the
  occasional rate-limit response is expected traffic shaping, not a fault — the
  provider status shows `RATE_LIMITED` and the next run simply succeeds.
- **Where to see it:** **Live Tracking** for the map, **Assets & Equipment → TRU-053**
  for meter and fuel level

Adding more vehicles to live tracking is a **commercial change with Tata Fleet Edge**,
not a software change. Once a vehicle is added to the subscription, it flows into the
system automatically — provided that vehicle also exists here as an asset with a
matching registration number, chassis number or device IMEI.

**When the subscription lapses on 09 Sep 2026**, tracking stops and the sync will
report errors rather than quietly showing stale positions. Renew before that date if
tracking matters to you.

---

## 🧭 The 18 modules

**Fleet & master data** — Assets & Equipment · Asset Master Data (dual odometer/hour-meter,
completeness scoring) · Sites & Operations (geofences, allocation, mobilisation) · Projects

**Fuel (the flagship)** — Fuel Management · Site Diesel Tanks (ledger + dipstick) ·
Fuel Reconciliation (opening dip + deliveries − issues = expected stock) · Fuel Anomalies

**Production & materials** — Production & Output (trips, tonnes, m³, litres per tonne) ·
Weighbridge Reconciliation (dispatched vs received vs billed)

**Contractors** — Hire & Contractors · Invoice Verification (claimed vs what site logs support)

**Workshop** — Maintenance · Preventive Service (due by km, engine-hours *or* calendar —
whichever comes first) · Tyres & Components (cost per km, legal tread, swap detection)

**People** — Drivers & Operators · Safety & Competency (scores that decay over a year;
assignment blocked without competency) · Personnel Master (attendance, documents)

**Money & control** — Cost, TCO & Profitability (₹/km, ₹/engine-hour, ₹/m³, project margin) ·
Loss Prevention (one scored case queue, tracked to rupees recovered) · Compliance Audit

**Oversight** — Executive Dashboard · Reports & exports (CSV) · Alerts & escalation ·
Roles & Permissions · Audit Log

Every module is built and working. Each one reports nothing until you enter the
data it works from — a blank Fuel Reconciliation screen means no fuel has been
recorded yet, not that the feature is missing.

---

## ▶️ Getting started, in order

1. **Assets & Equipment.** Enter your fleet — registration number, make, model, year,
   meter reading. Nothing else in the system does much until the machines exist.
2. **Users & Access.** Add your fleet manager, finance, workshop and site staff.
   Assign roles under **Roles & Permissions**.
3. **Compliance.** Enter insurance, PUC, permit, fitness and RC details with their real
   expiry dates. The compliance engine and its expiry alerts start working immediately.
4. **Drivers & Operators.** Add your drivers, then link each login to its person record
   (Roles & Permissions → Person Record). The driver app shows nothing until that link exists.
5. **Asset Master Data.** Add acquisition costs — until then, depreciation and
   cost-per-tonne report zero for the whole fleet.
6. **Site Diesel Tanks.** Add your tanks and take an opening dip. Fuel reconciliation
   starts from the first dip.

For `TRU-053` specifically, the make/model/year and acquisition cost are not yet
known — Fleet Edge does not report them. Fill them in under **Asset Master Data**
so its depreciation and cost figures become meaningful.

---

## 🔒 Security

- Passwords are bcrypt-hashed.
- HTTPS enforced (HSTS), clickjacking blocked, strict content-security policy.
- Data export requires an explicit permission and is written to the audit log.
- Every role change, deletion and export is recorded in **Audit Log** and is append-only.

---

## 📊 How the system treats uncertain data

The fuel, mileage and loss figures follow one rule: **a wrong number is worse than no
number.** Where the data cannot support a figure, the screen says so instead of printing
something that looks precise.

- **"Insufficient telemetry data for reliable fuel analysis"** means the vehicle was not
  sampled often enough over the period to measure what it burnt. Distance and tank
  levels are still shown; consumption and km/L are withheld.
- **Confidence — high / medium / low** appears next to every fuel analysis. It reflects
  how much of the period was actually observed, whether the odometer was working, and
  how wide the gaps between samples were. Do not act on a *low* figure.
- **A dash (—)** always means *not known*, never *zero*. A vehicle showing "—" for
  mileage has not been measured; it is not a vehicle doing nothing.
- **Unaccounted diesel** is only reported once the journey, idling time and the fuel
  sender's own tolerance have all been allowed for — and never when confidence is low.
  It is a prompt to look, not a finding of theft.

Fuel senders on a 300 L tank drift by a litre or two even with the engine off, and slosh
by several litres while driving. The system ignores movement inside that band rather
than counting it as fuel burnt.

---

## ⚙️ Settings that affect the numbers

| Setting | Where | Effect if wrong |
|---|---|---|
| `dieselRate` | **Settings** in the app | Every rupee figure on fuel and loss cases |
| `BUSINESS_TIMEZONE` | environment (default `Asia/Kolkata`) | Which day/month a fuel issue, cost or attendance record falls into |
| `WORKING_HOURS_PER_DAY` | environment (default `8`) | Hire utilisation percentages used in vendor discussions |
| `FLEET_INGEST_KEY` | environment | **Must be set.** Controls who may push telemetry into your fleet data |
| Consumption norms | **Fuel → Norms** | The km/L band each vehicle class is judged against |

Norms shipped as industry defaults. Review them against your own fleet's real
performance before treating "below norm" as a finding.

---

## ⚠️ Known limitations

Each item below was re-verified against the live system on 10 September 2026.

1. **An older deployment is still online.** `https://fleetview-erp.vercel.app` is a
   separate, outdated deployment that reads this same live database, so any figure seen
   there is stale and should not be trusted. It sits in a different Vercel account and
   cannot be removed from this project — ask whoever owns that account to delete it.

   Checked on 10 Sep: its ingest endpoints **do** require a key and return
   `401 Unauthorized` without one, and no ingest key is published anywhere in this
   repository. An earlier version of this document said otherwise; that was wrong. The
   risk is misleading figures, not an open write endpoint.

2. **Automated backups.** The database has none — backups are taken manually. Move to a
   plan with daily backups before the fleet depends on this system. Hosting is already
   in-region (`ap-south-1`) for DPDP.

3. **Telemetry history has gaps.** Continuous polling is recent; earlier data was
   collected hourly or less. Fuel analysis over an incompletely observed period
   correctly reports low confidence rather than guessing.

4. **Multi-factor authentication** is not enabled for the administrator accounts.

5. **Leaked-password protection** is switched off in Supabase Auth, so a password known
   to be compromised would still be accepted. It is a single toggle in the Supabase
   dashboard under Authentication.

6. **Custom domain** not yet configured, e.g. `fleet.mahadevconstructions.com`.

7. **AI photo-reading** runs on a free, rate-limited key — fine for current volume,
   needs a paid key at scale.

8. **Forty of fifty-six machines have no fuel sensor or tracker.** That is expected:
   they fall back to the driver's gauge and odometer photographs, and the screens say so
   rather than showing a confident number built from nothing.

### Resolved since the previous version of this document

- **Telemetry duplicates.** A uniqueness rule now prevents the same observation being
  counted twice when a provider retries. The nine historical duplicate groups it was
  waiting on were reviewed and reconciled; the removed rows were exported first.
- **Tipper classification.** Five Tata Signa `TK` tippers were classed as `TRUCK` and so
  judged against highway-truck fuel economy they cannot reach. They are now `TIPPER`
  (2.2–3.8 km/L). Compliance requirements are unchanged by this.
- **Live tracking.** Twelve vehicles are reporting, not one.
- **`FLEET_INGEST_KEY`.** Set in the production environment.
- **Row Level Security.** Enabled on all 67 tables with restrictive deny policies for
  the public API roles and no residual grants.

---

*Built on Next.js, Prisma and PostgreSQL. Deployed on Vercel.*
