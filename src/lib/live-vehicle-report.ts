import type { LiveVehicle } from "@/lib/fleet-edge-live";

export type LiveVehicleReportRow = {
  Section: string;
  Field: string;
  Value: string | number;
};

const blank = (value: string | number | null | undefined): string | number => value ?? "";

/**
 * The selected-vehicle inspector is a deliberately honest live read model:
 * unavailable telemetry is rendered as an em dash rather than invented as
 * zero. Preserve that distinction in downloads by leaving unknown values
 * empty. A CSV is portable enough for a dispatcher to send or open offline,
 * while the section/field/value shape remains readable instead of producing a
 * single, very wide spreadsheet row.
 */
export function liveVehicleReportRows(vehicle: LiveVehicle, downloadedAt = new Date()): LiveVehicleReportRow[] {
  const row = (Section: string, Field: string, Value: string | number | null | undefined): LiveVehicleReportRow => ({
    Section,
    Field,
    Value: blank(Value),
  });

  return [
    row("Report", "Downloaded at (UTC)", downloadedAt.toISOString()),
    row("Asset", "Asset code", vehicle.code),
    row("Asset", "Registration", vehicle.registrationNo),
    row("Asset", "Chassis number", vehicle.chassisNo),
    row("Asset", "Model", vehicle.modelLabel),
    row("Asset", "Asset class", vehicle.assetClass),
    row("Asset", "Live status", vehicle.status),
    row("Asset", "Register status", vehicle.registerStatus),
    row("Telemetry", "Last update", vehicle.lastUpdate),
    row("Telemetry", "GPS fix on latest sample", vehicle.live.gpsFix ? "Yes" : "No"),
    row("Telemetry", "Latitude", vehicle.lat),
    row("Telemetry", "Longitude", vehicle.lng),
    row("Live readings", "Speed (km/h)", vehicle.live.speedKph),
    row("Live readings", "Odometer (km)", vehicle.live.odometerKm),
    row("Live readings", "Primary fuel (L)", vehicle.live.fuelLitres),
    row("Live readings", "Primary fuel (%)", vehicle.live.fuelPct),
    row("Live readings", "Fuel capacity (L)", vehicle.live.fuelCapacityL),
    row("Live readings", "DEF (%)", vehicle.live.defPct),
    row("Live readings", "Battery voltage (V)", vehicle.live.batteryV),
    row("Live readings", "Engine run hours", vehicle.live.engineRunHours),
    row("Live readings", "Ignition", vehicle.live.ignitionOn == null ? "" : vehicle.live.ignitionOn ? "On" : "Off"),
    row("Today", "Distance travelled (km)", vehicle.today.distanceKm),
    row("Today", "Idling duration (min)", vehicle.today.idlingMinutes),
    row("Today", "Stoppage duration (min)", vehicle.today.stoppageMinutes),
    row("Today", "Not observed (min)", vehicle.today.unobservedMinutes),
    row("Today", "Engine run hours", vehicle.today.engineRunHours),
    row("Today", "Fuel efficiency (km/L)", vehicle.today.kmPerL),
    row("Today", "Fuel-confidence", vehicle.today.confidence),
    row("Today", "Fuel-confidence notes", vehicle.today.confidenceReasons.join(" ")),
    row("Service", "Service task", vehicle.service.taskName),
    row("Service", "Distance to service (km)", vehicle.service.distanceToServiceKm),
    row("Service", "Days to service", vehicle.service.daysToService),
    row("Service", "Service status", vehicle.service.status),
    row("Assignment", "Driver", vehicle.driverName),
    row("Assignment", "Project", vehicle.projectCode),
    row("Assignment", "On trip", vehicle.onTrip ? "Yes" : "No"),
  ];
}
