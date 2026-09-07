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
import { myBasics, latestIgnition, myShift, vehicleState, whereIsIt, PROBLEM_KINDS } from "../_data";
import { MyHeader, Screen, Hero, Fact, Notice, NotLinked } from "../_ui";
import { reportProblem } from "../actions";
import { DriverQrScanner } from "@/components/DriverQrScanner";
import { DriverTripEndScanner } from "@/components/DriverTripEndScanner";

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
  const [ignition, place, shift] = await Promise.all([latestIgnition(vehicle.id), whereIsIt(vehicle), myShift(driver.id, access.session.id)]);
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

      {/* ------------------------------------------------------------------
          Report a problem.

          A plain form posting to a server action, so it works with a weak
          signal and no client JavaScript — which is the normal condition on a
          highway, not an edge case. The options are buttons rather than a text
          box because typing on a phone in a cab is the step where reports stop
          getting filed.
      ------------------------------------------------------------------- */}
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-lg font-bold text-ink-900">Koi problem hai?</h2>
        <p className="mt-1 text-sm text-slate-500">Tell the workshop. Pick what is wrong.</p>

        <form action={reportProblem} className="mt-4 space-y-3">
          <input type="hidden" name="assetId" value={vehicle.id} />

          <fieldset className="space-y-2">
            <legend className="sr-only">What is the problem?</legend>
            {PROBLEM_KINDS.map((p, i) => (
              <label
                key={p.value}
                className="flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl bg-slate-50 px-4 text-base font-semibold text-ink-900 ring-1 ring-slate-200 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700 has-[:checked]:ring-2 has-[:checked]:ring-brand-500"
              >
                <input
                  type="radio"
                  name="kind"
                  value={p.value}
                  defaultChecked={i === 0}
                  className="h-5 w-5 accent-brand-600"
                />
                {p.label}
              </label>
            ))}
          </fieldset>

          <label className="flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl bg-rose-50 px-4 text-base font-semibold text-rose-800 ring-1 ring-rose-200 has-[:checked]:ring-2 has-[:checked]:ring-rose-500">
            <input type="checkbox" name="stopped" className="h-5 w-5 accent-rose-600" />
            Gaadi chal nahi rahi
          </label>

          <textarea
            name="note"
            rows={3}
            maxLength={500}
            placeholder="Kuch aur batana hai? (optional)"
            className="w-full rounded-xl bg-slate-50 p-4 text-base text-ink-900 ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />

          <button
            type="submit"
            className="min-h-[56px] w-full rounded-xl bg-brand-600 text-lg font-bold text-white shadow-sm active:scale-[0.99] active:bg-brand-700"
          >
            Report problem
          </button>
        </form>
      </section>
    </Screen>
  );
}
