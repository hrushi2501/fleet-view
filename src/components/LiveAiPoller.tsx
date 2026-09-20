"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically hits the AI ingestion pipeline and refreshes the router
 * to pull the latest AI detections into the Server Components.
 */
export function LiveAiPoller({ intervalMs = 300_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;

    const scheduleNext = (delayMs: number) => {
      if (!isMounted) return;
      timeoutId = setTimeout(runPoll, delayMs);
    };

    const runPoll = async () => {
      let nextDelay = intervalMs;
      try {
        const res = await fetch("/api/insight/ai-scan", { method: "POST" });
        if (res.ok) {
          router.refresh();
        } else if (res.status === 429) {
          const retryHeader = res.headers.get("Retry-After");
          if (retryHeader) {
            const retrySec = parseInt(retryHeader, 10);
            if (!isNaN(retrySec) && retrySec > 0) {
              nextDelay = Math.max(intervalMs, retrySec * 1000);
            }
          } else {
            try {
              const body = await res.json();
              if (body?.retryInSeconds && body.retryInSeconds > 0) {
                nextDelay = Math.max(intervalMs, body.retryInSeconds * 1000);
              }
            } catch {
              // Ignore json parsing error
            }
          }
        }
      } catch (err) {
        console.error("Failed to poll AI ingestion stream", err);
      } finally {
        scheduleNext(nextDelay);
      }
    };

    // Initial poll
    runPoll();

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
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
