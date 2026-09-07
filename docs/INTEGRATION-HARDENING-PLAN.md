# FleetView ERP — Existing-Feature Integration and Hardening Plan

Audit date: 2026-09-05. Baseline: commit `0783105` plus the existing uncommitted work, including inventory and friendly errors. This is an audit and implementation plan; the application fixes below have not been applied.

## 1. Objective and scope

Make the existing fleet manager dependable: one operational truth across driver duty, vehicle status, tracking, workshop, stores, fuel, site work, hire, costs, documents, and reports. A successful operation must leave consistent records, respect the caller's access, and produce an accurate result on every affected screen.

No new product modules, dashboards, prediction features, offline capture system, notification channels, or redesign are proposed. Supporting constraints, transaction changes, validation, cache wiring, and tests are repairs to existing functionality. This plan replaces the feature-expansion priorities in `FUNCTIONALITY-AUDIT-PLAN.md` for the present task; that historical document remains unchanged.

“Zero issues” cannot be established by a finite test suite. The practical completion standard is no unresolved release blockers in the existing workflows, demonstrated invariants under retries and concurrency, and recorded runtime/deployment evidence.

## 2. Verified baseline

| Check | Result on this checkout | What it establishes |
| --- | --- | --- |
| `npm run check` | Passed; lint produced no errors/warnings, TypeScript passed, 496 tests passed across 106 suites, none skipped | Current static and automated regression gates pass |
| `npm run build` | Could not complete: Turbopack CSS worker failed to bind a local port with `Operation not permitted`; retry outside the initial sandbox had the same result | Default production build is not verified here; this failure is an environment restriction, not evidence of a CSS defect |
| `node node_modules/next/dist/bin/next build --webpack` | Passed, including TypeScript and all 39 static pages | Alternative production compilation works; this does not replace the default-build gate |
| `npm run db:check` | Passed after enabling network access: all 64 application models have their expected tables/columns | Existence compatibility only; the script does not compare column types, defaults, indexes, constraints, or RLS |
| Database metadata, read only | 67 public tables; 13 have RLS disabled, including 10 Prisma models; no `anon`/`authenticated` table privileges found across the seven checked privilege types | Grants currently provide the public API boundary, but the reported complete RLS deployment is false |
| Database metadata, read only | Runtime role `fleetview_app` has `BYPASSRLS`; default isolation is `read committed` | Application row scoping is essential; a plain transaction does not serialize stock checks |
| Database unique indexes | Inventory item/store pair uniqueness exists; `TelemetryReading` and `TripSession` have only primary-key unique indexes | Telemetry observation deduplication and active-session exclusivity lack the intended database-level backstops |
| Framework reproduction | Installed Next `notFound()` produces `NEXT_HTTP_ERROR_FALLBACK;404`; `isNextNavigationError()` returns false | The guard's not-found preservation is incompatible with this installed version |
| Domain reproductions | Inconsistent explicit net weights accepted; simulated overlapping inventory issues both succeeded against the same stock snapshot | Concrete validation defects and a reproducible lost-update interleaving |

Local Node was `v26.7.0`; installed Next is `16.3.3`. The test runner emits a `module.register()` deprecation warning under this Node version; it is separate from ESLint warnings.

Evidence logs for this session are in `/private/tmp/fleetview-audit-{check,build,webpack,db}-20260905.log`. These are temporary local logs, not retained CI artifacts. Database observations refer to the database configured by this checkout's `.env.local`; they do not establish the state of every deployment.

No live business records were created, changed, or deleted. No migrations, seed scripts, provider sync, password migration, push delivery, or deployment were triggered. Authenticated browser journeys, actual PostgreSQL concurrency tests, provider delivery, remote CI, and restore drills remain unverified.

## 3. Architecture and the contracts that matter

FleetView is a Next.js application with server-rendered pages, React client components, server actions, REST handlers, and Prisma/PostgreSQL. The core domain functions are already substantial. The principal weakness is that some alternate write paths bypass the same domain rules or only commit part of a business operation.

