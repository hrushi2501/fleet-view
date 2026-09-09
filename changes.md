# FleetView ERP — Complete Engineering & Audit Changes Log

This document records all modifications, security hardening, input validation defenses, rate limiting mechanisms, and automated test suites implemented across this session.

---

## Table of Contents

1. [Fleet Module Audit & Validation Hardening](#1-fleet-module-audit--validation-hardening)
2. [Multi-Module Enterprise Audit & Data Flow Hardening](#2-multi-module-enterprise-audit--data-flow-hardening)
3. [API Rate Limiting & Denial-of-Service Defenses](#3-api-rate-limiting--denial-of-service-defenses)
4. [Automated Test Suites & Quality Assurance](#4-automated-test-suites--quality-assurance)
5. [Complete Inventory of Files Created & Modified](#5-complete-inventory-of-files-created--modified)
6. [Verification Commands & Results](#6-verification-commands--results)

---

## 1. Fleet Module Audit & Validation Hardening

### A. Critical Odometer Anti-Rollback Vulnerability Resolved
- **Issue Discovered:** In `saveAsset__impl` ([`src/app/(app)/entry-actions.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/(app)/entry-actions.ts)), passing `0` or an empty string for `meterValue` bypassed the odometer rollback guard because the falsy check `if (!meterValue)` treated `0` as an absent reading, leaving existing mileage susceptible to tampering or silent resets.
- **Fix Implemented:** Replaced falsy checks with strict finite-number parsing (`Number.isFinite`) and validated that any submitted meter reading is non-negative and strictly greater than or equal to the recorded meter value.
- **Master Data Guard:** Hardened `saveAssetMaster__impl` ([`src/app/(app)/master/actions.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/(app)/master/actions.ts)) to prevent modification or meter rollbacks on `DECOMMISSIONED` or `DISPOSED` assets.

### B. Shared Input Validation Library (`src/lib/input-validation.ts`)
Created reusable, high-performance input validation primitives:
- `boundedNumber(val, min, max, name)`: Validates finite numbers within physical and business limits.
- `nonNegativeNumber(val, name)`: Enforces $x \ge 0$.
- `positiveNumber(val, name)`: Enforces $x > 0$.
- `coordinatePair(lat, lng)`: Enforces physical GPS bounds ($-90 \le \text{lat} \le 90$, $-180 \le \text{lng} \le 180$).
- `percentage(val, name)`: Enforces $[0 \dots 100]\%$.
- `safeParseDate(val, name)`: Protects against `NaN` dates, malformed input strings, and out-of-range years.
- `validateDateRange(start, end, name)`: Enforces chronological validity ($\text{start} \le \text{end}$).
- `oneOf(val, allowed, name)`: Enforces strict enumeration matching.

---

## 2. Multi-Module Enterprise Audit & Data Flow Hardening

All ERP server actions across every operational module were audited, fortified with explicit boundaries, and secured against invalid states:

### 1. Fuel Management Module
- **`src/app/(app)/fuel/actions.ts`**:
  - `saveTank`: Validates tank `name`, enforces `capacity` strictly in $(0 \dots 500,000]\text{ L}$, verifies $0 \le \text{minLevel} \le \text{capacity}$ and $0 \le \text{openingLevel} \le \text{capacity}$, and validates `status` against `["Active", "Inactive", "Maintenance"]`.
  - `saveReceipt`: Enforces flow meter chronology ($\text{flowMeterEnd} \ge \text{flowMeterStart} \ge 0$), strictly positive invoice quantity, received quantity bounded by invoiced quantity ($0 < \text{qtyReceived} \le \text{qtyInvoiced}$), strictly positive rates, and safe delivery date parsing.
  - `saveDip`: Enforces $0 \le \text{dipLevel} \le \text{tank.capacity}$.
- **`src/app/(app)/entry-actions.ts`**:
  - `saveFuel` & `updateFuel`: Enforces issue type enumeration (`["ISSUE", "RECEIPT", "TRANSFER", "ADJUSTMENT"]`), positive litres, and valid odometer reading bounds.
  - `setDieselRate`: Bounded diesel rates within plausible economic limits ($₹30 \dots ₹200/\text{L}$).

### 2. Maintenance & Inventory Module
- **`src/app/(app)/entry-actions.ts`**:
  - `saveWorkOrder`: Validates `type` (`["PM", "REPAIR", "BREAKDOWN", "INSPECTION", "TYRE"]`), `priority` (`["Low", "Medium", "High", "Critical"]`), `status` (`["Open", "In-Progress", "Waiting-Parts", "Completed", "Closed"]`), non-negative labor/parts costs, and bounds downtime hours to $[0 \dots 8,760]\text{ hrs}$.
- **`src/app/(app)/maintenance/actions.ts`**:
  - `saveSchedule`: Enforces valid PM intervals (km: $100 \dots 500,000$, hours: $10 \dots 10,000$, days: $1 \dots 3,650$).
  - `addWoLine`: Enforces line kind (`["PART", "LABOUR", "OUTSIDE"]`) and strictly positive quantities and unit costs.
  - `saveInventoryItem` & `receiveStockAction`: Enforces item code format, non-negative unit cost, positive stock receipt counts, and prevents negative stock balances.

### 3. Tyre Management Module
- **`src/app/(app)/tyres/actions.ts`**:
  - `saveTyre`: Enforces tyre `status` enumeration, tread depth bounds ($0 \dots 60\text{ mm}$), and asserts $\text{currentTreadMm} \le \text{treadNewMm}$.
  - `fitTyre`: Enforces axle position validation, verifies target vehicle exists, and prevents mounting already-fitted tyres.
  - `removeTyre`: Enforces removal reason enumeration (`["WORN", "PUNCTURE", "BURST", "CUT", "RETREAD", "ROTATION", "SCRAP"]`), automatically scraps burst/cut tyres, and banks vehicle distance run onto the tyre record.
  - `retreadTyre`: Validates retreading stage, cost, and sets post-retread tread depth limits.

### 4. Drivers & Compliance Module
- **`src/app/(app)/drivers/actions.ts`**:
  - `saveCompetency`: Enforces competency level (`["TRAINED", "CERTIFIED", "EXPERT"]`) and chronological certification dates ($\text{certifiedOn} \le \text{expiresOn}$).
  - `saveViolation`: Enforces violation severity (`["MINOR", "MAJOR", "CRITICAL"]`), violation types, point deduction limits ($1 \dots 100$), and non-negative fines.
  - `saveDocument`: Enforces document type enumeration and checks date ranges.
- **`src/app/(app)/entry-actions.ts`**:
  - `saveDriver`: Enforces driver `type` (`["DRIVER", "OPERATOR"]`), `status` (`["Active", "Inactive", "Suspended"]`), Indian 10-digit mobile phone format, driving license regex validation, and safe date parsing for license expiry.
  - `saveCompliance` & `renewComplianceDoc`: Enforces document type (`["RC", "FITNESS", "INSURANCE", "PUC", "ROAD_TAX", "NATIONAL_PERMIT", "STATE_PERMIT", "CALIBRATION"]`), safe date parsing, and chronological validity ($\text{issueDate} \le \text{expiryDate}$).

### 5. Weighbridge Module
- **`src/app/(app)/weighbridge/actions.ts`**:
  - `saveTicket`: Enforces ticket `kind` (`["DISPATCH", "RECEIPT", "INTERNAL"]`), ticket number length bounds, non-negative mass readings, physical gross limits ($\le 150,000\text{ kg}$), and weight sanity ($\text{grossKg} \ge \text{tareKg}$).

### 6. Costs & Financials Module
- **`src/app/(app)/costs/actions.ts`**:
  - `saveCost`: Enforces cost head (`["FUEL", "MAINTENANCE", "TYRE", "INSURANCE", "EMI", "PERMIT", "TOLL", "SALARY", "OVERHEAD", "OTHER"]`), strictly positive amounts ($\le ₹100,000,000,000$), and validates foreign key links to assets and projects.
  - `saveRevenue`: Enforces bill type (`["RA_BILL", "ADVANCE", "RETENTION_RELEASE", "OTHER"]`) and positive revenue sums.
  - `saveDepreciation`: Enforces depreciation method (`["SLM", "WDV"]`), useful life in years as an integer within $[1 \dots 100]$, and checks that $\text{salvageValue} \le \text{acquisitionCost}$.

### 7. Plant Hire & Contracts Module
- **`src/app/(app)/hire/actions.ts`**:
  - `saveContract`: Enforces rate type (`["PER_DAY", "PER_HOUR", "PER_MONTH", "PER_KM", "PER_TRIP"]`), fuel responsibility (`["HIRER", "OWNER"]`), contract status, and chronological dates ($\text{startDate} \le \text{endDate}$).
  - `saveLog`: Enforces the 24-hour daily machine envelope ($\text{workedHours} + \text{idleHours} + \text{breakdownHours} \le 24\text{ hrs}$).
  - `saveHireInspection` & `saveHirePayment`: Enforces condition ratings, fuel levels ($0 \dots 100\%$), and payment methods.

### 8. Operations & Mobilisation Module
- **`src/app/(app)/operations/actions.ts`**:
  - `saveSite`: Enforces site type (`["WORK_FRONT", "CAMP", "WORKSHOP", "QUARRY", "CRUSHER", "OTHER"]`), GPS coordinates, and geofence radius boundaries ($10\text{ m} \dots 50,000\text{ m}$).
  - `saveEquipmentPlan`: Bounds planned vehicle quantity to $[1 \dots 500]$.
  - `saveAllocation`: Enforces chronological validity ($\text{fromDate} \le \text{toDate}$), status enumeration, and prevents overlapping active allocations for the same equipment.
  - `saveMobilization`: Enforces status and transport mode enums (`["LOWBED_TRAILER", "SELF_DRIVE", "RIGID_TRUCK", "THIRD_PARTY"]`).

### 9. People, Attendance & Payroll Module
- **`src/app/(app)/master/actions.ts`**:
  - `saveAttendance` & `batchSaveAttendance`: Enforces attendance status (`["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "REST", "HOLIDAY"]`), shift enums, and bounds daily duty hours to $[0 \dots 24]\text{ hrs}$.
  - `savePersonDoc`: Enforces document type (`["LICENSE", "AADHAAR", "MEDICAL", "POLICE_VERIFICATION", "TRAINING", "CONTRACT"]`) and chronological dates ($\text{issueDate} \le \text{expiryDate}$).
- **`src/app/(app)/people/payroll/actions.ts`**:
  - `setWage`: Enforces wage kind (`["DAILY", "MONTHLY"]`) and strictly positive wages.
  - `buildRun`: Validates month format (`YYYY-MM`) and locks finalized payroll periods against accidental overwrites.
  - `adjustLine`: Validates that bonus, advance, and deduction inputs are non-negative.
  - `finaliseRun`: Requires admin permissions, writes to audit log, and seals the payroll period.

---

## 3. API Rate Limiting & Denial-of-Service Defenses

A comprehensive audit of all API endpoints across the codebase identified 5 high-traffic read routes that lacked rate limiting protection. These were fortified using the shared rolling-window limiter (`reserveRateLimit` and `rateLimitResponse` from [`src/lib/request-rate-limit.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/lib/request-rate-limit.ts)):

| Endpoint | Method | Scope | Rate Limit Policy | Subject Identity | Impact & Protection |
| :--- | :---: | :--- | :---: | :--- | :--- |
| [`/api/payroll/[period]`](file:///d:/mahadev_new/fleetview-erprohit/src/app/api/payroll/%5Bperiod%5D/route.ts) | `GET` | `"payroll-export"` | 10 req / 300s | `auth.access.session.id` | Prevents CPU exhaustion from heavy PDFKit & ExcelJS report generation. |
| [`/api/stats`](file:///d:/mahadev_new/fleetview-erprohit/src/app/api/stats/route.ts) | `GET` | `"stats-query"` | 30 req / 60s | `auth.access.session.id` | Shields database from rapid multi-table aggregation spams. |
| [`/api/assets`](file:///d:/mahadev_new/fleetview-erprohit/src/app/api/assets/route.ts) | `GET` | `"assets-query"` | 60 req / 60s | `auth.access.session.id` | Throttles full-fleet catalog inventory lookups. |
| [`/api/fuel`](file:///d:/mahadev_new/fleetview-erprohit/src/app/api/fuel/route.ts) | `GET` | `"fuel-query"` | 30 req / 60s | `auth.access.session.id` | Guards complex fuel efficiency calculations and telemetry scans. |
| [`/api/files`](file:///d:/mahadev_new/fleetview-erprohit/src/app/api/files/route.ts) | `GET` | `"file-stream"` | 60 req / 60s | `auth.access.session.id ?? clientIp(req)` | Throttles private Blob streaming; ties anonymous attempts to client IP. |

When any client exceeds these quotas, the endpoints return an HTTP `429 Too Many Requests` response containing the standard `Retry-After: <seconds>` header and a clear JSON error payload.

---

## 4. Automated Test Suites & Quality Assurance

Three comprehensive test suites were created and enhanced to guarantee continuous quality and regression protection:

### A. Enterprise Multi-Module Audit Test Suite (`src/lib/enterprise-modules-audit.test.ts`)
- **Coverage:** 14 full-lifecycle tests across Fuel, Maintenance, Tyres, Drivers, Compliance, Weighbridge, Costs, Plant Hire, Operations, and Payroll.
- **Cross-Module Integration:** Simulates complete lifecycle from vehicle commissioning $\rightarrow$ operational site allocation $\rightarrow$ operator attendance $\rightarrow$ fuel dispensation with anti-rollback $\rightarrow$ work order parts & labor cost reflection $\rightarrow$ monthly depreciation and payroll run generation.

### B. Fleet Validation & Domain Integrity Suite (`src/lib/fleet-validation-audit.test.ts`)
- **Coverage:** 19 automated tests validating asset codes, manufacturing years ($1950 \dots \text{current} + 1$), meter boundaries, laden vs. unladen weight checks, date ranges, and anti-rollback defenses against zero and negative inputs.

### C. Input Field Boundaries & Edge Cases Suite (`src/lib/field-validations.test.ts`)
- **Coverage:** 40 unit tests targeting negative numbers, `NaN`, `Infinity`, non-finite values, out-of-range GPS coordinates, unrealistic years, and contradictory physical quantities.

### D. Security Hardening & Rate Limiting Suite (`src/lib/security-hardening.test.ts`)
- **Coverage:** 21 automated tests verifying client IP extraction (including multi-hop proxies), sliding window pruning mechanics, HTTP 429 response formatting with `Retry-After` headers, and individual rate limit policies for the 5 newly hardened endpoints.

---

## 5. Complete Inventory of Files Created & Modified

| File Path | Status | Summary of Changes |
| :--- | :---: | :--- |
| [`changes.md`](file:///d:/mahadev_new/fleetview-erprohit/changes.md) | **Created** | Comprehensive documentation of all changes, security additions, and test results. |
| [`SESSION-CHANGES-SUMMARY.md`](file:///d:/mahadev_new/fleetview-erprohit/SESSION-CHANGES-SUMMARY.md) | **Created** | Session summary of multi-module audit findings and changes. |
| [`src/lib/input-validation.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/lib/input-validation.ts) | **Created** | Shared reusable validation primitives for numbers, dates, coordinates, and enums. |
| [`src/lib/fleet-validation-audit.test.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/lib/fleet-validation-audit.test.ts) | **Created** | 19 audit tests for the Fleet module. |
| [`src/lib/field-validations.test.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/lib/field-validations.test.ts) | **Created** | 40 unit and domain boundary tests for edge cases and contradictory values. |
| [`src/lib/enterprise-modules-audit.test.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/lib/enterprise-modules-audit.test.ts) | **Created** | 14 multi-module integration and boundary test suites. |
| [`src/lib/security-hardening.test.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/lib/security-hardening.test.ts) | **Modified** | Added rate limiting policy verification tests for all 5 protected routes. |
| [`src/app/(app)/entry-actions.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/(app)/entry-actions.ts) | **Modified** | Hardened validation for Fleet assets, Work Orders, Fuel transactions, and Drivers. |
| [`src/app/(app)/fuel/actions.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/(app)/fuel/actions.ts) | **Modified** | Hardened tank capacities, flow meters, receipts, and fuel issues. |
| [`src/app/(app)/maintenance/actions.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/(app)/maintenance/actions.ts) | **Modified** | Hardened PM schedules, inventory receipts, and work order line items. |
| [`src/app/(app)/tyres/actions.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/(app)/tyres/actions.ts) | **Modified** | Hardened tread depth boundaries, auto-scrap rules, and distance banking. |
| [`src/app/(app)/drivers/actions.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/(app)/drivers/actions.ts) | **Modified** | Hardened driver competencies, certification dates, and violation points/fines. |
| [`src/app/(app)/weighbridge/actions.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/(app)/weighbridge/actions.ts) | **Modified** | Enforced gross $\ge$ tare sanity, ticket enums, and ticket number lengths. |
| [`src/app/(app)/costs/actions.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/(app)/costs/actions.ts) | **Modified** | Enforced 10 cost heads, positive amounts, depreciation methods, and life bounds. |
| [`src/app/(app)/hire/actions.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/(app)/hire/actions.ts) | **Modified** | Enforced 24-hr daily log envelope, contract date checks, and fuel responsibilities. |
| [`src/app/(app)/operations/actions.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/(app)/operations/actions.ts) | **Modified** | Enforced site types, geofence radius bounds, and allocation conflict checks. |
| [`src/app/(app)/master/actions.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/(app)/master/actions.ts) | **Modified** | Enforced attendance status, daily hours $[0 \dots 24]$, and document expiry chronologies. |
| [`src/app/(app)/production/actions.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/(app)/production/actions.ts) | **Modified** | Enforced shift hour limits ($\le 24\text{ hrs}$), production outputs, and targets. |
| [`src/app/api/payroll/[period]/route.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/api/payroll/%5Bperiod%5D/route.ts) | **Modified** | Applied rate limiting to PDF/XLSX export (`scope: "payroll-export"`, 10 req / 300s). |
| [`src/app/api/stats/route.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/api/stats/route.ts) | **Modified** | Applied rate limiting to stats aggregation (`scope: "stats-query"`, 30 req / 60s). |
| [`src/app/api/assets/route.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/api/assets/route.ts) | **Modified** | Applied rate limiting to asset list lookups (`scope: "assets-query"`, 60 req / 60s). |
| [`src/app/api/fuel/route.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/api/fuel/route.ts) | **Modified** | Applied rate limiting to fuel telemetry GET query (`scope: "fuel-query"`, 30 req / 60s). |
| [`src/app/api/files/route.ts`](file:///d:/mahadev_new/fleetview-erprohit/src/app/api/files/route.ts) | **Modified** | Applied rate limiting to private Blob streaming (`scope: "file-stream"`, 60 req / 60s). |

---

## 6. Verification Commands & Results

### 1. Rate Limiting & Security Hardening Tests
```powershell
node --import ./scripts/test-setup.mjs --test src/lib/security-hardening.test.ts src/lib/request-rate-limit.test.ts
```
- **Result:** **21 / 21 tests passed** (0 failures).

### 2. Multi-Module Domain Audit & Integration Tests
```powershell
node --import ./scripts/test-setup.mjs --test src/lib/enterprise-modules-audit.test.ts src/lib/fleet-validation-audit.test.ts src/lib/field-validations.test.ts
```
- **Result:** **73 / 73 tests passed** (0 failures).

### 3. Full Application Regression Test Suite
```powershell
node --import ./scripts/test-setup.mjs --test src/lib/fleet-validation-audit.test.ts src/lib/enterprise-modules-audit.test.ts src/lib/field-validations.test.ts src/lib/security-hardening.test.ts src/lib/request-rate-limit.test.ts src/lib/fleet-usage.test.ts src/lib/fleet-edge-live-cache.test.ts src/lib/fleet-analytics.test.ts src/lib/live-fleet-order.test.ts src/lib/tata-fleet-edge.test.ts src/lib/telemetry-ingestion.test.ts src/lib/trip-checkout-confirmation.test.ts src/lib/qr-checkin.test.ts
```
- **Result:** **159 / 159 tests passed** across 44 test suites (0 regressions).

### 4. Static TypeScript Type Checking
```powershell
npx tsc --noEmit
```
- **Result:** **0 errors**. Full type safety verified.
