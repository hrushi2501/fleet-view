# Fuel Features Implementation Plan

**Project:** FleetView ERP (Mahadev)  
**Date:** 2026-08-01  
**Status:** Ideation & Brainstorming — No Code Changes

---

## Executive Summary

This plan details the implementation of three interconnected fuel management features:

1. **Fuel Verification** — Enhanced gauge-photo workflow with vision models, super-accuracy targeting, retry-on-failure, and owner-side summary dashboard with Tata fuel analytics
2. **Fuel Reconciliation** — Configurable thresholds, automated theft detection via variance analysis
3. **Fuel Anomalies** — Unified anomaly engine merging reconciliation + efficiency signals with ML-grade scoring

All three feed a single source of truth: the **Fuel Anomaly Queue** (existing `FuelAnomaly` model) enriched with contextual evidence, audit trails, and recovery workflows.

---

## 1. Current State Analysis

### 1.1 Existing Fuel Architecture

| Component | File | Purpose |
|-----------|------|---------|
| **Gauge OCR** | `src/app/api/ocr/route.ts` | Vision model (Gemini) reads fuel gauge photos → returns `levelPct`, `confidence`, `gaugeType`, `reasoning` |
| **Decision Logic** | `src/lib/telematics.ts:202-244` | `decideGaugeReading()` — auto-accepts ≥85% confidence; plausibility checks vs. previous reading |
| **Storage** | `FuelLevelReading` (Prisma) | Holds photo URL, model output, confidence, status (`PENDING`/`VERIFIED`/`CORRECTED`/`REJECTED`), human verdict |
| **Verification UI** | `src/app/(app)/tracking/fuel-verification/page.tsx` | Admin reviews pending readings; `VerifyGaugeForm` for accept/correct/reject |
| **Driver Capture** | `src/components/DriverTripPanel.tsx:205-299` → `GaugeCapture` | Camera → OCR → preview → save; shows confidence badge; "Retake" button exists |
| **Tank Reconciliation** | `src/lib/fuel-recon.ts` → `reconcileTank()` | Opening dip + receipts − issues = expected closing vs. actual dip |
| **Anomaly Scoring** | `src/lib/fuel-recon.ts:217-236` | `scoreTankRecon()` → creates `FuelAnomaly` (source: `TANK_RECON`) |
| **Asset Efficiency** | `src/lib/telematics.ts:134-171` | `detectFuelEvents()` → finds suspicious drops (stationary + engine off) |
| **Anomaly Queue** | `src/app/(app)/fuel/anomalies/page.tsx` | Lists `FuelAnomaly` with triage form |

### 1.2 Gaps Identified

| Area | Current State | Gap |
|------|---------------|-----|
| **Vision Accuracy** | Single-pass Gemini; retry only if `<0.6` confidence | No multi-model ensemble, no active learning, no gauge-type specific prompts |
| **Retry UX** | "Retake" button exists but no guided re-capture | No "click again" with framing guidance, no quality pre-check (blur/glare detection) |
| **Owner Summary** | Executive dashboard has fuel shrinkage KPI | No per-vehicle fuel timeline, no Tata-style analytics (theft hotspots, driver ranking, fill-pattern analysis) |
| **Threshold Config** | Hardcoded `DIP_TOLERANCE_L=25`, `NORMAL_SHRINKAGE_PCT=0.5%` | No per-tank/project thresholds; no theft-specific rules |
| **Anomaly Merge** | Separate pages for Reconciliation & Anomalies | No unified view; asset-efficiency anomalies not linked to tank recon; no ML scoring |
| **Theft Detection** | `detectFuelEvents()` finds stationary drops | No correlation with tank gaps, no driver/vehicle risk profiling, no geofence context |

---

## 2. Feature 1: Fuel Verification — Enhanced Workflow

### 2.1 Vision Model Upgrades

#### 2.1.1 Multi-Model Ensemble (`src/lib/ai.ts` → new `visionModelEnsemble()`)

```typescript
// Strategy: Run 2-3 models in parallel, fuse results
// Models: Gemini 2.5 Flash (fast), Gemini 2.5 Pro (accurate), optional GPT-4o
// Fusion: Weighted by gauge-type specific calibration curves
```