| Layer / domain | Current implementation | Required contract |
| --- | --- | --- |
| Identity and access | `session-token.ts`, `auth.ts`, `access.ts`, `rbac.ts`, `guard.ts`; project scope stored in `Setting` | Verify identity, permission, and the specific rows involved, on each server entry point |
| Vehicle and duty | `Asset`, `Driver`, `TripSession`, `Trip`, `MeterReading`; `/api/session/scan`, `/checkout`, `/ping`, driver actions | One active duty per vehicle/driver; safe vehicle status; one completion record; accurate meter and source attribution |
| Tracking and fuel measurements | Tata push/pull, generic device ingestion, normalization, `TelemetryReading`, asset caches, `fleet-edge-live.ts`, `fleet-usage.ts` | Preserve provider/time/source; reject invalid measurements; deduplicate observations; explain unavailable or stale values |
| Workshop and stores | `WorkOrder`, `WorkOrderLine`, schedules, checklists, inventory stock and movement ledger | Status, schedule, vehicle availability, material movements, and costs remain consistent after every operation |
| Sites and production | Projects, sites, allocations, mobilizations, production logs, weighbridge tickets | Asset location/allocation agrees with the active site; quantities and dates are valid and reports count each event once |
| Finance and hire | Hire contracts/logs/invoices/payments, cost transactions, revenue, depreciation, `costing.ts` | Approval limits apply consistently; source amounts reconcile; no duplicate financial effects or unsupported quantities |
| Alerts and evidence | Persisted alerts/cases, compliance documents, private uploads, audit writer, existing web push | Correct recipients and row access; durable primary records; external-delivery failures do not misreport primary success |
| Screen state | Next path revalidation, TanStack Query, a scoped five-second live-fleet server cache | Successful mutations refresh all affected consumers; stale state and account changes cannot expose incorrect results |

The main dependencies are:

```text
Driver claim -> active TripSession + Asset.driverId -> driver home and live map
Checkout -> completed session + Trip + meter + assignment release -> trips and reports
Defect -> WorkOrder + blocked Asset -> claim eligibility
Part issue -> stock movement + WorkOrderLine + WO totals -> stores and maintenance cost
WO completion -> status + PM schedule + asset service/availability -> driver and fleet
Telemetry -> normalized observations + asset cache -> map, fuel analysis, efficiency
Production/weighbridge/hire/cost -> existing summaries -> project and asset reports
```

These are business transaction boundaries. Sharing a helper, or calling `revalidatePath`, does not itself enforce them.

## 4. Corrections to the supplied master report

1. The 496 passing tests are reproduced, but the runner reports **106 suites**, not 107. The inventory “DB operations” tests use mock delegates; they do not prove PostgreSQL isolation, rollback, RLS, or browser integration. Passing tests do not establish complete coverage.
2. RLS scripts deliberately deny Supabase public-role access. They do not implement authenticated tenant/project policies. The runtime role bypasses RLS, and ten application tables currently have RLS disabled.
3. Production signing uses **`AUTH_SECRET`**, not `SESSION_SECRET`. Revocation is per user through `Setting`; `getSession()` reads the user and revocation epoch from the database. The legacy migration uses bcrypt **10 rounds**, skips already recognized bcrypt hashes, and does not demonstrate upgrading arbitrary weak hashes to 12 rounds.
4. `apiErrorResponse()` exists but has no production route call sites. `safe()` is used widely, but driver actions and route handlers are not universally wrapped.
5. Query invalidation is performed by client callers. `invalidateInventoryQueries` and an inventory query-key family are absent. Inventory forms currently use `router.refresh()` against their server-rendered page. Invalidating one browser's query client does not notify other browsers.
6. `WorkOrderLine` links to an inventory item but has no warehouse or exact issue-transaction relation. Its return helper searches the latest issue for the entire work order/item pair. Cancellation does not call that return helper.
7. A driver scanning a second vehicle is automatically checked out of the first; `evaluateScan()` explicitly allows this. The implementation does not enforce the report's stated refusal until the old trip is manually ended.
8. Live-map data currently carries driver name and the unassigned badge, but not the reported driver phone and trip start time. Inventory catalog markup is a plain table without the reported search/category controls. Under this task, record these as inaccurate claims, not instructions to add features.
9. Rate limiting exists for login and selected API operations. No shared limiter is called by the reviewed fuel/cost/work-order mutation actions or the Tata webhook route. The report's blanket coverage is not supported.
10. The telemetry unique-index SQL exists, but the index is absent from the configured database and intentionally absent from the Prisma schema pending historical duplicate review. Presence of a SQL file is not deployment evidence.

