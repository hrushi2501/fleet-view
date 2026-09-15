"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Txt } from "@/components/Txt";

/**
 * Immediate feedback for an App Router navigation.
 *
 * A route can still need a server round trip even when its shared layout stays
 * interactive. Listening at the document level lets us acknowledge a Link tap
 * at once, including query-string tab changes, and the router state closes the
 * indicator only after the destination has arrived.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams}`;
  const [navigating, setNavigating] = useState(false);
  const routeKeyRef = useRef(routeKey);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (routeKeyRef.current !== routeKey) {
      const startedAt = startedAtRef.current;
      if (startedAt !== null) {
        const durationMs = Math.round(performance.now() - startedAt);
        if (durationMs > 1_500) {
          console.warn("[navigation-slow]", JSON.stringify({ from: routeKeyRef.current, to: routeKey, durationMs }));
        }
      }
      startedAtRef.current = null;
      routeKeyRef.current = routeKey;
      setNavigating(false);
    }
  }, [routeKey]);

  useEffect(() => {
    const beginNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;

      const destination = new URL(link.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname &&
          destination.search === window.location.search)
      ) return;

      startedAtRef.current = performance.now();
      setNavigating(true);
    };

    const completeHistoryNavigation = () => setNavigating(false);
    document.addEventListener("click", beginNavigation, true);
    window.addEventListener("popstate", completeHistoryNavigation);
    return () => {
      document.removeEventListener("click", beginNavigation, true);
      window.removeEventListener("popstate", completeHistoryNavigation);
    };
  }, []);

  if (!navigating) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100]" role="status" aria-live="polite">
      <span className="sr-only"><Txt text="Opening page" /></span>
      <div className="h-1 overflow-hidden bg-brand-100/80">
        <div className="navigation-progress h-full bg-brand-500 shadow-[0_0_10px_rgba(51,102,255,0.8)]" />
      </div>
    </div>
  );
}