**Gauge-Type Specific Prompts** (extend `GAUGE_PROMPT` in `ocr/route.ts`):

| Gauge Type | Enhanced Prompt Additions |
|------------|---------------------------|
| `ANALOG_NEEDLE` | "Needle angle relative to E/F arc. Count tick marks. If needle between marks, report range (e.g., 45-55%) and lower confidence." |
| `DIGITAL_BAR` | "Count lit segments / total segments. Note if segments are partial. Distinguish from LCD artifacts." |
| `DIGITAL_NUMERIC` | "Read exact number. If 'L' suffix → convert using tank capacity. If '%' → use directly. Flag if font unusual." |

#### 2.1.2 Active Learning Loop

- **Table:** `GaugeCalibrationSample` (new Prisma model)
- Store: `assetId`, `gaugeType`, `imageUrl`, `modelPct`, `humanPct`, `confidence`, `modelVersion`
- Monthly job: retrain/fine-tune per gauge type; update confidence calibration curves

#### 2.1.3 Quality Pre-Check (Client-Side)

In `GaugeCapture` component (`DriverTripPanel.tsx:205`):

```typescript
// Before upload: analyze image for
// - Blur (Laplacian variance < threshold)
// - Glare (overexposed regions > 30% of gauge ROI)
// - Framing (gauge occupies < 40% of frame)
// - Lighting (mean luminance 50-200)
// Return: "Quality OK" / "Retake: [reason]" with visual overlay
```

### 2.2 "Click Again" — Guided Re-Capture Flow

**Current:** Generic "Retake" button  
**Proposed:** Structured retry with guidance

```tsx
// In GaugeCapture.tsx — new state machine
type CaptureState = 
  | { phase: 'idle' }
  | { phase: 'capturing'; attempt: 1 | 2 | 3 }
  | { phase: 'precheck'; issues: string[] }
  | { phase: 'ocr'; result: GaugeExtraction }
  | { phase: 'review'; extraction: GaugeExtraction }
  | { phase: 'saved' }

const RETRY_GUIDANCE: Record<string, string> = {
  blur: "Hold phone steady. Tap screen to focus on gauge.",
  glare: "Tilt phone slightly. Avoid direct sunlight on gauge.",
  framing: "Move closer. Gauge should fill most of the screen.",
  lighting: "Use flash or move to better light.",
  unreadable: "Clean gauge glass. Ensure needle/segments visible."
};
```

**Retry Logic:**
- Attempt 1: Standard capture
- Attempt 2: Show guidance based on pre-check failure
- Attempt 3: Force flash + manual focus prompt
- After 3 failures: Allow manual entry with "Supervisor will verify" badge

### 2.3 Owner-Side Fuel Summary Dashboard

**New Page:** `/fuel/summary` (or extend `/reports/executive`)

#### 2.3.1 Per-Vehicle Fuel Timeline

```typescript
// Query: FuelTransaction (ISSUE) + FuelLevelReading + TripSession
// Group by assetId, date
// Show: fills (litres, rate, amount), gauge readings (pct, confidence), trips (km, hrs), efficiency (km/L)
```

**UI Components:**
- `FuelTimelineCard` — expandable daily card per vehicle
- `VehicleFuelSummary` — aggregate stats (total L, total ₹, avg efficiency, anomaly count)
- `DriverFuelScorecard` — per-driver fuel behavior (fills per shift, efficiency vs. norm, anomalies)

#### 2.3.2 Tata-Style Fuel Analytics

| Analytics Module | Description | Data Sources |
|------------------|-------------|--------------|
| **Fill Pattern Analysis** | Time-of-day, day-of-week, site clustering of fills | `FuelTransaction.date`, `lat/lng`, `tankId` |
| **Theft Hotspot Map** | Geofenced zones with high variance | `FuelAnomaly` + `lat/lng` + `TripSession` |
| **Driver Efficiency Ranking** | km/L vs. norm per asset class, anomaly association | `Trip`, `FuelTransaction`, `ConsumptionNorm` |
| **Tank Shrinkage Trend** | Daily/weekly shrinkage % with supplier breakdown | `FuelReconciliation`, `FuelReceipt` |
| **Grade/Quality Tracking** | Rate variance vs. market, supplier performance | `FuelReceipt.rate`, `FuelTransaction.rate` |
| **Predictive Fill Scheduling** | Forecast next fill date per vehicle | `FuelLevelReading` + `Trip.distanceKm` + `ConsumptionNorm` |

