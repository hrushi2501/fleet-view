import { PolicyCentre } from "@/components/PolicyCentre";
import { requirePage } from "@/lib/access";
import { MyHeader, Screen } from "../_ui";

export const dynamic = "force-dynamic";

export default async function DriverPoliciesPage() {
  await requirePage("my.policies");
  return (
    <Screen>
      <MyHeader href="/my/policies" note="नियम और प्राइवेसी / Rules & privacy" />
      <PolicyCentre audience="driver" />
    </Screen>
  );
}
