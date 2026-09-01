import { redirect } from "next/navigation";

export default function WeighbridgePage() {
  // Weighbridge module deprecated/replaced by Production & Output module.
  redirect("/sites/materials");
}
