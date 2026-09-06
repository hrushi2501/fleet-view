import { DriverHelp } from "@/components/DriverHelp";
import { requirePage } from "@/lib/access";
import { MyHeader, Screen } from "../_ui";

export const dynamic = "force-dynamic";

export default async function DriverHelpPage() {
  await requirePage("my.help");

  return (
    <Screen>
      <MyHeader href="/my/help" />
      <DriverHelp />
    </Screen>
  );
}