The old mock alert/loss adapters still exist, but repository searches found no production consumers of their factories; current insight routes read Prisma. Their existence alone is not evidence that live dashboards serve mock data. In contrast, the manual driver-trip defaults below are an active source of fabricated facts.

## 5. Prioritized findings and repairs

Severity here indicates release priority: P0 can corrupt operational truth or violate intended data access; P1 breaks an existing contract or leaves an important assurance gap. Source-derived risks are distinguished from database observations and local reproductions. No concurrency exploit was run against live data.

### H01 — P0: Permission checks are not consistently followed by row scoping

**Evidence:** `maintenance/actions.ts:267`, `:371`, `:413`, `:488` discard the access object from `requireAction()` and operate on posted IDs. `maintenance/inventory/page.tsx:37` discards page access and fetches all warehouses, stock, transactions, and projects. Similar patterns appear in costs, production, hire, and weighbridge actions. `/api/insight/loss-prevention:20` fetches cases without scope even though its asset-options query is scoped. `requireAction()` itself checks permissions, not target rows.

**Consequence:** A project-restricted supervisor with a module permission can reach records beyond the intended project boundary through these paths. Actual exploitability depends on the assigned permissions; the missing predicates are confirmed in source.

**Repair:** Retain access context and scope both reads and writes. Validate every referenced entity and relationship: work order, asset, project, item/store, source store and destination store. Explicitly define existing shared-store/global-record access. Fail closed on malformed project-scope values; `loadProjectScope()` currently returns unrestricted scope for valid JSON of the wrong type.

**Acceptance:** With two projects and a supervisor assigned only to A, forged B IDs fail for list/detail/export/create/update/delete/transition and dropdown queries. Shared records follow a documented policy. Admin and linked-driver paths continue to work.

### H02 — P0: Inventory transactions can lose concurrent changes

**Evidence:** `inventory.ts:73-87` and `:260-273` read a quantity and write an absolute replacement. Callers use ordinary transactions without an isolation override; the database default is `read committed`. Returns and adjustments also use stale-read replacement. Receipt quantity increments are atomic, but `:192-207` computes and writes average cost from an unlocked earlier snapshot.

**Reproduction:** Two mocked, synchronized reads both saw 10 units. Two issues of 7 both succeeded; stock ended at 3 while the ledger recorded 14 issued. This reproduces the application's write pattern, not a real database race test.

**Repair:** Use conditional atomic decrements with an available-stock predicate and assert the affected count, plus a consistent locking/serialization strategy for the complete operation. Serialize item-level weighted-average changes across all warehouses. Define lock ordering for transfers and bounded retries for actual serialization conflicts. Keep ledger, stock, and WO updates in the same transaction.

**Acceptance:** Real isolated PostgreSQL tests for concurrent issue/issue, issue/transfer, receipt/receipt, return/issue, and stocktake/issue conserve quantity and value. One of two competing seven-unit issues from ten must fail cleanly. Rollback leaves neither stock nor ledger effects.

### H03 — P0: Stock reversals do not identify the original line and store

**Evidence:** `inventory.ts:123-131` selects the latest issue by work order and item, without a line ID. `WorkOrderLine` at `schema.prisma:914` has no issuing-store/issue relation. `deleteWoLine__impl` passes only work order, item, and quantity. Work-order cancellation in `entry-actions.ts:503` never invokes stock return.

