import { LoaderCircle, MapPinned } from "lucide-react";
import { Txt } from "@/components/Txt";

function LoadingLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-brand-700" role="status" aria-live="polite">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function StatusLoading({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
      <LoadingLabel><Txt text={label} />…</LoadingLabel>
    </div>
  );
}

export function FuelSectionLoading({ compact = false }: { compact?: boolean }) {
  return (
    <section className="space-y-5" aria-busy="true">
      <LoadingLabel><Txt text="Loading fuel data" /></LoadingLabel>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: compact ? 4 : 6 }, (_, index) => (
          <div key={index} className="animate-pulse rounded-[13px] border border-slate-200 bg-white p-5">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-7 w-20 rounded bg-slate-200/90" />
            <div className="mt-2 h-3 w-28 rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-64 animate-pulse rounded-[13px] border border-slate-200 bg-white p-5 lg:col-span-2">
          <div className="h-4 w-40 rounded bg-slate-200" />
          <div className="mt-6 h-44 rounded-xl bg-slate-100" />
        </div>
        <div className="h-64 animate-pulse rounded-[13px] border border-slate-200 bg-white p-5">
          <div className="h-4 w-32 rounded bg-slate-200" />
          <div className="mt-6 space-y-4">
            {[0, 1, 2, 3].map((row) => <div key={row} className="h-3 rounded bg-slate-100" />)}
          </div>
        </div>
      </div>
    </section>
  );
}

export function LiveTrackingLoading() {
  return (
    <section className="space-y-4" aria-busy="true">
      <LoadingLabel><Txt text="Loading live vehicle positions" /></LoadingLabel>
      <div className="relative h-[560px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
        <div className="absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_30%_35%,#dbeafe_0,transparent_22%),radial-gradient(circle_at_70%_65%,#dcfce7_0,transparent_20%)]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-3 rounded-xl border border-white/80 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-700 shadow-lg">
            <MapPinned className="h-5 w-5 text-brand-600" aria-hidden="true" />
            <Txt text="Connecting to fleet map" />…
          </div>
        </div>
      </div>
    </section>
  );
}