**Implementation:** New API `/api/fuel/analytics` with query params for time range, asset, project. Returns JSON for charts.

### 2.4 Timestamped Everything

**Current:** Most models have `createdAt`, some have `date`  
**Required:** Every fuel event has **immutable timestamp** + **source clock**

```prisma
// Add to FuelTransaction, FuelLevelReading, FuelReceipt, TankDip:
serverTimestamp DateTime @default(now()) // DB clock
deviceTimestamp   DateTime?              // Client/device clock (from EXIF or GPS)
timezone          String?                // IANA tz
```

**Audit Trail:** `AuditEvent` already captures `at` + `changes` JSON — ensure all fuel writes call `audit()`.

---

## 3. Feature 2: Fuel Reconciliation — Thresholds & Theft Detection

### 3.1 Configurable Thresholds (Per Tank / Project)

**New Model:** `FuelReconThreshold` (extends/replaces hardcoded constants)

```prisma
model FuelReconThreshold {
  id            String   @id @default(cuid())
  tankId        String?  @unique
  projectId     String?  @unique
  // Dip variance
  dipToleranceL     Float    @default(25)
  dipTolerancePct   Float    @default(1.0)   // % of capacity
  // Shrinkage
  normalShrinkagePct Float   @default(0.5)
  warningShrinkagePct Float  @default(1.5)
  criticalShrinkagePct Float @default(3.0)
  // Theft-specific
  theftDropPct      Float    @default(10)    // single-event drop %
  theftTimeWindowH  Int      @default(4)     // hours for "impossible consumption"
  // Asset efficiency
  efficiencyTolerancePct Float @default(15)
  // Meta
  updatedAt       DateTime @updatedAt
  createdAt       DateTime @default(now())
  
  @@index([tankId])
  @@index([projectId])
}
```

**Resolution Order:** Tank-specific → Project-wide → Global defaults (Settings table)

### 3.2 Theft Detection Rules Engine

**Extend** `ControlRule` (existing) with fuel-specific codes:

| Rule Code | Domain | Trigger | Severity |
|-----------|--------|---------|----------|
| `FUEL_TANK_SHRINKAGE` | FUEL | Tank variance > `criticalShrinkagePct` | HIGH |
| `FUEL_STATIONARY_DROP` | FUEL | `detectFuelEvents()` finds drop > `theftDropPct` while stationary + engine off | HIGH |
| `FUEL_EFFICIENCY_ANOMALY` | FUEL | Asset consumption > `normHigh * (1 + tolerancePct/100)` | MEDIUM |
| `FUEL_FILL_NO_RECEIPT` | FUEL | Tank level rises but no `FuelReceipt` in ±2h | MEDIUM |
| `FUEL_RECEIPT_SHORT_DELIVERY` | FUEL | `FuelReceipt.shortfall` > 2% of invoiced | MEDIUM |
| `FUEL_DRIVER_PATTERN` | FUEL | Driver associated with >3 anomalies in 30 days | HIGH |
| `FUEL_GEO_ANOMALY` | FUEL | Fill/drop outside assigned project geofence | MEDIUM |

**New File:** `src/lib/fuel-theft.ts` — pure functions, testable

```typescript
export type TheftSignal = {
  ruleCode: string;
  assetId?: string;
  tankId?: string;
  driverId?: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  score: number;        // 0-100
  litres: number;
  valueAtRisk: number;
  evidence: string[];   // human-readable
  refIds: string[];     // linked record IDs
  detectedAt: Date;
};

export function detectTheftSignals(
  tankRecon: TankRecon,
  fuelEvents: FuelEvent[],
  assetEfficiency: IssueVariance[],
  context: { assets: Asset[]; drivers: Driver[]; tanks: FuelTank[]; thresholds: FuelReconThreshold }
): TheftSignal[]
```

