# FleetView ERP — Client Handover

**Mahadev Constructions — Fleet & Equipment Management**

---

## 🌐 App link

**https://fleetview-erp.vercel.app**

Install page (share this with the team, or scan to install):
**https://fleetview-erp.vercel.app/install**

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
- **Refresh:** once daily (see *Known limitations* below)
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

## ⚠️ Known limitations

1. **Automated backups.** The database has none — backups are taken manually. Move to a
   plan with daily backups (and India-region hosting for DPDP) before the fleet depends
   on this system.
2. **Tracking refreshes once a day, not continuously.** The hosting plan is currently
   Vercel Hobby, which permits only one scheduled job per day. Live tracking is built to
   poll every 15 minutes and will do so as soon as the account moves to a paid plan.
3. **One vehicle is tracked**, and only until 09 Sep 2026. See *Live tracking* above.
4. **Custom domain** not yet configured, e.g. `fleet.mahadevconstructions.com`.
5. **Multi-factor authentication** is not yet enabled for the administrator account.
6. **AI photo-reading** runs on a free, rate-limited key — fine for current volume,
   needs a paid key at scale.

---

*Built on Next.js, Prisma and PostgreSQL. Deployed on Vercel.*
