/**
 * Dispatcher order for a mixed fleet list.
 *
 * Work in motion needs attention first, then running-but-stationary machines,
 * then parked assets, then vehicles whose GPS feed is unavailable. Keep the
 * same stable registration/code ordering inside each group so a dispatcher can
 * scan the list without it shuffling on every live refresh.
 */
export const DISPATCH_STATUS_ORDER = ["MOVING", "IDLING", "STOPPED", "OFFLINE", "BREAKDOWN"] as const;

const statusRank = new Map<string, number>(DISPATCH_STATUS_ORDER.map((status, index) => [status, index]));

type SortableVehicle = {
  status: string;
  registrationNo?: string | null;
  code?: string | null;
};

export function sortLiveVehiclesByStatus<T extends SortableVehicle>(vehicles: readonly T[]): T[] {
  return [...vehicles].sort((a, b) => {
    const byStatus = (statusRank.get(a.status) ?? Number.MAX_SAFE_INTEGER)
      - (statusRank.get(b.status) ?? Number.MAX_SAFE_INTEGER);
    if (byStatus !== 0) return byStatus;

    const aLabel = a.registrationNo ?? a.code ?? "";
    const bLabel = b.registrationNo ?? b.code ?? "";
    return aLabel.localeCompare(bLabel, "en", { numeric: true, sensitivity: "base" });
  });
}
