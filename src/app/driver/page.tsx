import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DriverFuelWizard } from "@/components/DriverFuelWizard";
import { LocationGate } from "@/components/LocationGate";
import { getDieselRate } from "@/lib/settings";
import { driverScorecard, type DriverLite, type ViolationLite, type CompetencyLite } from "@/lib/drivers";
import { assetCompliance, DOC_LABEL, type DocLite } from "@/lib/compliance";
import { pmDue, type ScheduleLite } from "@/lib/maintenance";
import { DriverTripPanel } from "@/components/DriverTripPanel";

export const dynamic = "force-dynamic";

export default async function DriverPortal() {
  const user = await getSession();
  if (!user) redirect("/login");

  const [assets, baseProject, recent, dieselRate] = await Promise.all([
    db.asset.findMany({ orderBy: { code: "asc" } }),
    db.project.findFirst({ orderBy: { code: "asc" } }),
    db.fuelTransaction.findMany({ where: { type: "ISSUE" }, orderBy: { date: "desc" }, take: 6, include: { asset: true } }),
    getDieselRate(),
  ]);

  // Resolve the signed-in login to a person record. The explicit link is
  // authoritative; the name match is only a fallback for accounts created before
  // that link existed, because matching humans by name string is brittle —
  // "Demo Driver" and "Demo" are one person and two strings.
  const account = await db.user.findUnique({ where: { id: user.id }, include: { driverRef: true } });
  const me = account?.driverRef ?? (await db.driver.findFirst({ where: { name: user.name } }));
  const myAsset = me ? assets.find((a) => a.driverId === me.id) ?? null : null;

  const [violations, competencies, myDocs, mySchedules] = await Promise.all([
    me ? db.violation.findMany({ where: { driverId: me.id } }) : Promise.resolve([]),
    me ? db.competency.findMany({ where: { driverId: me.id } }) : Promise.resolve([]),
    myAsset ? db.complianceDoc.findMany({ where: { assetId: myAsset.id } }) : Promise.resolve([]),
    myAsset ? db.maintenanceSchedule.findMany({ where: { assetId: myAsset.id, active: true } }) : Promise.resolve([]),
  ]);

  const card = me
    ? driverScorecard(
        { id: me.id, empCode: me.empCode, name: me.name, type: me.type, licenseNo: me.licenseNo, licenseExpiry: me.licenseExpiry, status: me.status } as DriverLite,
        violations.map((v): ViolationLite => ({ id: v.id, type: v.type, severity: v.severity, points: v.points, date: v.date, penalty: v.penalty, status: v.status })),
        competencies.map((c): CompetencyLite => ({ assetClass: c.assetClass, level: c.level, expiresOn: c.expiresOn }))
      )
    : null;

  // What the driver needs to know before setting off: papers and service.
  const comp = myAsset
    ? assetCompliance(
        myAsset.id,
        myAsset.category,
        myDocs.map((d): DocLite => ({ id: d.id, docType: d.docType, number: d.number, issueDate: d.issueDate, expiryDate: d.expiryDate, reminderDays: d.reminderDays, documentUrl: d.documentUrl }))
      )
    : null;

  const serviceDue = myAsset
    ? mySchedules
        .map((s) => {
          const lite: ScheduleLite = { id: s.id, taskName: s.taskName, intervalKm: s.intervalKm, intervalHours: s.intervalHours, intervalDays: s.intervalDays, lastDoneMeter: s.lastDoneMeter, lastDoneDate: s.lastDoneDate, estimatedCost: s.estimatedCost };
          return { task: s.taskName, due: pmDue(lite, myAsset.meterValue, myAsset.primaryMeter === "SMU") };
        })
        .filter((x) => x.due.status === "overdue" || x.due.status === "due")
    : [];

  const blocking = comp?.findings.filter((f) => f.blocking && (f.state === "expired" || f.state === "missing")) ?? [];

  // The live QR binding, if the driver is currently checked in to a vehicle.
  const activeSession = me
    ? await db.tripSession.findFirst({
        where: { driverId: me.id, status: "ACTIVE" },
        include: { asset: true },
        orderBy: { startedAt: "desc" },
      })
    : null;

  // Auto-redirect drivers without an active shift session to duty check-in
  if (user.role === "DRIVER" && !activeSession) {
    redirect("/driver/checkin");
  }
  const activePanel = activeSession
    ? {
        sessionId: activeSession.id,
        startedAt: activeSession.startedAt.toISOString(),
        trackingSource: activeSession.trackingSource,
        vehicle: {
          id: activeSession.asset.id, code: activeSession.asset.code,
          registrationNo: activeSession.asset.registrationNo, assetClass: activeSession.asset.assetClass,
          hasFuelSensor: activeSession.asset.hasFuelSensor, tracking: activeSession.trackingSource,
        },
      }
    : null;

  const vehicles = assets.map((a) => ({ id: a.id, code: a.code, regNo: a.registrationNo, name: a.name }));
  const recentData = recent.map((f) => ({
    id: f.id, code: f.asset?.code ?? "—", regNo: f.asset?.registrationNo ?? null,
    qty: Math.round(f.quantity), date: f.date.toISOString(), odo: f.odometerPhoto, pump: f.pumpPhoto,
  }));

  return (
    <LocationGate>
      {(myAsset || card) && (
        <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4">
          {myAsset && (
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">आपकी गाड़ी · Your vehicle</p>
              <p className="mt-0.5 text-xl font-bold text-ink-900">{myAsset.code}</p>
              <p className="text-sm text-slate-500">{myAsset.registrationNo ?? myAsset.name}</p>
            </div>
          )}

          {/* The driver stopped at a check post is the one who pays for expired papers. */}
          {blocking.length > 0 && (
            <div className="rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
              <p className="text-sm font-bold text-rose-800">⚠️ कागज़ पूरे नहीं हैं · Papers not in order</p>
              <ul className="mt-1 space-y-0.5 text-sm text-rose-700">
                {blocking.map((f) => (
                  <li key={f.docType}>
                    {DOC_LABEL[f.docType] ?? f.docType}: {f.state === "missing" ? "कोई रिकॉर्ड नहीं · not on record" : `${Math.abs(f.days ?? 0)} दिन पहले खत्म · expired`}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-rose-600">गाड़ी निकालने से पहले सुपरवाइज़र को बताएं · Tell your supervisor before taking the vehicle out.</p>
            </div>
          )}

          {serviceDue.length > 0 && (
            <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
              <p className="text-sm font-bold text-amber-800">🔧 सर्विस बाकी है · Service due</p>
              <ul className="mt-1 space-y-0.5 text-sm text-amber-700">
                {serviceDue.map((s, i) => <li key={i}>{s.task} — {s.due.label}</li>)}
              </ul>
            </div>
          )}

          {card && (
            <div className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-xl font-bold ${
                card.score >= 85 ? "bg-emerald-50 text-emerald-600" : card.score >= 70 ? "bg-brand-50 text-brand-600" : card.score >= 50 ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"
              }`}>
                {card.score}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">सुरक्षा स्कोर · Safety score</p>
                <p className="text-sm font-medium text-ink-900">
                  {card.violations === 0 ? "कोई शिकायत नहीं · No violations" : `${card.violations} violation${card.violations === 1 ? "" : "s"}`}
                </p>
                {card.licenceState !== "valid" && (
                  <p className={`text-xs ${card.licenceState === "expired" ? "font-semibold text-rose-600" : "text-amber-600"}`}>
                    लाइसेंस {card.licenceState === "expired" ? `${Math.abs(card.licenceDays)} दिन पहले खत्म · expired` : `${card.licenceDays} दिन बाकी · days left`}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <DriverTripPanel active={activePanel} hasCamera />

      <DriverFuelWizard vehicles={vehicles} driverName={user.name} recent={recentData} defaultProjectId={baseProject?.id ?? null} dieselRate={dieselRate} />
    </LocationGate>
  );
}
