/**
 * "My Vehicle" — everything about the one machine this driver is responsible
 * for, and the form for telling the workshop something is wrong with it.
 *
 * Position is shown as a place name, never as coordinates: a driver knows the
 * quarry by its name and has no use for 27.9159, 73.8465. See `whereIsIt` for
 * how the name is worked out and what is said when there is honestly no name to
 * give.
 */
import { requirePage } from "@/lib/access";
import { Progress } from "@/components/ui";
import { TERMS } from "@/lib/navigation";
import { ASSET_CLASS_LABEL, num, timeAgo } from "@/lib/utils";
import { myBasics, latestIgnition, myShift, vehicleState, whereIsIt, myEmergencyContacts } from "../_data";
import { MyHeader, Screen, Hero, Fact, Notice, NotLinked } from "../_ui";
import { DriverQrScanner } from "@/components/DriverQrScanner";
import { DriverTripEndScanner } from "@/components/DriverTripEndScanner";
import { DriverReportForm } from "@/components/DriverReportForm";

export const dynamic = "force-dynamic";

export default async function MyVehiclePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const access = await requirePage("my.vehicle");
  const { driver, vehicle } = await myBasics(access);
  const { error } = await searchParams;

  if (!driver) {
    return (
      <Screen>
        <MyHeader href="/my/vehicle" />
        <NotLinked loginName={access.session.email} />
      </Screen>
    );
  }

  if (!vehicle) {
    return (
      <Screen>
        <MyHeader href="/my/vehicle" />
        <DriverQrScanner triggerVariant="card" />
      </Screen>
    );
  }

  const now = new Date();
  const [ignition, place, shift, emergency] = await Promise.all([
    latestIgnition(vehicle.id),
    whereIsIt(vehicle),
    myShift(driver.id, access.session.id),
    myEmergencyContacts(vehicle.projectId),
  ]);
  const state = vehicleState(vehicle, ignition, now);

  const meterUnit = vehicle.primaryMeter === "SMU" ? "hours" : "km";
  const fuelPct = vehicle.fuelLevelPct;
  const fuelLitres =
    fuelPct != null && vehicle.fuelCapacity > 0 ? Math.round((fuelPct / 100) * vehicle.fuelCapacity) : null;

  return (
    <Screen>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MyHeader href="/my/vehicle" note={vehicle.registrationNo ?? vehicle.code} />
        {shift.hasActiveTrip
          ? <DriverTripEndScanner vehicleCode={vehicle.code} />
          : <DriverQrScanner triggerVariant="button" />}
      </div>

      {error && <Notice tone="warn" title="Problem save nahi hui — ek option chunkar dobara try karo." />}

      <Hero tone={state.tone} label={state.label} hint={state.hint} meta={`Last update ${timeAgo(vehicle.lastSeen)}`} />

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <p className="text-sm font-medium text-slate-500">{TERMS.Telematics}</p>
        <p className="mt-1 text-xl font-bold leading-snug text-ink-900">{place}</p>
        <p className="mt-1 text-sm text-slate-400">{vehicle.projectName ?? "No site recorded"}</p>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium text-slate-500">Fuel in tank</p>
          <p className="text-2xl font-bold text-ink-900">{fuelPct != null ? `${Math.round(fuelPct)}%` : "—"}</p>
        </div>
        {fuelPct != null ? (
          <>
            <Progress value={fuelPct} className="mt-3 h-3" />
            <p className="mt-2 text-sm text-slate-400">
              {fuelLitres != null ? `About ${num(fuelLitres)} litres` : "Tank size not recorded"}
            </p>
          </>
        ) : (
          // Saying nothing would read as an empty tank; saying "0%" would be a lie.
          <p className="mt-2 text-base text-slate-500">Is vehicle ka fuel data nahi aata. Fill karte waqt photo lein.</p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Fact label="Meter reading" value={num(vehicle.meterValue)} sub={meterUnit} />
        <Fact label="Vehicle" value={ASSET_CLASS_LABEL[vehicle.assetClass] ?? vehicle.assetClass} sub={vehicle.code} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Fact label="Make & model" value={vehicle.name.split("(")[0].trim()} />
        <Fact label="Workshop status" value={vehicle.status} />
      </div>

      <DriverReportForm
        assetId={vehicle.id}
        vehicleCode={vehicle.registrationNo ?? vehicle.code}
        contacts={emergency.contacts}
        missingCompanyContacts={emergency.missingCompanyContacts}
        returnToReport={false}
      />
    </Screen>
  );
}
