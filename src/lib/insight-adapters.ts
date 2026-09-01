/**
 * Insight Adapters — plug-and-play data layer for the Insight section.
 *
 * Each adapter defines an interface; the mock implementation seeds the UI
 * with hyper-realistic Indian fleet data. When live telemetry comes online,
 * swap MockXxxAdapter → LiveXxxAdapter with zero UI or API contract changes.
 */

/* ======================== SHARED TYPES ======================== */

export type INRAmount = number; // Always in ₹

/* ======================== LOSS PREVENTION ADAPTER ======================== */

export interface LPSummaryStats {
  openCases: number;
  totalCases: number;
  liveExposure: INRAmount;
  recovered: INRAmount;
  recoveryRate: number;
  avgDaysToResolve: number;
  falsePositives: number;
  repeatOffenders: number;
}

export interface LPDomainBreakdown {
  domain: string;
  cases: number;
  atRisk: INRAmount;
  recovered: INRAmount;
}

export interface LPRepeatOffender {
  party: string;
  type: "VENDOR" | "ASSET" | "DRIVER";
  cases: number;
  openCases: number;
  atRisk: INRAmount;
  recovered: INRAmount;
}

export interface FraudSignal {
  id: string;
  assetCode: string;
  type: "FUEL_THEFT" | "SHORT_DELIVERY" | "METER_ROLLBACK" | "SENSOR_ANOMALY";
  litres: number;
  valueAtRisk: INRAmount;
  severity: "HIGH" | "MEDIUM" | "LOW";
  description: string;
  location: string;
  detectedAt: string;
}

export interface LPSummaryResponse {
  stats: LPSummaryStats;
  byDomain: LPDomainBreakdown[];
  repeatOffenders: LPRepeatOffender[];
  fraudSignals: FraudSignal[];
}

export interface ILossPreventionAdapter {
  getSummary(): Promise<LPSummaryResponse>;
}

/* ======================== ALERTS ADAPTER ======================== */

export type AlertSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface AlertItem {
  id: string;
  category: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  status: "Open" | "Acknowledged" | "Resolved";
  assetCode: string | null;
  createdAt: string;
  escalatedAt: string | null;
  assignedTo: string | null;
  actionUrl: string | null;
}

export interface AlertsResponse {
  alerts: AlertItem[];
  stats: {
    total: number;
    open: number;
    critical: number;
    escalated: number;
    resolved: number;
  };
}

export interface IAlertsAdapter {
  getAlerts(filters?: { severity?: AlertSeverity; category?: string; status?: string }): Promise<AlertsResponse>;
  acknowledge(id: string): Promise<{ ok: boolean }>;
  escalate(id: string): Promise<{ ok: boolean }>;
  assign(id: string, supervisor: string): Promise<{ ok: boolean }>;
  resolve(id: string): Promise<{ ok: boolean }>;
}

/* ======================== MOCK IMPLEMENTATIONS ======================== */

// --- Realistic Indian fleet data generators ---

const _FLEET_ASSETS = [
  "TATA-2518-A01", "TATA-2518-A02", "TATA-3518-A03", "JCB-3DX-E04", "JCB-3DX-E05",
  "JCB-220LC-E06", "TATA-PRIMA-T07", "TATA-SIGNA-T08", "KOMATSU-PC210-E09", "CAT-320D-E10",
  "L&T-CASE-E11", "TATA-LPK-D12", "TATA-LPT-D13", "ASHOK-2820-D14", "MAHINDRA-BLAZO-D15",
];

const _VENDORS = [
  "Sharma Earthmovers", "Rajput Transport Co.", "Mewar Diesel Agency", "Jaipur Stone Suppliers",
  "Bishnoi Constructions", "Khatri & Sons Hire", "Chouhan Aggregates", "Modi Logistics Pvt Ltd",
];

const _DRIVERS = [
  "Ramesh Kumar", "Suresh Singh", "Mukesh Patel", "Dinesh Choudhary", "Lokesh Meena",
  "Vinod Sharma", "Ganesh Yadav", "Mahesh Soni", "Rajendra Jat", "Bharat Gurjar",
];

const _LOCATIONS = [
  "NH-48 Bypass, Udaipur", "Nagaur Quarry Site", "Jodhpur Ring Road Yard", "Jaisalmer NHAI Project",
  "Barmer RCC Plant", "Pali Bridge Site", "Sikar–Bikaner NH Section", "Ajmer Crushing Unit",
];

function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function _pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function cuid(): string { return `mock_${Date.now()}_${rand(1000, 9999)}`; }

/* ---- Mock Loss Prevention ---- */