### 3.3 Correlation Engine — Tank Gap ↔ Asset Drop

**Core Insight:** Theft leaves *two* traces:
1. Tank reconciliation shows missing litres (source side)
2. Asset telemetry shows unexplained drop (consumption side)

**Correlation Logic:**
- For each `TANK_RECON` anomaly with `varianceL < -threshold`
- Find `ASSET_EFFICIENCY` anomalies in same time window ±4h
- Find `FUEL_EVENT` drops (stationary, engine off) in same window
- If ≥2 signals align → **Theft Case** (auto-create `FraudCase` with `domain: 'FUEL'`)

**New Model:** `FuelTheftCorrelation` (links signals to case)

```prisma
model FuelTheftCorrelation {
  id           String   @id @default(cuid())
  caseId       String
  case         FraudCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
  signalType   String   // TANK_RECON | ASSET_EFFICIENCY | STATIONARY_DROP | FILL_NO_RECEIPT
  signalRefId  String
  litres       Float
  weight       Float    // contribution to case score
  createdAt    DateTime @default(now())
}
```

---

## 4. Feature 3: Fuel Anomalies — Unified Engine (Perfect Model)

### 4.1 Unified Anomaly Pipeline

**Current:** Three separate detection paths → separate `FuelAnomaly` records  
**Target:** Single pipeline with multi-signal scoring

```
┌─────────────────┐
│  DATA SOURCES   │
│  • Tank dips    │
│  • Receipts     │
│  • Issues       │
│  • Telemetry    │
│  • Gauge photos │
│  • Trips        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SIGNAL EXTRACT │
│  (pure functions)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  CORRELATION    │
│  (time, asset,  │
│   driver, geo)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SCORING MODEL  │
│  (ML or rule)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  ANOMALY QUEUE  │
│  (FuelAnomaly)  │
└─────────────────┘
```

### 4.2 Enhanced `FuelAnomaly` Model

```prisma
model FuelAnomaly {
  // ... existing fields ...
  
  // NEW: Rich context
  signalTypes     String[]  // ["TANK_RECON", "STATIONARY_DROP", "EFFICIENCY"]
  primarySignal   String    // strongest signal
  correlatedCount Int       @default(1)  // how many signals fused
  
  // NEW: Theft-specific
  theftProbability Float?    // 0-1 from ML model
  theftPattern     String?   // "SIPHONING", "SHORT_DELIVERY", "GHOST_FILL", "METER_TAMPER"
  
  // NEW: Asset/Driver context
  assetCode        String?
  driverName       String?
  driverEmpCode    String?
  projectCode      String?
  tankName         String?
  
  // NEW: Evidence bundle (JSON)
  evidenceJson     String?   // structured: {tankRecon: {...}, fuelEvents: [...], efficiency: {...}}
  
  // NEW: Recovery tracking
  recoveryMethod   String?   // SALARY_DEDUCTION, VENDOR_CLAIM, INSURANCE, WRITE_OFF
  recoveryRef      String?   // invoice no, case no, etc.
  
  @@index([theftProbability])
  @@index([theftPattern])
  @@index([assetId, detectedAt])
  @@index([driverId, detectedAt])
}
```

### 4.3 Scoring Model — "Perfect Model" Design

#### 4.3.1 Feature Vector (per anomaly candidate)

```typescript
interface AnomalyFeatures {
  // Tank signals
  tankVariancePct: number;      // -50 to +50
  tankShortfallL: number;       // receipt shortfall
  tankThroughputL: number;      // context
  
  // Asset signals
  efficiencyVariancePct: number; // actual vs expected consumption
  stationaryDropPct: number;     // max drop while parked
  stationaryDropDurationMin: number;
  
  // Temporal
  hoursSinceLastDip: number;
  fillsInWindow: number;
  anomaliesLast30d: number;      // recidivism
  
  // Actor
  driverAnomalyCount: number;
  driverTenureDays: number;
  assetAnomalyCount: number;
  
  // Geo
  insideGeofence: boolean;
  distanceToAssignedSiteKm: number;
  
  // Quality
  gaugeConfidenceAvg: number;    // if image-based
  sensorAvailabilityPct: number; // telematics uptime
}
```