**Consequence:** Issue the same SKU from store A and then B on one WO; deleting the earlier A line restores stock into B. There is no durable exact-issue reversal identity. The wrong-store selection was demonstrated with mock delegates.

**Repair:** Persist an exact line-to-issue association and original store/cost basis. Make reversal conditional and exactly once. Reject stock edits on terminal work orders. Route cancellation through the existing domain operation; distinguish unused issued stock eligible for return from material already consumed, so cancellation cannot manufacture stock.

**Acceptance:** Delete/retry/cancel tests cover repeated SKUs, different stores, different issue prices, concurrent deletion, and legacy lines. Only the original eligible movement is reversed once; unresolved legacy origins are surfaced without guessing.

### H04 — P0: Duty completion is not atomic or idempotent

**Evidence:** `/api/session/checkout/route.ts:89-120` separately updates the session, creates a trip, clears the driver, updates the meter, and creates a meter reading. The status is checked before these writes, but the update predicate contains only the ID. `Trip` has no unique source-session association. Scan eligibility is read outside its serializable transaction.

**Consequence:** Concurrent checkouts can create duplicate trip history. Partial failure can leave a completed session with no trip or a stale assignment. An old checkout can clear a newer driver's assignment. A breakdown raised between eligibility read and claim is not safely covered by the current claim transaction.

**Repair:** One transaction owns completion, its guarded ACTIVE-to-COMPLETED change, trip linkage, meter change, and ownership-conditional release. Repeated delivery returns the established completion result. Read vehicle eligibility within the protected claim operation. Add database constraints for existing active-duty invariants after reviewing conflicts. Treat automatic vehicle switching as another completion path using the same rules; retain current switching behavior unless the business explicitly changes it.

**Acceptance:** Double checkout yields one trip and one meter effect. Fault injection at each write leaves no partial completion. Checkout racing with a new claim cannot clear the new assignment. Breakdown racing with check-in cannot leave an unsafe active claim. Repeat scans resume the same session.

### H05 — P0: Manual trip capture writes unsupported operational facts

**Evidence:** `my/actions.ts:160-186` defaults missing/zero distance to 12 km, invents a start time 45 minutes earlier, and writes `gpsVerified: true` for manual input. Origin/destination/material are read into unused variables. `DriverQuickHub.tsx:40` pre-fills a fictional route, 32.5 tonnes, 14 km, and a meter increment.

**Consequence:** A user can save a seemingly complete, GPS-verified trip that contains assumptions. It can coexist with a later duty-summary Trip, creating a possible reporting double count that must be resolved at the consumer level.

**Repair:** Remove fabricated defaults; require actual measurements or preserve unknown/unverified values using existing representations. Validate finite tonnage, distance, dates, and meters on the server. Keep manual source attribution truthful. Establish whether a `Trip` is a haul cycle or a duty summary and prevent reports from counting both representations as separate production.

**Acceptance:** Blank inputs cannot create measured distance, tonnage, elapsed time, or GPS verification. A manually logged haul followed by shift checkout produces the intended total exactly once. Labels and persisted fields describe the same facts.

### H06 — P0: Work-order status changes have competing implementations

**Evidence:** `maintenance/actions.ts:161` uses `transition()` for completion; `entry-actions.ts:503` directly writes any supplied status. It bypasses terminal-state rules and schedule advancement. Completion then separately updates PM schedules and asset availability. Pre-op failure creates WO, changes status, and creates an alert in separate writes. Line mutations do not check WO status.

**Consequence:** The same work order behaves differently depending on the button used. Closed jobs can be changed through another action, costs can diverge, or a vehicle can be released while another safety operation races.

**Repair:** One transactional service controls all current WO transitions and their effects. Make `transition()` composable with the caller's transaction rather than opening global-client writes. Recompute totals from authoritative lines, validate critical checklist completion where required, and update schedule/service/availability together. Preserve all open blocking work when deciding asset release. Use collision-safe WO numbering; schedule/pre-op paths currently use `count() + 1`.