export class MockLossPreventionAdapter implements ILossPreventionAdapter {
  async getSummary(): Promise<LPSummaryResponse> {
    const stats: LPSummaryStats = {
      openCases: 14,
      totalCases: 67,
      liveExposure: 847500,
      recovered: 1235000,
      recoveryRate: 72.4,
      avgDaysToResolve: 6.3,
      falsePositives: 5,
      repeatOffenders: 4,
    };

    const byDomain: LPDomainBreakdown[] = [
      { domain: "Fuel", cases: 23, atRisk: 425000, recovered: 310000 },
      { domain: "Hire / vendor", cases: 18, atRisk: 312000, recovered: 245000 },
      { domain: "Meter", cases: 11, atRisk: 0, recovered: 0 },
      { domain: "Maintenance", cases: 8, atRisk: 67500, recovered: 42000 },
      { domain: "Compliance", cases: 7, atRisk: 43000, recovered: 0 },
    ];

    const repeatOffenders: LPRepeatOffender[] = [
      { party: "Sharma Earthmovers", type: "VENDOR", cases: 5, openCases: 2, atRisk: 187000, recovered: 92000 },
      { party: "TATA-2518-A01", type: "ASSET", cases: 4, openCases: 1, atRisk: 134500, recovered: 78000 },
      { party: "Khatri & Sons Hire", type: "VENDOR", cases: 3, openCases: 1, atRisk: 98000, recovered: 45000 },
      { party: "Ramesh Kumar", type: "DRIVER", cases: 3, openCases: 0, atRisk: 67000, recovered: 67000 },
    ];

    const fraudSignals: FraudSignal[] = [
      { id: cuid(), assetCode: "TATA-2518-A01", type: "FUEL_THEFT", litres: 180, valueAtRisk: 16740, severity: "HIGH", description: "Physical dip 180 L below book balance. No issue record covers the gap.", location: "Nagaur Quarry Site", detectedAt: new Date(Date.now() - 3600000 * 4).toISOString() },
      { id: cuid(), assetCode: "JCB-3DX-E04", type: "METER_ROLLBACK", litres: 0, valueAtRisk: 0, severity: "HIGH", description: "Hour meter dropped from 4,285 to 3,900. Tampering suspected.", location: "Jodhpur Ring Road Yard", detectedAt: new Date(Date.now() - 3600000 * 12).toISOString() },
      { id: cuid(), assetCode: "Tank-Nagaur-01", type: "SHORT_DELIVERY", litres: 320, valueAtRisk: 29760, severity: "HIGH", description: "Supplier invoiced 5,000 L, dip confirmed only 4,680 L received.", location: "Nagaur Quarry Site", detectedAt: new Date(Date.now() - 3600000 * 8).toISOString() },
      { id: cuid(), assetCode: "TATA-PRIMA-T07", type: "SENSOR_ANOMALY", litres: 45, valueAtRisk: 4185, severity: "MEDIUM", description: "GPS showed engine idle for 3h but fuel consumed 45 L — abnormal burn rate.", location: "Barmer RCC Plant", detectedAt: new Date(Date.now() - 86400000 * 2).toISOString() },
      { id: cuid(), assetCode: "ASHOK-2820-D14", type: "FUEL_THEFT", litres: 95, valueAtRisk: 8835, severity: "MEDIUM", description: "Night-time fuel level drop of 95 L with no trip logged.", location: "Pali Bridge Site", detectedAt: new Date(Date.now() - 86400000 * 1).toISOString() },
    ];

    return { stats, byDomain, repeatOffenders, fraudSignals };
  }
}

/* ---- Mock Alerts ---- */