#### 4.3.2 Scoring Approaches

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **Rule-based (current)** | Transparent, auditable, no training data needed | Rigid, hard to tune | Keep as baseline |
| **Gradient Boosted Trees (XGBoost/LightGBM)** | Handles non-linear interactions, fast inference, feature importance | Needs labeled data | **Primary** — train on historical `FraudCase` outcomes |
| **Neural Net (TabNet/MLP)** | Learns complex patterns | Black box, overkill for tabular | Future |

**Implementation Strategy:**
1. **Phase 1 (Now):** Enhanced rule-based with configurable weights (stored in `ControlRule.threshold` + new `weight` field)
2. **Phase 2 (Data Ready):** Export labeled dataset → train XGBoost → deploy as `scoreAnomalyML()` alongside rules
3. **Phase 3:** A/B test; if ML wins, make primary with rule fallback

**Rule Weight Config (in `ControlRule` or new `AnomalyScoringConfig`):**

```typescript
const SCORING_WEIGHTS = {
  tankVariancePct:      0.30,  // primary theft indicator
  stationaryDropPct:    0.25,  // direct evidence
  efficiencyVariancePct:0.20,  // corroborating
  recidivism:           0.10,  // pattern
  geoAnomaly:           0.10,  // opportunity
  gaugeQuality:         0.05,  // data reliability
};
```

### 4.4 Unified Anomaly Queue UI

**Merge Pages:** `/fuel/reconciliation` + `/fuel/anomalies` → `/fuel/anomalies` (single source)

**New Tabs:**
1. **All Signals** — unified list, filterable by signal type
2. **Theft Cases** — `theftProbability > 0.7` or `theftPattern` set
3. **Tank Recon** — traditional view
4. **Asset Efficiency** — per-vehicle consumption anomalies
5. **Short Deliveries** — supplier-side

**Enhanced Row:** Shows signal badges, theft probability meter, correlated signals count, one-click "Open Fraud Case"

---

## 5. Data Model Changes Summary

### 5.1 New Prisma Models

```prisma
// Gauge calibration for active learning
model GaugeCalibrationSample {
  id            String   @id @default(cuid())
  assetId       String
  asset         Asset    @relation(fields: [assetId], references: [id])
  gaugeType     String
  imageUrl      String
  modelPct      Float?
  humanPct      Float?
  confidence    Float
  modelVersion  String
  createdAt     DateTime @default(now())
  
  @@index([assetId, gaugeType])
  @@index([createdAt])
}

// Per-tank/project reconciliation thresholds
model FuelReconThreshold {
  id                   String   @id @default(cuid())
  tankId               String?  @unique
  projectId            String?  @unique
  dipToleranceL        Float    @default(25)
  dipTolerancePct      Float    @default(1.0)
  normalShrinkagePct   Float    @default(0.5)
  warningShrinkagePct  Float    @default(1.5)
  criticalShrinkagePct Float    @default(3.0)
  theftDropPct         Float    @default(10)
  theftTimeWindowH     Int      @default(4)
  efficiencyTolerancePct Float  @default(15)
  updatedAt            DateTime @updatedAt
  createdAt            DateTime @default(now())
  
  @@index([tankId])
  @@index([projectId])
}

// Theft correlation evidence
model FuelTheftCorrelation {
  id           String     @id @default(cuid())
  caseId       String
  case         FraudCase  @relation(fields: [caseId], references: [id], onDelete: Cascade)
  signalType   String
  signalRefId  String
  litres       Float
  weight       Float
  createdAt    DateTime   @default(now())
  
  @@index([caseId])
  @@index([signalType, signalRefId])
}

// Anomaly scoring configuration (versioned)
model AnomalyScoringConfig {
  id          String   @id @default(cuid())
  version     Int      @default(1)
  weightsJson String   // JSON of feature weights
  thresholdsJson String // JSON of threshold overrides
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  createdBy   String?
  
  @@index([isActive])
}
```

### 5.2 Extended Models

