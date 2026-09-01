# FleetView Functionality Audit and Best-in-Class Roadmap

Audit date: 2026-08-30

## Verified current state

- The application has 28 route handlers, 413 automated tests in 80 suites, and a passing production build.
- Server actions are permission-guarded and their client callers now inspect `safe()` error results before reporting success.
- Tata Fleet Edge is scheduled by one authenticated Vercel cron (`/api/telematics/sync` every minute), protected by a shared lock and a 60-call/hour budget.
- Telemetry samples, normalised values, provider health, fuel anomalies, alerts, and driver trip records are persisted in Supabase.
- Fleet km/L now uses only Tata-attributed `GPS_API` readings from active road vehicles that travelled beyond the stationary threshold and have a usable fuel window. Equipment, mobile/manual readings, parked vehicles, and thin/invalid windows are excluded.

## Live-data finding

On the audit date, the database contained 53 registered assets and 5,692 Tata-attributed GPS readings in the preceding 30 days, but only one asset with a usable active road-vehicle window. The provider-to-asset register link was missing for that asset despite valid reading provenance; it was backfilled once and the Tata sync now self-heals that link on every ingestion.

This is not a calculation problem any more. It is an onboarding/data-coverage problem: fleet-wide mileage cannot be representative until more working road vehicles are provisioned and report sufficiently dense Tata telemetry.

## Roadmap

### P0 — operational truth and release safety

1. **Telemetry onboarding control centre**
   - Show every registered vehicle as `Not provisioned`, `Provisioned/no recent data`, `Reporting but insufficient`, or `Eligible for KPI`.
   - Add an administrator workflow to match Tata VIN/registration/device identifiers to the FleetView asset and verify the first live reading.
   - Acceptance: an administrator can explain why every vehicle is or is not included in the efficiency KPI without querying the database.

2. **Telemetry data-quality service level objectives**
   - Define freshness, sample-density, odometer continuity, and fuel-sender-quality thresholds by vehicle type.
   - Alert on missed cron cycles, provider rate limiting, unmapped Tata vehicles, long gaps, and contradictory sender data.
   - Acceptance: a stale or malformed feed creates one visible, deduplicated alert with a clear owner and remediation action.

3. **Release pipeline as a required GitHub check**
   - Add CI jobs for `npm run check`, `npm run build`, `npm run db:check`, and a deployment-safe Supabase migration check; retain dependency audit as a separate gate.
   - Run schema-changing migrations from a Supabase owner/CI credential, never from the restricted application runtime role.
   - Acceptance: `main` cannot be deployed if code, Prisma schema, runtime database schema, or production build diverge.

4. **Critical-path browser tests**
   - Add Playwright coverage for login/RBAC, driver QR start/end, driver fuel fill, accident report, admin notification inbox, approval transitions, and Tata-sync failure visibility.
   - Acceptance: every release exercises one real browser path for driver, supervisor, and administrator roles against an isolated database.

### P1 — field reliability and actionable operations

5. **Offline-first driver capture**
   - Queue QR, fuel-photo, incident, and gauge submissions locally with visible sync state, idempotency keys, retries, and conflict handling.
   - Preserve original photos plus compressed upload copies; prevent duplicate fuel records after reconnect.
   - Acceptance: a driver can complete a fuel/incident workflow without connectivity and see an explicit synced or needs-attention outcome later.

6. **Notification delivery assurance**
   - Keep the existing role-scoped in-app inbox, then add per-channel delivery status, acknowledgement/escalation timers, quiet hours, and fallback channels for Critical incidents.
   - Provide a notification policy matrix: event, recipients, severity, SLA, escalation owner, and deep link.
   - Acceptance: a Critical accident that is not acknowledged within the configured SLA escalates and leaves a durable timeline.

7. **Immutable operational event stream**
   - Create an owner-managed `TelemetrySyncRun`/job-run table with retention and a dashboard, rather than writing one audit event per minute.
   - Record run timing, fetched/stored/duplicate/unmatched counts, rate-limit state, and provider payload drift.
   - Acceptance: an operator can diagnose a missing data window from the UI without platform logs.

8. **Fleet control-tower views**
   - Add dispatch exceptions: inactive vehicle during planned allocation, moving without a trip, trip without a driver, geofence breach, long idle, unexpected fuel event, and overdue maintenance before dispatch.
   - Prioritise by safety, financial exposure, and production impact—not by raw alert count.
   - Acceptance: the morning queue is a ranked worklist with one-click assignment, acknowledgement, and evidence trail.

### P2 — best-in-class optimisation

9. **Plan-versus-actual production economics**
   - Connect route, payload/weighbridge, idle time, cycle time, fuel burn, maintenance downtime, and project progress into one asset-day fact model.
   - Measure cost/tonne, cost/km, litres/tonne, utilisation, availability, MTBF, MTTR, and lost-production value with data-confidence badges.
   - Acceptance: a manager can identify the highest-value intervention for each project and drill to the raw telemetry and source documents.

10. **Predictive maintenance with human approval**
    - Start with explainable rules and survival-style risk scoring from hours, fault codes, work orders, component/tyre history, and operating severity.
    - Require planner approval before creating purchase orders or taking an asset out of service; measure false positives and avoided downtime.
    - Acceptance: every recommendation names its evidence, confidence, expected downtime/cost avoided, and approver.

11. **Fuel integrity reconciliation**
    - Reconcile tank receipts, pump issues, driver photo/OCR, Tata fuel-sender changes, trip distance, engine-on idle time, and approved exceptions by asset and shift.
    - Maintain a case lifecycle with evidence, owner, due date, resolution code, and recovery outcome.
    - Acceptance: every litre is classified as explained, pending evidence, or investigated; no aggregate “loss” is shown without a traceable source path.

12. **Enterprise platform controls**
    - Add backup restore drills, retention policies for raw telemetry/photos, disaster-recovery runbooks, Sentry/OpenTelemetry traces, uptime checks, synthetic cron checks, and load tests for the Supabase pool.
    - Add quarterly access reviews and a permission-change audit report.
    - Acceptance: the team can demonstrate restore time, alert response time, capacity limit, and least-privilege review evidence.

## Implementation order

1. P0 telemetry onboarding/data-quality controls and CI gates.
2. P0 browser tests for the driver-admin pipeline.
3. P1 offline driver workflow and notification escalation.
4. P1 job-run observability and dispatch control tower.
5. P2 economics, predictive maintenance, and enterprise operations.

Each phase should ship behind measured acceptance criteria, with a pilot project first. Do not enable automated financial, disciplinary, or maintenance decisions without human approval and an explanation of the underlying data quality.