export class MockAlertsAdapter implements IAlertsAdapter {
  private alerts: AlertItem[] = [
    { id: cuid(), category: "Fuel", severity: "CRITICAL", title: "320 L unaccounted — Tank-Nagaur-01", message: "Physical dip disagrees with book balance by 320 L. Supplier delivery under investigation.", status: "Open", assetCode: "Tank-Nagaur-01", createdAt: new Date(Date.now() - 3600000 * 2).toISOString(), escalatedAt: null, assignedTo: null, actionUrl: "/fuel/anomalies" },
    { id: cuid(), category: "Maintenance", severity: "CRITICAL", title: "Service overdue — TATA-2518-A01", message: "Engine oil change has passed its 500-hour interval by 47 hours.", status: "Open", assetCode: "TATA-2518-A01", createdAt: new Date(Date.now() - 3600000 * 18).toISOString(), escalatedAt: new Date(Date.now() - 3600000 * 6).toISOString(), assignedTo: null, actionUrl: "/maintenance/schedules" },
    { id: cuid(), category: "Compliance", severity: "CRITICAL", title: "Fitness expired — JCB-3DX-E04", message: "Fitness certificate expired 12 days ago. Machine is still running at Jodhpur site.", status: "Open", assetCode: "JCB-3DX-E04", createdAt: new Date(Date.now() - 86400000 * 12).toISOString(), escalatedAt: null, assignedTo: "Rajesh Sharma", actionUrl: "/compliance/audit" },
    { id: cuid(), category: "Driver", severity: "WARNING", title: "Licence expiring — Suresh Singh", message: "Driving licence expires in 18 days. Renewal paperwork not submitted.", status: "Open", assetCode: null, createdAt: new Date(Date.now() - 86400000 * 3).toISOString(), escalatedAt: null, assignedTo: null, actionUrl: "/drivers/safety" },
    { id: cuid(), category: "Fuel", severity: "WARNING", title: "Diesel tank below reorder — Site-Barmer", message: "1,200 L remaining against a reorder level of 2,000 L. Next delivery not scheduled.", status: "Open", assetCode: "Tank-Barmer-01", createdAt: new Date(Date.now() - 3600000 * 8).toISOString(), escalatedAt: null, assignedTo: null, actionUrl: "/fuel/tanks" },
    { id: cuid(), category: "Operations", severity: "WARNING", title: "Double-booked — CAT-320D-E10", message: "Allocated to both Pali Bridge and Sikar NH projects from 5 Aug to 12 Aug.", status: "Open", assetCode: "CAT-320D-E10", createdAt: new Date(Date.now() - 86400000 * 1).toISOString(), escalatedAt: null, assignedTo: null, actionUrl: "/operations" },
    { id: cuid(), category: "Maintenance", severity: "WARNING", title: "Tyre below legal tread — TATA-LPK-D12", message: "Rear axle tyre SN-4488 at 1.2 mm tread. Legal minimum 1.6 mm.", status: "Acknowledged", assetCode: "TATA-LPK-D12", createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), escalatedAt: null, assignedTo: "Workshop Supervisor", actionUrl: "/tyres" },
    { id: cuid(), category: "Loss", severity: "WARNING", title: "Case open 21 days — FV-2026-0008", message: "Overbilling — Sharma Earthmovers (₹47,200) has had no disposition for 3 weeks.", status: "Open", assetCode: null, createdAt: new Date(Date.now() - 86400000 * 21).toISOString(), escalatedAt: new Date(Date.now() - 86400000 * 7).toISOString(), assignedTo: null, actionUrl: "/loss-prevention" },
    { id: cuid(), category: "Compliance", severity: "INFO", title: "Insurance expiring — TATA-SIGNA-T08", message: "Motor insurance expires in 28 days. Renewal quote requested from ICICI Lombard.", status: "Open", assetCode: "TATA-SIGNA-T08", createdAt: new Date(Date.now() - 86400000 * 4).toISOString(), escalatedAt: null, assignedTo: null, actionUrl: "/compliance/audit" },
    { id: cuid(), category: "Fuel", severity: "CRITICAL", title: "95 L night-time fuel drop — ASHOK-2820-D14", message: "Fuel level dropped 95 L between 11 PM and 4 AM with no trip logged.", status: "Resolved", assetCode: "ASHOK-2820-D14", createdAt: new Date(Date.now() - 86400000 * 5).toISOString(), escalatedAt: null, assignedTo: null, actionUrl: "/fuel/anomalies" },
  ];

  async getAlerts(filters?: { severity?: AlertSeverity; category?: string; status?: string }): Promise<AlertsResponse> {
    let list = [...this.alerts];
    if (filters?.severity) list = list.filter((a) => a.severity === filters.severity);
    if (filters?.category) list = list.filter((a) => a.category === filters.category);
    if (filters?.status) list = list.filter((a) => a.status === filters.status);

    const open = this.alerts.filter((a) => a.status === "Open");
    return {
      alerts: list,
      stats: {
        total: this.alerts.length,
        open: open.length,
        critical: open.filter((a) => a.severity === "CRITICAL").length,
        escalated: this.alerts.filter((a) => a.escalatedAt).length,
        resolved: this.alerts.filter((a) => a.status === "Resolved").length,
      },
    };
  }

  async acknowledge(id: string) {
    const a = this.alerts.find((x) => x.id === id);
    if (a) a.status = "Acknowledged";
    return { ok: true };
  }

  async escalate(id: string) {
    const a = this.alerts.find((x) => x.id === id);
    if (a) a.escalatedAt = new Date().toISOString();
    return { ok: true };
  }

  async assign(id: string, supervisor: string) {
    const a = this.alerts.find((x) => x.id === id);
    if (a) { a.assignedTo = supervisor; a.status = "Acknowledged"; }
    return { ok: true };
  }

  async resolve(id: string) {
    const a = this.alerts.find((x) => x.id === id);
    if (a) a.status = "Resolved";
    return { ok: true };
  }
}

/* ======================== FACTORY ======================== */

/** Swap these to Live* adapters when telemetry APIs are available. */
export function createLossPreventionAdapter(): ILossPreventionAdapter {
  return new MockLossPreventionAdapter();
}

export function createAlertsAdapter(): IAlertsAdapter {
  return new MockAlertsAdapter();
}
