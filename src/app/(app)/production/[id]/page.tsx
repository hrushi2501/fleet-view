import React from "react";
import { VehicleProductionDetails } from "@/components/VehicleProductionDetails";

export const metadata = {
  title: "Vehicle Production Details | FleetView ERP",
  description: "Detailed vehicle production analytics, machine type KPIs, cycle time, fuel efficiency and output trends.",
};

export default async function VehicleProductionDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <VehicleProductionDetails vehicleId={id} />;
}
