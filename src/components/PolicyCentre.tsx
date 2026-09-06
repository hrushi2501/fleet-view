import { Card } from "@/components/ui";
import { DRIVER_POLICY_SUMMARY, POLICY_ISSUANCE_REQUIREMENTS, POLICY_SECTIONS, POLICY_VERSION } from "@/lib/policies";
import { BadgeCheck, FileText, LockKeyhole, ShieldCheck } from "lucide-react";

export function PolicyCentre({ audience }: { audience: "office" | "driver" }) {
  const driver = audience === "driver";

  return (
    <section className={driver ? "space-y-5" : "mx-auto max-w-4xl space-y-6"} aria-labelledby="policy-centre-title">
      <header className={driver ? "space-y-2" : "rounded-2xl bg-brand-600 px-6 py-7 text-white shadow-lg shadow-brand-500/15"}>
        <div className="flex items-center gap-3">
          <span className={driver ? "flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700" : "flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 text-white"}>
            <ShieldCheck className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 id="policy-centre-title" className={driver ? "text-2xl font-bold tracking-tight text-ink-900" : "text-2xl font-bold tracking-tight"}>Policies &amp; privacy</h1>
            <p className={driver ? "text-sm text-slate-500" : "mt-1 text-sm text-white/80"}>Mahadev Constructions · FleetView</p>
          </div>
        </div>
        <p className={driver ? "text-base leading-relaxed text-slate-700" : "mt-5 max-w-2xl text-base leading-relaxed text-white/90"}>
          Clear rules for using FleetView, handling work records, and understanding how vehicle and workforce data is used.
        </p>
      </header>

      <Card className="border-brand-100 bg-brand-50/50">
        <div className="flex items-start gap-3">
          <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
          <div>
            <p className="font-semibold text-ink-900">Status: ready for Mahadev approval</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-700">
              Version {POLICY_VERSION}. Mahadev HR/legal must name the privacy contact and approve retention periods before formally issuing this policy.
            </p>
          </div>
        </div>
      </Card>

      {driver && <DriverSummary />}

      <div className="space-y-4">
        {POLICY_SECTIONS.map((section) => (
          <Card key={section.id} as="article" className="p-5">
            <h2 className="text-lg font-bold tracking-tight text-ink-900">{section.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{section.summary}</p>
            <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-slate-700">
              {section.points.map((point) => (
                <li key={point} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden /><span>{point}</span></li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card className="bg-slate-50">
        <div className="flex items-center gap-2 text-ink-900"><LockKeyhole className="h-5 w-5 text-brand-700" aria-hidden /><h2 className="font-bold">Before formal issue</h2></div>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-700">
          {POLICY_ISSUANCE_REQUIREMENTS.map((item) => <li key={item} className="flex gap-2.5"><span className="font-bold text-brand-700" aria-hidden>•</span><span>{item}</span></li>)}
        </ul>
      </Card>

      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-slate-500"><FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />This internal notice does not replace an applicable law, employment or contractor agreement, or Mahadev emergency procedure.</p>
    </section>
  );
}

function DriverSummary() {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-ink-900">आपके लिए आसान बात / What this means for you</h2></div>
      <div className="grid divide-y divide-slate-100">
        {DRIVER_POLICY_SUMMARY.hi.map((hindi, index) => (
          <div key={hindi} className="px-5 py-4">
            <p lang="hi" className="text-sm font-medium leading-relaxed text-ink-900">{hindi}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{DRIVER_POLICY_SUMMARY.en[index]}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