**Acceptance:** Every existing status UI enforces the same legal moves and side effects. Closed/cancelled orders reject line edits. Failed completion rolls back everything. Multiple blocking WOs, concurrent defect creation, PM advancement, and number allocation pass integration tests.

### H07 — P0: Telemetry deduplication is not backed by the deployed index

**Evidence:** Database metadata shows only the telemetry primary key. `schema.prisma:450` explicitly defers tuple uniqueness pending historical duplicate review. Push and pull check before insert; both use `GPS_API` for the same Tata observation. The SQL file's historical comments conflict with current schema comments.

**Repair:** Inspect duplicate groups read only, preserve raw evidence and distinguish exact retransmissions from conflicting readings. Prepare a reviewed reconciliation and additive owner-run index migration. Do not run generic cleanup or delete history as an audit shortcut. Align schema, migration SQL, duplicate-error handling, and all ingestion entry points with the same identity.

**Acceptance:** Simultaneous push, pull, and redelivery produce one intended observation and unchanged downstream consumption/distance. Provider-distinct observations remain distinct where required. Deployment verifies the actual unique index and its definition; historical reconciliation retains a review trail.

### H08 — P1: RLS deployment is incomplete despite column parity

**Evidence:** RLS is disabled on `FeatureStoreRecord`, `FuelReconConfig`, `HireContractAmendment`, `HireInspection`, `HirePayment`, all four inventory tables, and `UnifiedAnomaly`. Three additional tables outside Prisma (`PayrollLine`, `PayrollRun`, `WageRate`) also lack RLS. None of the 67 public tables granted the tested public roles table privileges at inspection time.

**Repair:** Use the existing owner-run RLS procedure after verifying target, effective roles, and backup/recovery arrangements. Bring all tables covered by the existing policy into compliance, including non-Prisma tables; do not delete extra tables to achieve parity. Add a failing deployment verification for RLS, grants, required indexes, types, nullability, and foreign keys. Document the actual runtime `BYPASSRLS` boundary.

**Acceptance:** Zero out-of-policy tables; existing RLS verifier passes; public-role API access remains denied; application access remains functional. Column presence alone no longer qualifies as schema/security synchronization.

### H09 — P1: Error recovery is incompatible with installed Next, and API wiring is incomplete

**Evidence:** `friendly-error.ts:36` only recognizes the older not-found digest. The existing test constructs that obsolete digest. `app/(app)/error.tsx:26` expects `unstable_retry`; Next 16.3.3 passes `retry` and `reset`. Installed docs state `retry` became stable in 16.3. The retry button will call an undefined prop. `api-error.ts` has no route consumers; many errors still return generic API messages. `safe()` discards the separate reference field for mapped errors.

**Repair:** Follow the installed framework contracts for navigation and recovery. Exercise actual framework exceptions, not handwritten substitutes. Integrate consistent error handling into existing route/action consumers with appropriate HTTP statuses, safe messages, and useful references. Keep one server diagnostic reference connected to the displayed failure; a browser-generated random code alone cannot identify a server incident. Verify global reset/retry behavior and clipboard failure handling.

**Acceptance:** Real redirect/not-found responses survive wrappers; page retry re-fetches successfully; permission, validation, conflict, throttling, upload, and provider failures remain understandable. Form input survives failed saves and success feedback appears only after successful persistence.

### H10 — P1: Numeric safeguards accept contradictory or non-finite values

**Evidence:** `weighbridge.ts:251` accepts any positive explicit net without comparing it with gross/tare or bounding it. A local call with gross 10,000 kg, tare 4,000 kg, net 90,000 kg returned valid. Negative net is silently replaced; NaN is not rejected by the helper. `weighbridge/actions.ts:76` accepts a negative explicit amount. Repeated `Number(value) || 0` parsing hides malformed input and accepts Infinity. WO non-inventory lines can accept negative values. An inventory issue with rate zero uses average cost in its ledger but leaves the WO line rate/amount at zero.

