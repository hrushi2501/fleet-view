import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";

/**
 * Invalidation utilities to prevent concurrency bugs and stale data display
 * when server actions or REST API mutations execute.
 */

/** Invalidate all fleet live tracking, asset profiles, and global stats */
export async function invalidateFleetQueries(client: QueryClient, assetId?: string): Promise<void> {
  const promises: Promise<void>[] = [
    client.invalidateQueries({ queryKey: queryKeys.fleet.all }),
    client.invalidateQueries({ queryKey: queryKeys.stats.all }),
  ];
  if (assetId) {
    promises.push(client.invalidateQueries({ queryKey: queryKeys.fleet.detail(assetId) }));
  }
  await Promise.all(promises);
}

/** Invalidate fuel summary, anomaly queue, tank balances, and loss prevention */
export async function invalidateFuelQueries(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.fuel.all }),
    client.invalidateQueries({ queryKey: queryKeys.lossPrevention.all }),
    client.invalidateQueries({ queryKey: queryKeys.stats.all }),
  ]);
}

/** Invalidate operational alerts and system notification counters */
export async function invalidateAlertsQueries(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.alerts.all }),
    client.invalidateQueries({ queryKey: queryKeys.stats.all }),
  ]);
}

/** Invalidate maintenance work orders, PM reminders, and tyre tracking */
export async function invalidateMaintenanceQueries(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.maintenance.all }),
    client.invalidateQueries({ queryKey: queryKeys.fleet.all }),
    client.invalidateQueries({ queryKey: queryKeys.alerts.all }),
    client.invalidateQueries({ queryKey: queryKeys.stats.all }),
  ]);
}

/** Invalidate site production records, shift summaries, and asset output metrics */
export async function invalidateProductionQueries(client: QueryClient, assetId?: string): Promise<void> {
  const promises: Promise<void>[] = [
    client.invalidateQueries({ queryKey: queryKeys.production.all }),
    client.invalidateQueries({ queryKey: queryKeys.stats.all }),
  ];
  if (assetId) {
    promises.push(client.invalidateQueries({ queryKey: queryKeys.production.vehicleDetail(assetId) }));
  }
  await Promise.all(promises);
}

/** Invalidate loss prevention cases, financial recoveries, and risk scorecards */
export async function invalidateLossPreventionQueries(client: QueryClient, caseId?: string): Promise<void> {
  const promises: Promise<void>[] = [
    client.invalidateQueries({ queryKey: queryKeys.lossPrevention.all }),
    client.invalidateQueries({ queryKey: queryKeys.fuel.all }),
    client.invalidateQueries({ queryKey: queryKeys.stats.all }),
  ];
  if (caseId) {
    promises.push(client.invalidateQueries({ queryKey: queryKeys.lossPrevention.caseDetail(caseId) }));
  }
  await Promise.all(promises);
}

/** Invalidate compliance document matrix and expiry countdowns */
export async function invalidateComplianceQueries(client: QueryClient, assetId?: string): Promise<void> {
  const promises: Promise<void>[] = [
    client.invalidateQueries({ queryKey: queryKeys.compliance.all }),
    client.invalidateQueries({ queryKey: queryKeys.stats.all }),
  ];
  if (assetId) {
    promises.push(client.invalidateQueries({ queryKey: queryKeys.compliance.assetDocs(assetId) }));
    promises.push(client.invalidateQueries({ queryKey: queryKeys.fleet.detail(assetId) }));
  }
  await Promise.all(promises);
}

/** Invalidate search cache when entities are added/renamed/removed */
export async function invalidateSearchQueries(client: QueryClient): Promise<void> {
  await client.invalidateQueries({ queryKey: queryKeys.search.all });
}

/** Nuclear invalidation for full state sync (e.g. on auth change or major reset) */
export async function invalidateAllQueries(client: QueryClient): Promise<void> {
  await client.invalidateQueries();
}
