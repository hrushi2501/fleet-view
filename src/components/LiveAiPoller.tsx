"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically hits the AI ingestion pipeline and refreshes the router
 * to pull the latest AI detections into the Server Components.
 */
export function LiveAiPoller({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const poll = async () => {
      try {
        await fetch("/api/insight/ai-scan", { method: "POST" });
        router.refresh();
      } catch (err) {
        console.error("Failed to poll AI ingestion stream", err);
      }
    };

    // Initial poll
    poll();
    
    const id = setInterval(poll, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return (
    <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold tracking-wider text-emerald-600">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
      </span>
      AI TELEMETRY LIVE
    </div>
  );
}
