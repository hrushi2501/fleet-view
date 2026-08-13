import React from "react";
import { VehicleProductionDetails } from "@/components/VehicleProductionDetails";
import { requirePage } from "@/lib/access";

export const metadata = {
  title: "Machine Output Details | FleetView ERP",
  description: "Output, cycle times, mileage and trends for one machine.",
};

export default async function VehicleProductionDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("production.view");
  const { id } = await params;

  return <VehicleProductionDetails vehicleId={id} />;
}
