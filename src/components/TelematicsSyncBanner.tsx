"use client";

import React, { useState, useTransition } from "react";
import { Radio, RefreshCw, CheckCircle2, AlertTriangle, AlertCircle, Clock } from "lucide-react";
import { triggerTataSync } from "@/app/(app)/tracking/actions";
import { useToast } from "@/components/Toast";
import { timeAgo, fmtDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { isActionError } from "@/lib/action-result";

export interface TelematicsSyncBannerProps {
  status: {
    enabled: boolean;
    configured: boolean;
    missingKeys: string[];
    provider: {
      id: string;
      code: string;
      name: string;
      lastSyncAt: Date | string | null;
      lastSyncStatus: string | null;
      lastSyncError: string | null;
    } | null;
    lastReadingAt: Date | string | null;
    activeVehiclesCount: number;
    totalReadingsCount: number;
  };
  className?: string;
}

export function TelematicsSyncBanner({ status, className }: TelematicsSyncBannerProps) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [lastSynced, setLastSynced] = useState<Date | null>(
    status.provider?.lastSyncAt ? new Date(status.provider.lastSyncAt) : null
  );
  const [lastStatus, setLastStatus] = useState<string | null>(status.provider?.lastSyncStatus ?? null);

  const isConfigured = status.configured && status.enabled;
  const syncStatus = lastStatus ?? (isConfigured ? "OK" : "DISABLED");
  const [mountedNow] = useState(() => Date.now());

  const handleSyncNow = () => {
    startTransition(async () => {
      try {
        const res = await triggerTataSync();
        if (isActionError(res)) { toast.error("Could not complete", res.error); return; }
        setLastSynced(new Date());
        if (res.ok) {
          if (res.skipped) {
            setLastStatus(res.skipped.includes("Rate limited") ? "RATE_LIMITED" : "OK");
            toast.info("Telematics Synced", res.skipped);
          } else {
            setLastStatus("OK");
            toast.success(
              "Fleet Edge Synced",
              `Fetched ${res.fetched} snapshot(s), stored ${res.stored} new reading(s).`
            );
          }
        } else {
          setLastStatus("ERROR");
          toast.error("Sync Failed", res.error ?? "Failed to connect to Tata Fleet Edge API");
        }
      } catch (err) {
        setLastStatus("ERROR");
        toast.error("Sync Error", err instanceof Error ? err.message : "Unexpected error during telematics sync");
      }
    });
  };

  const getStatusBadge = () => {
    if (!status.enabled) {
      return {
        cls: "bg-slate-100 text-slate-700 ring-slate-300",
        icon: Clock,
        label: "Sync Disabled",
        sub: "Set TATA_FLEET_EDGE_ENABLED=true",
      };
    }
    if (!status.configured) {
      return {
        cls: "bg-amber-100 text-amber-800 ring-amber-300",
        icon: AlertTriangle,
        label: "Config Incomplete",
        sub: `Missing: ${status.missingKeys.join(", ")}`,
      };
    }
    if (syncStatus === "RATE_LIMITED") {
      return {
        cls: "bg-amber-100 text-amber-800 ring-amber-300",
        icon: Clock,
        label: "Rate Limited (429)",
        sub: "Auto-retrying in 30s",
      };
    }
    if (syncStatus === "ERROR") {
      const recentPushReading =
        status.lastReadingAt && mountedNow - new Date(status.lastReadingAt).getTime() < 30 * 60_000;
      if (recentPushReading && status.lastReadingAt) {
        return {
          cls: "bg-emerald-100 text-emerald-800 ring-emerald-300",
          icon: CheckCircle2,
          label: "Live Webhook Connected",
          sub: `Streaming live telemetry (last reading ${timeAgo(status.lastReadingAt)})`,
        };
      }
      return {
        cls: "bg-rose-100 text-rose-800 ring-rose-300",
        icon: AlertCircle,
        label: "Sync Fault",
        sub: status.provider?.lastSyncError ?? "Check API credentials",
      };
    }
    if (syncStatus === "SCHEMA_DRIFT") {
      return {
        cls: "bg-amber-100 text-amber-800 ring-amber-300",
        icon: AlertTriangle,
        label: "Schema Drift",
        sub: status.provider?.lastSyncError ?? "Upstream payload structure modified",
      };
    }
    return {
      cls: "bg-emerald-100 text-emerald-800 ring-emerald-300",
      icon: CheckCircle2,
      label: "Live Connected",
      sub: "Auto-syncing every 60 seconds",
    };
  };

  const badge = getStatusBadge();
  const Icon = badge.icon;

  return (
    <div
      className={cn(
        "relative flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm backdrop-blur-sm sm:px-5",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-200/60">
          <Radio className={cn("h-5 w-5", isPending ? "animate-pulse text-brand-600" : "text-brand-500")} />
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-ink-900">Tata Fleet Edge API</span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
                badge.cls
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {badge.label}
            </span>
          </div>

          <p className="mt-0.5 text-xs text-slate-500">
            {badge.sub}
            {lastSynced && badge.label !== "Live Webhook Connected" && (
              <span className="ml-1.5 font-medium text-slate-600" suppressHydrationWarning>
                {"· "}
                {syncStatus === "OK" ? "Last synced" : "Last attempt"} {timeAgo(lastSynced)} ({fmtDate(lastSynced)})
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden text-right text-xs sm:block">
          <div className="font-semibold text-slate-700">
            {status.totalReadingsCount.toLocaleString("en-IN")} data points
          </div>
          <div className="text-slate-400">
            {status.activeVehiclesCount} reporting vehicle(s)
          </div>
        </div>

        <button
          onClick={handleSyncNow}
          disabled={isPending || !status.configured}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all duration-150",
            "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          )}
          title="Trigger an immediate pull from Tata Fleet Edge"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isPending && "animate-spin")} />
          {isPending ? "Syncing..." : "Sync Now"}
        </button>
      </div>
    </div>
  );
}
