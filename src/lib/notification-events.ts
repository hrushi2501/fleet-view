/**
 * Data for in-app operational notifications.
 *
 * Alert is the existing notification record, while AuditEvent records that the
 * notification was raised. Keep the wording here so fuel and safety events use
 * the same durable, reportable contract without inventing another table.
 */

type DriverEvent = {
  assetId: string;
  assetCode: string;
  driverId: string;
  driverName: string;
};

export function driverFuelFillNotification(input: DriverEvent & { quantity: number; rate: number }) {
  const amount = Math.round(input.quantity * input.rate);
  return {
    category: "Fuel",
    severity: "Info",
    title: `Fuel fill recorded — ${input.assetCode}`,
    message: `${input.driverName} recorded ${input.quantity.toFixed(1)} L of diesel (₹${amount.toLocaleString("en-IN")}) from the driver app.`,
    assetId: input.assetId,
    driverId: input.driverId,
    actionUrl: "/reports/notifications",
  };
}

export function driverAccidentNotification(input: DriverEvent & { note?: string }) {
  const detail = input.note?.trim() ? ` Driver note: ${input.note.trim()}` : "";
  return {
    category: "Driver",
    severity: "Critical",
    title: `Accident reported — ${input.assetCode}`,
    message: `${input.driverName} reported an accident from the driver app.${detail}`,
    assetId: input.assetId,
    driverId: input.driverId,
    actionUrl: "/maintenance?tab=workorders",
  };
}

/** Every driver-reported problem is recorded in the same durable notification
 * stream. Accidents stay Critical; a blocking breakdown is a Warning; routine
 * repair reports are Info for the assigned contractor and administrators. */
export function driverProblemNotification(input: DriverEvent & {
  kind: string;
  blocking: boolean;
  note?: string;
}) {
  const detail = input.note?.trim() ? ` Driver note: ${input.note.trim()}` : "";
  return {
    category: "Driver",
    severity: input.blocking ? "Warning" : "Info",
    title: `${input.blocking ? "Breakdown" : "Problem"} reported — ${input.assetCode}`,
    message: `${input.driverName} reported ${input.kind.toLowerCase()} from the driver app.${detail}`,
    assetId: input.assetId,
    driverId: input.driverId,
    actionUrl: "/maintenance?tab=workorders",
  };
}
