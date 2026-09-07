import { DriverReportForm } from "@/components/DriverReportForm";
import { DriverQrScanner } from "@/components/DriverQrScanner";
import { requirePage } from "@/lib/access";
import { MyHeader, NoVehicle, Notice, NotLinked, Screen } from "../_ui";
import { myBasics, myEmergencyContacts } from "../_data";

export const dynamic = "force-dynamic";

export default async function DriverReportPage({
  searchParams,
}: {
  searchParams: Promise<{ reported?: string; error?: string }>;
}) {
  const access = await requirePage("my.report");
  const [{ driver, vehicle }, params] = await Promise.all([myBasics(access), searchParams]);
  const emergency = await myEmergencyContacts(vehicle?.projectId ?? null);

  if (!driver) {
    return <Screen><MyHeader href="/my/report" /><NotLinked loginName={access.session.email} /></Screen>;
  }

  return (
    <Screen>
      <MyHeader href="/my/report" note="Problem, accident ya rukawat" />
      {params.reported && <Notice tone="ok" title="Report bhej diya. Team ko turant dikh raha hai." />}
      {params.error && <Notice tone="bad" title="Report send nahi hua. Signal check karke dobara try karein." />}

      {vehicle ? (
        <DriverReportForm
          assetId={vehicle.id}
          vehicleCode={vehicle.registrationNo ?? vehicle.code}
          contacts={emergency.contacts}
          missingCompanyContacts={emergency.missingCompanyContacts}
        />
      ) : (
        <>
          <NoVehicle />
          <DriverQrScanner triggerVariant="card" />
        </>
      )}
    </Screen>
  );
}