```prisma
// FuelAnomaly — add fields from Section 4.2
model FuelAnomaly {
  // ... existing ...
  signalTypes        String[] @default([])
  primarySignal      String?
  correlatedCount    Int      @default(1)
  theftProbability   Float?
  theftPattern       String?
  assetCode          String?
  driverName         String?
  driverEmpCode      String?
  projectCode        String?
  tankName           String?
  evidenceJson       String?
  recoveryMethod     String?
  recoveryRef        String?
  
  @@index([theftProbability])
  @@index([theftPattern])
  @@index([assetId, detectedAt])
  @@index([driverId, detectedAt])
}

// FuelTransaction — add timestamps
model FuelTransaction {
  // ... existing ...
  serverTimestamp DateTime @default(now())
  deviceTimestamp DateTime?
  timezone        String?
}

// FuelLevelReading — add timestamps
model FuelLevelReading {
  // ... existing ...
  serverTimestamp DateTime @default(now())
  deviceTimestamp DateTime?
  timezone        String?
}
```

---

## 6. API & Server Actions

### 6.1 New Server Actions (`src/app/(app)/fuel/actions.ts`)

| Action | Purpose |
|--------|---------|
| `runFullReconciliation(projectId?, from, to)` | Batch reconcile all tanks in project/date range |
| `detectTheftSignals(assetId?, tankId?, from, to)` | Run theft detection engine, return signals |
| `createTheftCase(signals, assignedTo)` | Bundle signals → `FraudCase` + `FuelTheftCorrelation` |
| `getFuelAnalytics(filters)` | Tata-style analytics JSON for dashboard |
| `updateAnomalyScore(id, newScore, method)` | Manual override / ML model update |
| `bulkTriageAnomalies(ids, status, assignedTo)` | Mass update queue |

### 6.2 New API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/fuel/analytics` | GET | Dashboard charts data (time-range, asset, project filters) |
| `/api/fuel/verify-gauge` | POST | Enhanced gauge verification with quality pre-check |
| `/api/fuel/calibration` | POST | Submit human correction for active learning |
| `/api/fuel/theft-scan` | POST | Trigger theft detection for asset/tank |

---

## 7. UI/UX Changes

### 7.1 Driver App (`DriverTripPanel.tsx` → `GaugeCapture`)

- **Quality Pre-Check Overlay:** Real-time blur/glare/framing feedback before upload
- **Guided Retry:** 3-attempt flow with contextual tips
- **Manual Fallback:** After 3 failures, allow manual % entry with "Supervisor Review Required" flag
- **Offline Queue:** Store photos locally if no network; sync when online

### 7.2 Admin Verification (`/tracking/fuel-verification`)

- **Bulk Actions:** Select multiple → "Accept All High Confidence" / "Send for Review"
- **Keyboard Shortcuts:** `A`=Accept, `C`=Correct, `R`=Reject, `Space`=Preview image
- **Side-by-Side:** Show model reading vs. previous verified reading vs. tank capacity
- **Audit Trail:** Click reading → see full history (model versions, human corrections)

### 7.3 Owner Dashboard (`/fuel/summary` — new)

```
┌─────────────────────────────────────────────────────────────┐
│  FLEET FUEL SUMMARY          [Last 30 Days ▼] [Export]     │
├─────────────────────────────────────────────────────────────┤
│  KPIs: Total L | Total ₹ | Avg km/L | Shrinkage % | Anomalies│
├──────────────────┬──────────────────────────────────────────┤
│  VEHICLE LIST    │  SELECTED VEHICLE TIMELINE               │
│  ┌────────────┐  │  ┌────────────────────────────────────┐  │
│  │ MH12 AB ✓  │  │  │ 2026-07-15  Fill: 450 L @ ₹92.5   │  │
│  │ MH12 CD ⚠  │  │  │ 2026-07-15  Trip: 180 km, 4.2 km/L│  │
│  │ MH12 EF ●  │  │  │ 2026-07-14  Gauge: 67% (0.91 conf) │  │
│  └────────────┘  │  │ 2026-07-14  ⚠ ANOMALY: -12% eff.   │  │
│  [Filters]       │  └────────────────────────────────────┘  │
├──────────────────┴──────────────────────────────────────────┤
│  ANALYTICS TABS: [Theft Hotspots] [Driver Ranking] [Tank    │
│  Shrinkage] [Fill Patterns] [Grade Tracking] [Predictive]   │
└─────────────────────────────────────────────────────────────┘
```

