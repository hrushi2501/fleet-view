/**
 * "Fuel" — what has gone into this driver's vehicle, and the way to record the
 * next fill.
 *
 * The active duty already identifies the vehicle. The capture screen therefore
 * opens directly to a compact entry card; evidence remains optional and lives
 * behind a disclosure rather than forcing a photo-by-photo wizard.
 */
import Link from "next/link";
import { requirePage } from "@/lib/access";
import { DriverFuelWizard } from "@/components/DriverFuelWizard";
import { getFuelRate, normalizeFuelType } from "@/lib/settings";
import { TERMS } from "@/lib/navigation";
import { businessMonth } from "@/lib/business-time";
import { fmtDate, inr, num } from "@/lib/utils";
import { myBasics, myFuelFills, myShift } from "../_data";
import { MyHeader, NotLinked, NoVehicle, Notice, Screen, Fact, Group, Row, Nothing } from "../_ui";

export const dynamic = "force-dynamic";

export default async function MyFuelPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const access = await requirePage("my.fuel");
  const [{ driver, vehicle }, { action }] = await Promise.all([myBasics(access), searchParams]);

  if (!driver) {
    return (
      <Screen>
        <MyHeader href="/my/fuel" />
        <NotLinked loginName={access.session.name} />
      </Screen>
    );
  }

  const [fills, shift] = await Promise.all([
    myFuelFills(driver.id, vehicle?.id ?? null, 20),
    myShift(driver.id, access.session.id),
  ]);

  if (action === "fuel" && vehicle && shift.hasActiveTrip) {
    const fuelRate = await getFuelRate(vehicle.fuelType);
    return (
      <div className="-mx-4 -my-6 lg:-mx-8">
        <DriverFuelWizard
          vehicles={[{ id: vehicle.id, code: vehicle.code, regNo: vehicle.registrationNo, name: vehicle.name }]}
          defaultProjectId={vehicle.projectId}
          fuelRate={fuelRate}
        />
      </div>
    );
  }

  const now = new Date();
  const thisMonth = businessMonth(now);
  const monthFills = fills.filter((f) => businessMonth(f.date) === thisMonth);
  const monthLitres = monthFills.reduce((s, f) => s + f.litres, 0);

  return (
    <Screen>
      <MyHeader href="/my/fuel" />

      {!vehicle && <NoVehicle />}

      {vehicle && shift.hasActiveTrip && (
        <Link
          href="/my/fuel?action=fuel"
          className="flex min-h-[72px] w-full items-center justify-center rounded-2xl bg-brand-600 text-xl font-bold text-white shadow-sm active:scale-[0.99] active:bg-brand-700"
        >
          + Fuel bharein
        </Link>
      )}

      {vehicle && !shift.hasActiveTrip && (
        <Notice
          tone="warn"
          title="Check in before recording fuel"
          lines={["पहले अपनी गाड़ी का QR scan करके duty शुरू करें।", "Fuel is linked to the driver claim, so it cannot be logged before check-in."]}
          href="/my"
          cta="Go to check-in"
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        <Fact label="Fills this month" value={String(monthFills.length)} />
        {/* Preserves translation key: "Diesel this month" */}
        <Fact label={`${normalizeFuelType(vehicle?.fuelType) === "PETROL" ? "Petrol" : normalizeFuelType(vehicle?.fuelType) === "DIESEL" ? "Diesel" : "Fuel"} this month`} value={`${num(monthLitres)} L`} />
      </div>

      {fills.length === 0 ? (
        <Nothing>Abhi tak koi fuel record nahi hai.</Nothing>
      ) : (
        <Group title={TERMS["Refuelling Event"]}>
          {fills.map((f) => (
            <Row
              key={f.id}
              title={`${num(f.litres)} litres`}
              subtitle={`${fmtDate(f.date)}${f.meterValue > 0 ? ` · meter ${num(f.meterValue)}` : ""}`}
              right={f.amount > 0 ? inr(f.amount) : undefined}
              rightSub={f.source === "SITE_TANK" ? "site tank" : "pump"}
            />
          ))}
        </Group>
      )}
    </Screen>
  );
}