**Repair:** Centralize strict finite-number parsing for the existing actions, preserving missing versus zero where meaningful. Define gross/tare/net consistency and any existing net-only weighing case explicitly; do not treat an arbitrary threshold as a legal vehicle limit. Derive dependent amounts from validated inputs. Resolve inventory issue price once and use it for both movement and WO totals. Protect moving-average valuation from untracked catalog cost edits. Audit existing hire payments against `requireApproval`, since `saveHirePayment` currently only checks `hire.approve` permission.

**Acceptance:** Server tests reject NaN, Infinity, malformed strings, negative forbidden values, invalid dates and enums, impossible weights, and over-limit approvals. Inventory issue cost equals its WO amount. Costs/revenue/hire/production reports reconcile to validated source records.

### H11 — P1: Cache and feedback contracts are incomplete

**Evidence:** Inventory uses server refresh; other forms invalidate selected TanStack keys. Live fleet adds a five-second process cache and the client polls every 15 seconds. Query keys omit user identity and the root QueryProvider persists across route navigation; no explicit auth-change clearing was found. This is a cache-isolation risk to verify in browser, not a demonstrated cross-account exposure. The inventory page fetches all catalog/store data and the latest 60 movements for every tab.

**Repair:** Document each mutation's affected server paths and client query keys, then wire existing consumers accordingly. Clear or replace sensitive browser cache on identity/scope changes. Define an explicit cross-client freshness bound using the existing polling/refetch mechanism. Preserve useful pagination and page state; bound heavy reads and distinguish recent movements from lifetime totals. Avoid adding a second cache system to solve invalidation.

**Acceptance:** Receipt/issue/return updates inventory, WO totals, and relevant cost displays. Claims/checkout appear on another client's map within the documented bound. Login as A, logout, and login as B cannot display A's cached rows. Fetch errors do not masquerade as an empty healthy fleet.

### H12 — P1: Release and integration evidence are weaker than the report implies

**Evidence:** `.github/workflows/dependency-audit.yml` is the only checked-in workflow. No Playwright/Cypress setup was found. Tests stub `next/navigation`, `next/headers`, and `next/server`; inventory tests use fake delegates. Audit extension writes occur through `rawDb` outside the business transaction, so rollback/audit consistency and behavior with a one-connection production pool need real integration verification.

**Repair:** Add CI gates for the existing lint/type/test/build checks, disposable-database integration, and owner-managed deployment verification. Pin a supported runtime consistently across local/CI/deployment; test TypeScript execution support explicitly rather than copying the dependency-audit job's Node setting. Test audit behavior under rollback and pool saturation; do not await a second-connection audit write while the only connection is held by the business transaction. Keep best-effort external push separate from durable domain records.

**Acceptance:** CI on the release commit passes the selected production build, database invariants, critical browser workflows, and dependency policy. Required checks and deployment logs are verified remotely. Backup restore, provider/cron status, and failed-operation diagnostics have recorded evidence; untested services stay explicitly unverified.

## 6. Execution sequence

| Phase | Work | Exit condition |
| --- | --- | --- |
| 0 — Freeze and reproduce | Preserve the dirty baseline; inventory the existing write endpoints and report consumers; prepare isolated fixtures for two projects, two scoped users, two drivers, two stores, one road vehicle and one hour-meter machine; reproduce H01–H07 and H09–H10 | Failing regression scenarios exist before the repairs; production credentials cannot reach mutation tests |
| 1 — Protect access and truth | H01, H05, H08; remove fabricated trip facts, repair row predicates, prepare/apply the existing database security controls through the owner deployment path | No cross-project CRUD leakage in tests; no invented measured values; verified configured database security boundary |
| 2 — Make workflows atomic | H02–H04, H06; exact issue/reversal identity, stock concurrency, checkout identity, common WO lifecycle, allocation concurrency review | All invariant/concurrency/rollback tests pass against real isolated PostgreSQL |
| 3 — Align telemetry and quantities | H07, H10; reviewed historical deduplication, deployed constraints, finite/domain validation, financial reconciliation | Replayed telemetry cannot inflate results; stock/cost/weight/trip reports match source evidence |
| 4 — Complete existing user flows | H09, H11; framework recovery, API/action error wiring, cache invalidation, form feedback, mobile permission/failure states | Browser acceptance matrix passes in the production build for driver, supervisor, and admin |
| 5 — Prove release readiness | H12; CI enforcement, production build in a suitable environment, schema/RLS/index verification, restore drill, provider/push operational checks | All required evidence belongs to the candidate commit/deployment and no P0/P1 release blocker remains |