### 7.4 Unified Anomaly Queue (`/fuel/anomalies` — redesigned)

- **Signal Badges:** 🔴 Tank | 🔵 Asset | 🟡 Drop | 🟢 Delivery
- **Theft Probability Bar:** Visual 0-100% with threshold markers
- **Correlation Panel:** Click anomaly → slide-over shows all correlated signals
- **One-Click Case:** "Open Fraud Case" pre-fills `FraudCase` with evidence bundle

---

## 8. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Add `FuelReconThreshold` model + migration
- [ ] Add timestamp fields to `FuelTransaction`, `FuelLevelReading`
- [ ] Create `src/lib/fuel-theft.ts` with rule-based detection
- [ ] Update `reconcileTank()` to use configurable thresholds
- [ ] Add `ControlRule` entries for fuel theft codes

### Phase 2: Vision & Capture (Week 2-3)
- [ ] Enhance `GAUGE_PROMPT` per gauge type in `ocr/route.ts`
- [ ] Add client-side quality pre-check in `GaugeCapture`
- [ ] Implement guided 3-attempt retry flow
- [ ] Add `GaugeCalibrationSample` model + active learning endpoint

### Phase 3: Unified Anomaly Engine (Week 3-4)
- [ ] Extend `FuelAnomaly` model (migration)
- [ ] Build correlation engine in `fuel-theft.ts`
- [ ] Implement enhanced scoring (rule weights configurable)
- [ ] Create unified anomaly queue UI (merge pages)

### Phase 4: Owner Analytics (Week 4-5)
- [ ] Build `/api/fuel/analytics` endpoint
- [ ] Create `/fuel/summary` dashboard with tabs
- [ ] Implement Tata-style analytics modules
- [ ] Add export (CSV/PDF) for all views

### Phase 5: ML Scoring (Week 6+ — when labeled data exists)
- [ ] Export training dataset from `FraudCase` + `FuelAnomaly`
- [ ] Train XGBoost model
- [ ] Deploy as `scoreAnomalyML()` alongside rules
- [ ] A/B test; promote if lift > 15% precision@recall

---

## 9. Testing Strategy

### 9.1 Unit Tests (Jest/Vitest)

| Module | Test Cases |
|--------|------------|
| `fuel-recon.ts` | reconcileTank edge cases: no dips, single dip, short delivery, overflow |
| `fuel-theft.ts` | detectTheftSignals: each rule code, correlation logic, scoring |
| `telematics.ts` | decideGaugeReading: all gauge types, confidence thresholds, plausibility |
| `scoring` | Weight combinations, boundary conditions |

### 9.2 Integration Tests

- Full reconciliation run → anomaly created → appears in queue → triage → case created
- Gauge photo → OCR → decision → asset fuel level updated → telemetry reading created
- Theft detection: stationary drop + tank gap → correlated → fraud case

### 9.3 Visual Regression

- Driver capture flow (all 3 attempts)
- Admin verification keyboard shortcuts
- Owner dashboard charts render correctly

### 9.4 Accuracy Benchmarks

| Metric | Target | Measurement |
|--------|--------|-------------|
| Gauge OCR accuracy (analog) | ≥90% within ±5% | Human-labeled test set (n≥500) |
| Gauge OCR accuracy (digital) | ≥95% within ±2% | Human-labeled test set (n≥500) |
| Theft detection precision | ≥80% | Historical cases with known outcomes |
| Theft detection recall | ≥70% | Same |
| False positive rate | ≤10% | Anomalies resolved as FALSE_POSITIVE |

---

## 10. Migration Checklist

### 10.1 Database Migrations

```bash
# 1. Add threshold model
npx prisma migrate dev --name add_fuel_recon_threshold

# 2. Add timestamps to fuel tables
npx prisma migrate dev --name add_fuel_timestamps

# 3. Extend FuelAnomaly
npx prisma migrate dev --name extend_fuel_anomaly

# 4. Add calibration & correlation models
npx prisma migrate dev --name add_gauge_calibration_theft_correlation
```

