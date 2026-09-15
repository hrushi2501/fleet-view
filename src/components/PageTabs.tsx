import Link from "next/link";
import { Txt } from "@/components/Txt";

/**
 * The tab strip that holds a consolidated module together.
 *
 * The restructure folded roughly thirty pages into nine modules, and most of
 * those folds put two or three former pages onto one screen. Stacking them all
 * vertically would have made a very long page and thrown away the one thing the
 * old separate routes did well — you could open exactly the view you wanted and
 * link someone straight to it.
 *
 * So the sections stay addressable: the tab is a `?tab=` link, not client
 * state. That keeps every view server-rendered and bookmarkable, means the
 * browser Back button behaves, and — the part that matters on a site office
 * connection — means only the selected section's queries run.
 */
export type Tab = {
  /** `?tab=` value. The first tab is the default and omits the parameter. */
  key: string;
  label: string;
  /** Optional count or short status shown beside the label. */
  badge?: string | number;
};

export function PageTabs({
  tabs,
  active,
  basePath,
}: {
  tabs: Tab[];
  active: string;
  basePath: string;
}) {
  if (tabs.length < 2) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-slate-100 p-1 text-sm font-medium">
      {tabs.map((t, i) => {
        const isActive = t.key === active;
        // The default tab keeps the bare URL, so the module's own address stays
        // the one people share.
        const href = i === 0 ? basePath : `${basePath}?tab=${t.key}`;
        return (
          <Link
            key={t.key}
            href={href}
            prefetch={false}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 transition-all ${
              isActive
                ? "bg-white font-bold text-ink-900 shadow-sm"
                : "text-slate-600 hover:bg-white/60 hover:text-ink-900"
            }`}
          >
            <Txt text={t.label} />
            {t.badge != null && t.badge !== "" && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  isActive ? "bg-brand-50 text-brand-700" : "bg-white/70 text-slate-500"
                }`}
              >
                {t.badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Resolves the requested tab, falling back to the first one.
 *
 * A stale bookmark pointing at a tab that no longer exists should land on the
 * module rather than on an empty screen, which is why an unknown value is not
 * an error.
 */
export function resolveTab(requested: string | string[] | undefined, tabs: Tab[]): string {
  const key = Array.isArray(requested) ? requested[0] : requested;
  return tabs.some((t) => t.key === key) ? (key as string) : tabs[0].key;
}