Each phase should be a reviewable change set. Transaction/schema changes must deploy in a compatible order: additive schema first, compatible application code next, verified reconciliation/backfill, and constraint tightening only after evidence permits it. Never rewrite uncertain live history merely to make a constraint pass.

## 7. Existing-workflow acceptance matrix

| Workflow | Scenarios that must pass |
| --- | --- |
| Authentication/RBAC | Valid/invalid login, lockout, revoked/deactivated user, malformed scope, direct API/action access, scoped exports, logout/account switch |
| Claim/duty/map | Camera and manually entered cabin code, resume, occupied vehicle, second-vehicle switch, stale session, blocked asset, rejected geolocation, concurrent claim and checkout, map freshness |
| Trip/production | Genuine manual measurements, empty/invalid values, hour-meter versus odometer units, haul versus duty aggregation, no duplicate completion, business-day boundaries |
| Fuel | Receive, issue, dip, driver submission/photo/manual fallback, approved existing lifecycle, tank-capacity rules, source provenance, sensor-off zero filtering, failed upload and retry |
| Telemetry | Same payload via push/pull, duplicate delivery, out-of-order/stale samples, bad coordinates, token expiry, provider timeout/429, shared poll lock, stale-data display; use fixtures before a bounded real-provider verification |
| Workshop | Manual/pre-op/driver WO creation, every supported transition UI, PM roll-forward, multiple blocking WOs, critical checklist, closed-line rejection, concurrent completion and new breakdown |
| Inventory | Receipt, multi-store same-SKU issue/return, transfer, stocktake, cancellation, retries, concurrent operations, original cost preservation, ledger/balance reconciliation |
| Allocation/mobilization | Overlapping active allocation attempts, project/site mismatch, cancellation/release/arrival and asset-project synchronization, scoped access |
| Tyres/components | Existing install/remove/transfer events, mutually exclusive asset/store placement, meter/quantity validation, workshop cost consistency |
| Weighbridge | Gross/tare/net consistency, explicit net-only case if already supported, duplicate ticket race, pairing, negative/invalid billing, source-to-report reconciliation |
| Hire/costs/revenue | Period/date handling, amendment/payment/log behavior, approval ceiling, repeated submissions, source totals, no maintenance/fuel double counting |
| Compliance/evidence | Expiry dates, permission-scoped private file access, upload failure, existing renew/delete behavior and dashboard refresh |
| Alerts/loss/audit | Scoped reads and writes, recipient policy, existing status moves, recovery totals, evidence access, persisted primary event despite push failure, audit on commit/rollback |
| General UI | Empty/loading/error states, retained form input, duplicate-click protection, keyboard/modal behavior, mobile layout, real error-boundary retry, no false success messages |

## 8. Completion evidence and operating rules

The final handoff should contain a compact record per invariant: source paths, regression test, isolated integration/browser result, migration/index verification where applicable, and the release commit. Track pass/fail/blocked with evidence; do not turn missing evidence into a pass.

For deployment, verify all relevant checks on the actual candidate revision, run the read-only database compatibility/security/index checks, and confirm the deployed application's existing driver/office paths. Verify the configured cron/worker arrangement without starting a competing poller. Use bounded provider checks within the shared quota. Confirm backups can be restored into an isolated database and keep runtime credentials separate from migration authority.

Retain existing unknown-data safeguards, provider attribution, private uploads, role catalog, and domain calculations that already work. Repairs should converge alternate paths on those rules. The target is that every existing button, job, and report agrees about the same vehicle, duty, stock movement, and amount—and that failures leave a recoverable, explainable state.
