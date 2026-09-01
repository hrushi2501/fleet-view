/**
 * Hierarchical TanStack Query key factory.
 *
 * Scopes queries predictably for targeted client-side caching and atomic
 * cache invalidation after mutations across all ERP subsystems.
 */

export const queryKeys = {
  // Fleet & Telematics
  fleet: {
    all: ["fleet"] as const,
    live: () => ["fleet", "live"] as const,
    detail: (id: string) => ["fleet", "detail", id] as const,
    track: (assetId: string) => ["fleet", "track", assetId] as const,
    trips: (assetId?: string) => ["fleet", "trips", assetId ?? "all"] as const,
  },

  // Fuel Management & Intelligence
  fuel: {
    all: ["fuel"] as const,
    summary: (days?: number) => ["fuel", "summary", days ?? 30] as const,
    anomalies: (status?: string) => ["fuel", "anomalies", status ?? "OPEN"] as const,
    telemetry: (assetId?: string) => ["fuel", "telemetry", assetId ?? "all"] as const,
    tanks: () => ["fuel", "tanks"] as const,
  },

  // Operational Alerts
  alerts: {
    all: ["alerts"] as const,
    list: (filters?: { severity?: string; category?: string; status?: string }) =>
      ["alerts", "list", filters ?? {}] as const,
  },

  // Loss Prevention & Fraud Cases
  lossPrevention: {
    all: ["loss-prevention"] as const,
    summary: () => ["loss-prevention", "summary"] as const,
    caseDetail: (id: string) => ["loss-prevention", "case", id] as const,
  },

  // System & Topbar Operational Stats
  stats: {
    all: ["stats"] as const,
    summary: () => ["stats", "summary"] as const,
  },

  // Global Command Palette Search
  search: {
    all: ["search"] as const,
    query: (q: string) => ["search", q] as const,
  },

  // Maintenance & Workshop
  maintenance: {
    all: ["maintenance"] as const,
    workOrders: (status?: string) => ["maintenance", "workOrders", status ?? "all"] as const,
    reminders: () => ["maintenance", "reminders"] as const,
    tyres: () => ["maintenance", "tyres"] as const,
  },

  // Construction Site Production
  production: {
    all: ["production"] as const,
    siteWork: (projectId?: string) => ["production", "siteWork", projectId ?? "all"] as const,
    vehicleDetail: (assetId: string) => ["production", "vehicleDetail", assetId] as const,
  },

  // Compliance Documents
  compliance: {
    all: ["compliance"] as const,
    matrix: () => ["compliance", "matrix"] as const,
    assetDocs: (assetId: string) => ["compliance", "asset", assetId] as const,
  },
} as const;
