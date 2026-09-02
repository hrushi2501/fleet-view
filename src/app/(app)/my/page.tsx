/**
 * "My Work" — the driver's home screen, and the only page most of them will
 * ever open.
 *
 * The question it answers is the one asked at the start of a shift: can I take
 * this vehicle out, and what does somebody need to know about it? Everything
 * that could stop the truck at a check post or on the hard shoulder is at the
 * top; the rest is a list of doors to walk through.
 *
 * Every query below hangs off `access.driverId`. There is deliberately no code
 * path that reads the fleet.
 */
import { requirePage } from "@/lib/access";
import { fmtDate } from "@/lib/utils";
import {
  myBasics, latestIgnition, vehicleState, whereIsIt, myTrips,
  myShift, myServiceDue, myPersonDocs, myVehicleDocs, type DocRow,
} from "./_data";
import { MyHeader, Screen, Hero, Notice, Fact, Tile, NotLinked } from "./_ui";
import { DriverQrScanner } from "@/components/DriverQrScanner";
import { DriverQuickHub } from "@/components/DriverQuickHub";

export const dynamic = "force-dynamic";

export default async function MyWorkPage() {
  const access = await requirePage("my.work");
  const { driver, vehicle } = await myBasics(access);

  if (!driver) {
    return (
      <Screen>
        <MyHeader href="/my" />
        <NotLinked loginName={access.session.email} />
      </Screen>
    );
  }

  const now = new Date();

  // Only the driver's own rows are ever fetched — their trips, their shift,
  // their papers, and the one vehicle assigned to them.
  const [trips, shift, ignition, personDocs] = await Promise.all([
    myTrips(driver.id, 30),
    myShift(driver.id, now),
    vehicle ? latestIgnition(vehicle.id) : Promise.resolve(null),
    myPersonDocs(driver, now),
  ]);

  const [place, service, vehicleDocs] = await Promise.all([
    vehicle ? whereIsIt(vehicle) : Promise.resolve(""),
    vehicle ? myServiceDue(vehicle, now) : Promise.resolve([]),
    vehicle ? myVehicleDocs(vehicle.id, now) : Promise.resolve([]),
  ]);

  const overdue = service.filter((s) => s.status === "overdue");
  const dueSoon = service.filter((s) => s.status === "due");

  // Papers a driver would be stopped for, and papers about to become that.
  const allDocs = [...personDocs, ...vehicleDocs];
  const expired = allDocs.filter((d) => d.state === "expired" || d.state === "missing");
  const expiring = allDocs.filter((d) => d.state === "expiring");

  const state = vehicle ? vehicleState(vehicle, ignition, now) : null;

  return (
    <Screen>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MyHeader href="/my" note={`${driver.name.split(" ")[0]} · ${fmtDate(now)}`} />
      </div>

      {!shift.hasActiveTrip && (
        <DriverQrScanner triggerVariant="card" />
      )}

      {vehicle && shift.hasActiveTrip && (
        <DriverQuickHub
          driverName={driver.name}
          vehicle={{
            id: vehicle.id,
            code: vehicle.code,
            name: vehicle.name,
            registrationNo: vehicle.registrationNo,
            meterValue: vehicle.meterValue,
            primaryMeter: vehicle.primaryMeter,
            fuelLevelPct: vehicle.fuelLevelPct,
            fuelCapacity: vehicle.fuelCapacity,
          }}
          expiredDocsCount={expired.length}
          overdueServiceCount={overdue.length}
        />
      )}

      {vehicle && state && (
        <>
          <Hero
            tone={state.tone}
            label={state.label}
            hint={state.hint}
            meta={`${vehicle.registrationNo ?? vehicle.code} · ${place}`}
          />
        </>
      )}

      <Fact label="Duty" value={shift.label} sub={shift.detail} tone={shift.tone} />

      {/* Anything below this line is a reason to talk to the supervisor before
          moving the vehicle, so it sits above the navigation, not under it. */}
      {expired.length > 0 && (
        <Notice
          tone="bad"
          title="Papers pura nahi hai — vehicle mat nikaalein"
          lines={expired.map(docLine)}
          href="/my/documents"
          cta="See documents"
        />
      )}

      {overdue.length > 0 && (
        <Notice
          tone="bad"
          title="Service overdue"
          lines={overdue.map((s) => `${s.task} — ${s.label}`)}
          href="/my/service"
          cta="See service"
        />
      )}

      {overdue.length === 0 && dueSoon.length > 0 && (
        <Notice
          tone="warn"
          title="Service due"
          lines={dueSoon.map((s) => `${s.task} — ${s.label}`)}
          href="/my/service"
          cta="See service"
        />
      )}

      {expired.length === 0 && expiring.length > 0 && (
        <Notice
          tone="warn"
          title="Documents expiring soon"
          lines={expiring.map(docLine)}
          href="/my/documents"
          cta="See documents"
        />
      )}

      <nav className="space-y-3">
        <Tile href="/my/vehicle" label="My Vehicle" hint={vehicle ? (vehicle.registrationNo ?? vehicle.code) : "No vehicle yet"} />
        <Tile href="/my/trips" label="My Trips" hint={`${trips.length} recent trips`} />
        <Tile href="/my/fuel" label="Fuel" hint="Diesel bharne ka record" />
        <Tile
          href="/my/service"
          label="Service"
          hint="Service due aur problems"
          badge={overdue.length > 0 ? { tone: "bad", text: String(overdue.length) } : undefined}
        />
        <Tile
          href="/my/documents"
          label="My Documents"
          hint="Licence aur vehicle papers"
          badge={expired.length > 0 ? { tone: "bad", text: String(expired.length) } : undefined}
        />
      </nav>
    </Screen>
  );
}

/** One line of plain warning per document, with the number of days spelled out. */
function docLine(d: DocRow): string {
  if (d.state === "missing") return `${d.label} — record nahi hai`;
  if (d.state === "expired") return `${d.label} — expired ${Math.abs(d.days ?? 0)} days ago`;
  return `${d.label} — ${d.days} days left`;
}
