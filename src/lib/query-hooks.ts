"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";
import { invalidateAlertsQueries } from "./query-invalidation";
import type { LiveFleet } from "./fleet-edge-live";
import type { SearchResultItem } from "@/app/api/search/route";

/* =========================================================================
 * 1. FLEET & TELEMATICS HOOKS
 * ========================================================================= */

/**
 * Live Fleet Tracking Hook
 *
 * Provides real-time coordinates, live motion statuses, fuel levels, and meters.
 * Refetches every 15 seconds while the tab is active. Fleet Edge's upstream
 * sync runs every two minutes, so a faster loop only repeats the same database
 * work and can starve normal authorization requests.
 */
export function useLiveFleet(initialData?: LiveFleet) {
  return useQuery({
    queryKey: queryKeys.fleet.live(),
    queryFn: async (): Promise<LiveFleet> => {
      const res = await fetch("/api/telematics/live", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to fetch live fleet: ${res.status}`);
      return res.json();
    },
    initialData,
    staleTime: 15 * 1000,
    refetchInterval: 15 * 1000,
    // Polling deliberately pauses for a hidden tab — a tracking screen left
    // open on a spare monitor should not query the fleet all night.
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    // ...but the moment somebody looks at it again, it must catch up.
    //
    // Without these two, pausing was a one-way door: nothing restarted the
    // poll on return, while the "last seen" counter went on ticking once a
    // second against data frozen at the moment the tab lost focus. On 2 Sep
    // the screen showed vehicles last seen "4m 17s ago" when the newest
    // readings in the database were 26 seconds old. A screen labelled Live
    // that quietly ages is worse than one that admits it is stale, because a
    // dispatcher reads the gap as a vehicle having stopped reporting.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 0,
  });
}

/**
 * 360° Asset Detail Profile Hook
 */
export function useAssetDetail<T = unknown>(assetId: string | null | undefined) {
  return useQuery<T | null>({
    queryKey: queryKeys.fleet.detail(assetId ?? ""),
    queryFn: async (): Promise<T | null> => {
      if (!assetId) return null;
      const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}`);
      if (!res.ok) throw new Error(`Asset ${assetId} not found`);
      return res.json();
    },
    enabled: Boolean(assetId),
    staleTime: 30 * 1000,
  });
}

/**
 * Historical GPS Track / Playback Hook
 */
export function useFleetTrack(assetId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.fleet.track(assetId ?? ""),
    queryFn: async () => {
      if (!assetId) return { readings: [] };
      const res = await fetch(`/api/telematics/track?assetId=${encodeURIComponent(assetId)}`);
      if (!res.ok) throw new Error("Failed to load tracking path");
      return res.json();
    },
    enabled: Boolean(assetId),
    staleTime: 60 * 1000,
  });
}

/* =========================================================================
 * 2. SEARCH PALETTE HOOK
 * ========================================================================= */

/**
 * Instant Cached Global Search
 */
export function useFleetSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: queryKeys.search.query(q),
    queryFn: async (): Promise<SearchResultItem[]> => {
      if (q.length < 2) return [];
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.results ?? [];
    },
    enabled: q.length >= 2,
    staleTime: 5 * 60 * 1000, // Search queries cached for 5 minutes
  });
}

/* =========================================================================
 * 3. OPERATIONAL ALERTS & MUTATIONS
 * ========================================================================= */

export interface AlertFilterOptions {
  severity?: string;
  category?: string;
  status?: string;
}

export function useAlerts(filters?: AlertFilterOptions) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.alerts.list(filters),
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (filters?.severity && filters.severity !== "ALL") sp.set("severity", filters.severity);
      if (filters?.category && filters.category !== "ALL") sp.set("category", filters.category);
      if (filters?.status && filters.status !== "ALL") sp.set("status", filters.status);

      const qs = sp.toString();
      const res = await fetch(`/api/insight/alerts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch alerts");
      return res.json();
    },
    staleTime: 20 * 1000,
  });

  const mutateAction = useMutation({
    mutationFn: async (payload: { id: string; action: string; supervisor?: string }) => {
      const res = await fetch("/api/insight/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Alert mutation failed");
      return res.json();
    },
    onSuccess: async () => {
      await invalidateAlertsQueries(queryClient);
    },
  });

  return {
    ...query,
    acknowledge: (id: string) => mutateAction.mutateAsync({ id, action: "acknowledge" }),
    escalate: (id: string) => mutateAction.mutateAsync({ id, action: "escalate" }),
    assign: (id: string, supervisor: string) => mutateAction.mutateAsync({ id, action: "assign", supervisor }),
    resolve: (id: string) => mutateAction.mutateAsync({ id, action: "resolve" }),
    isMutating: mutateAction.isPending,
  };
}

/* =========================================================================
 * 4. FUEL MANAGEMENT & ANOMALIES
 * ========================================================================= */

export function useFuelOverview(days = 30) {
  return useQuery({
    queryKey: queryKeys.fuel.summary(days),
    queryFn: async () => {
      const res = await fetch(`/api/fuel?days=${days}`);
      if (!res.ok) throw new Error("Failed to fetch fuel overview");
      return res.json();
    },
    staleTime: 30 * 1000,
  });
}

export function useFuelAnomalies(status = "OPEN") {
  return useQuery({
    queryKey: queryKeys.fuel.anomalies(status),
    queryFn: async () => {
      const res = await fetch(`/api/fuel/anomalies?status=${encodeURIComponent(status)}`);
      if (!res.ok) throw new Error("Failed to fetch fuel anomalies");
      return res.json();
    },
    staleTime: 30 * 1000,
  });
}

/* =========================================================================
 * 5. LOSS PREVENTION & FRAUD CASES
 * ========================================================================= */

export function useLossPrevention() {
  return useQuery({
    queryKey: queryKeys.lossPrevention.summary(),
    queryFn: async () => {
      const res = await fetch("/api/insight/loss-prevention");
      if (!res.ok) throw new Error("Failed to fetch loss prevention data");
      return res.json();
    },
    staleTime: 30 * 1000,
  });
}

/* =========================================================================
 * 6. GLOBAL OPERATIONAL STATS
 * ========================================================================= */

export function useFleetStats() {
  return useQuery({
    queryKey: queryKeys.stats.summary(),
    queryFn: async () => {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("Failed to fetch fleet stats");
      return res.json();
    },
    staleTime: 30 * 1000,
  });
}