### 10.2 Data Backfill

- Populate `FuelReconThreshold` with current hardcoded defaults per tank/project
- Backfill `serverTimestamp` = `createdAt` for existing records
- Compute initial `theftProbability` for open anomalies using rule-based score

### 10.3 Feature Flags

```env
# .env.local
FUEL_ML_SCORING_ENABLED=false
FUEL_QUALITY_PRECHECK_ENABLED=true
FUEL_GUIDED_RETRY_ENABLED=true
FUEL_TATA_ANALYTICS_ENABLED=true
```

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Vision model accuracy plateau | Medium | High | Active learning loop; gauge-type specific prompts; ensemble |
| Driver adoption of retry flow | Medium | Medium | Hindi/English voice prompts; vibration feedback; <10s per attempt |
| Threshold tuning complexity | High | Medium | Start with sensible defaults; per-tank UI; audit trail of changes |
| ML model training data scarcity | High (early) | High | Rule-based primary for 6+ months; collect labeled data via FraudCase |
| Performance at scale | Low | High | Indexes on `detectedAt`, `assetId`, `status`; paginated queries; materialized views for analytics |

---

## 12. Success Metrics (6 Months Post-Launch)

| Metric | Baseline | Target |
|--------|----------|--------|
| Fuel shrinkage % | ~3-5% | <1.5% |
| Anomaly detection → recovery rate | ~20% | >60% |
| Gauge photo first-pass accuracy | ~75% | >90% |
| Driver retake rate | N/A | <15% of captures |
| Time to triage anomaly | ~2 days | <4 hours |
| Theft cases with evidence bundle | 0% | 100% |

---

## 13. Appendix: File Touch Map

| Feature | Files to Create | Files to Modify |
|---------|-----------------|-----------------|
| **Thresholds** | `prisma/schema.prisma` (+migration), `src/lib/fuel-thresholds.ts` | `src/lib/fuel-recon.ts`, `src/app/(app)/fuel/actions.ts` |
| **Theft Detection** | `src/lib/fuel-theft.ts`, `src/lib/fuel-theft.test.ts` | `src/app/(app)/fuel/actions.ts` (scanFuelEvents), `src/app/(app)/loss-prevention/actions.ts` |
| **Vision Enhancement** | — | `src/app/api/ocr/route.ts`, `src/lib/ai.ts`, `src/components/DriverTripPanel.tsx` (GaugeCapture) |
| **Quality Pre-check** | `src/lib/image-quality.ts` | `src/components/DriverTripPanel.tsx` |
| **Guided Retry** | — | `src/components/DriverTripPanel.tsx` (GaugeCapture) |
| **Active Learning** | `prisma/schema.prisma` (+migration), `src/app/api/fuel/calibration/route.ts` | `src/app/(app)/tracking/actions.ts` (verifyGaugeReading) |
| **Unified Anomaly** | `prisma/schema.prisma` (+migration), `src/lib/anomaly-scoring.ts` | `src/app/(app)/fuel/anomalies/page.tsx`, `src/app/(app)/fuel/reconciliation/page.tsx` (merge) |
| **Owner Dashboard** | `src/app/(app)/fuel/summary/page.tsx`, `src/app/api/fuel/analytics/route.ts` | `src/components/FuelForms.tsx` (add analytics button) |
| **Tata Analytics** | `src/lib/fuel-analytics.ts` | `src/app/api/fuel/analytics/route.ts` |

---

## 14. Open Questions for Stakeholder Review

1. **Threshold Ownership:** Who sets per-tank thresholds — site manager, central ops, or both with approval workflow?
2. **Theft Case Escalation:** Auto-create `FraudCase` for HIGH signals, or always require human trigger?
3. **Tata Analytics Scope:** Which modules are MVP vs. Phase 2? (Hotspot map + Driver ranking = MVP?)
4. **ML Timeline:** Accept rule-based only for 6 months, or invest in labeling infrastructure now?
5. **Offline Driver App:** PWA service worker for gauge photo queue — in scope?
6. **Supplier Portal:** Expose short-delivery anomalies to vendors for dispute — future phase?

---

*End of Plan — Ready for Review & Prioritization*