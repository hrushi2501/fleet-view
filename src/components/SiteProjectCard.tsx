"use client";

import { useState, useId, type ReactNode, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

/**
 * Helper client component to isolate event handlers (e.g. stopPropagation)
 * without passing functions as props from Server Components.
 */
export function CardActions({ children }: { children: ReactNode }) {
  return (
    <div className="ml-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

/**
 * An expandable project card used on the unified Sites & Projects page.
 *
 * - Header (always visible): project info, budget bar, asset count, site chips
 * - Expandable body: Plan vs Actual, Allocations, Mobilisation tables
 */
export function ProjectCard({
  header,
  sites,
  children,
  defaultOpen = false,
}: {
  header: ReactNode;
  sites: ReactNode;
  children: ReactNode; // expandable sections
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(!open);
    }
  };

  return (
    <div className="card overflow-hidden p-0">
      {/* Header — always visible */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
        onKeyDown={handleKeyDown}
        className="flex w-full cursor-pointer items-start justify-between gap-4 p-5 text-left transition-colors hover:bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      >
        <div className="min-w-0 flex-1">{header}</div>
        <ChevronDown
          className={cn(
            "mt-1 h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </div>

      {/* Sites strip — always visible */}
      {sites}

      {/* Expandable body */}
      <div
        id={contentId}
        role="region"
        aria-hidden={!open}
        className={cn(
          "grid transition-all duration-300 ease-in-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className={open ? "min-h-0" : "overflow-hidden"}>{children}</div>
      </div>
    </div>
  );
}

/**
 * A collapsible section within a project card or standalone.
 */
export function CollapsibleSection({
  title,
  subtitle,
  badge,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className="card overflow-hidden p-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-ink-900">{title}</h3>
            {badge}
          </div>
          {subtitle && (
            <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        id={contentId}
        role="region"
        aria-hidden={!open}
        className={cn(
          "grid transition-all duration-300 ease-in-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className={open ? "min-h-0" : "overflow-hidden"}>{children}</div>
      </div>
    </div>
  );
}
