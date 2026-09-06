import { PolicyCentre } from "@/components/PolicyCentre";
import { requirePage } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  await requirePage(null);
  return <PolicyCentre audience="office" />;
}
