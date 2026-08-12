// M23 — Production & productivity.
//
// Fuel efficiency alone is a half-truth on a construction fleet. 3 km/L means
// nothing for an excavator, and a tipper doing 4 km/L while hauling half loads
// is worse than one doing 3 km/L hauling full ones. What matters is output per
// unit of input:
//
//   litres per tonne, litres per m3, cost per trip
//
// This module measures the output side so M5's litres and M7's rupees have a
// denominator worth dividing by.

import { businessDay } from "./business-time";

export type ProdUnit = "TONNES_PER_DAY" | "M3_PER_HOUR" | "TRIPS_PER_DAY" | "CYCLES_PER_HOUR";

export type LogLite = {
  assetId: string;
  date: Date;
  shift: string;
  trips: number;
  tonnage: number;
  volumeM3: number;
  cycles: number;
  workedHours: number;
  idleHours: number;
  distanceKm: number;
  leadKm: number;
  material: string | null;
  projectId: string | null;
  driverId: string | null;
  source: string;
};

export type AssetLite = { id: string; code: string; name: string; assetClass: string; category: string };

/** Which output unit an asset class is naturally judged on. */
export const CLASS_UNIT: Record<string, ProdUnit> = {
  DUMPER: "TRIPS_PER_DAY", TIPPER: "TRIPS_PER_DAY", TRUCK: "TRIPS_PER_DAY", TRANSIT_MIXER: "TRIPS_PER_DAY",
  EXCAVATOR: "M3_PER_HOUR", BACKHOE: "M3_PER_HOUR", GRADER: "M3_PER_HOUR",
  CRUSHER: "TONNES_PER_DAY", PLANT: "TONNES_PER_DAY",
  ROLLER: "CYCLES_PER_HOUR", CRANE: "CYCLES_PER_HOUR",
};

export const UNIT_LABEL: Record<ProdUnit, string> = {
  TONNES_PER_DAY: "t / day",
  M3_PER_HOUR: "m³ / hr",
  TRIPS_PER_DAY: "trips / day",
  CYCLES_PER_HOUR: "cycles / hr",
};

export function unitFor(assetClass: string): ProdUnit {
  return CLASS_UNIT[assetClass] ?? "TRIPS_PER_DAY";
}

export type Norm = { unit: ProdUnit; targetLow: number; targetHigh: number };

export type Productivity = {
  asset: AssetLite;
  unit: ProdUnit;
  days: number;
  workedHours: number;
  idleHours: number;
  trips: number;
  tonnage: number;
  volumeM3: number;
  cycles: number;
  distanceKm: number;
  /**
   * Output expressed in the asset class's natural unit, or null when there is
   * no denominator to divide by (no shift days logged, or no worked hours).
   * Null means "not measured"; 0 means "measured, and it produced nothing".
   */
  output: number | null;
  target: Norm | null;
  status: "above" | "on" | "below" | "na";
  /** Null when no hours were logged at all — 0% would read as a machine that never worked. */
  utilPct: number | null;
  idlePct: number | null;
  /** Litres burnt per tonne / per m3 / per trip — the number that actually matters. */
  litresPerTonne: number | null;
  litresPerM3: number | null;
  litresPerTrip: number | null;
  litres: number;
  fuelSpend: number;
  costPerTonne: number | null;
  costPerM3: number | null;
  costPerTrip: number | null;
  flags: string[];
};

/**
 * Roll a machine's production logs into productivity, then divide fuel by output.
 * `litres` and `fuelSpend` come from M5 for the same window.
 */
export function assetProductivity(
  asset: AssetLite,
  logs: LogLite[],
  litres: number,
  fuelSpend: number,
  norm: Norm | null
): Productivity {
  const unit = norm?.unit ?? unitFor(asset.assetClass);
  // Shifts are counted in IST days. Grouping by the UTC date splits the night
  // shift in two — the hours before 05:30 IST land on the previous day — which
  // inflates the day count and deflates every "per day" output figure below it.
  const days = new Set(logs.map((l) => businessDay(l.date))).size;
  const workedHours = logs.reduce((s, l) => s + l.workedHours, 0);
  const idleHours = logs.reduce((s, l) => s + l.idleHours, 0);
  const trips = logs.reduce((s, l) => s + l.trips, 0);
  const tonnage = logs.reduce((s, l) => s + l.tonnage, 0);
  const volumeM3 = logs.reduce((s, l) => s + l.volumeM3, 0);
  const cycles = logs.reduce((s, l) => s + l.cycles, 0);
  const distanceKm = logs.reduce((s, l) => s + l.distanceKm, 0);

  // A rate with no denominator is not zero output, it is an unknown one. A
  // dumper with no shift days logged has not "done 0 trips/day"; nobody has
  // told us what it did. Reporting 0 puts it at the bottom of the productivity
  // league table and triggers a below-target flag against a machine that may
  // have been working perfectly well.
  let output: number | null = null;
  switch (unit) {
    case "TONNES_PER_DAY": output = days > 0 ? tonnage / days : null; break;
    case "M3_PER_HOUR": output = workedHours > 0 ? volumeM3 / workedHours : null; break;
    case "TRIPS_PER_DAY": output = days > 0 ? trips / days : null; break;
    case "CYCLES_PER_HOUR": output = workedHours > 0 ? cycles / workedHours : null; break;
  }

  // A measured zero *is* judged against the target — a machine that logged
  // shifts and hauled nothing is genuinely below band, not unrated.
  let status: Productivity["status"] = "na";
  if (norm && norm.targetHigh > 0 && output != null) {
    status = output < norm.targetLow ? "below" : output > norm.targetHigh ? "above" : "on";
  }

  const totalHours = workedHours + idleHours;
  const flags: string[] = [];

  if (status === "below") {
    flags.push(`Output ${output!.toFixed(1)} ${UNIT_LABEL[unit]} is below the ${norm!.targetLow}–${norm!.targetHigh} target band.`);
  }
  // Idle burns diesel and hire charges while producing nothing.
  const idlePct = totalHours > 0 ? (idleHours / totalHours) * 100 : null;
  if (idlePct != null && idlePct > 30) flags.push(`${idlePct.toFixed(0)}% of logged time was idle — diesel and hire charges accrue with no output.`);
  if (litres > 0 && tonnage === 0 && volumeM3 === 0 && trips === 0) {
    flags.push(`${litres.toFixed(0)} L consumed with no production recorded at all.`);
  }
  const manual = logs.filter((l) => l.source === "MANUAL").length;
  if (logs.length > 0 && manual === logs.length) {
    flags.push("All production logs were entered manually — no weighbridge or GPS corroboration.");
  }

  return {
    asset, unit, days, workedHours, idleHours, trips, tonnage, volumeM3, cycles, distanceKm,
    output,
    target: norm,
    status,
    utilPct: totalHours > 0 ? (workedHours / totalHours) * 100 : null,
    idlePct,
    litres,
    fuelSpend,
    litresPerTonne: tonnage > 0 && litres > 0 ? litres / tonnage : null,
    litresPerM3: volumeM3 > 0 && litres > 0 ? litres / volumeM3 : null,
    litresPerTrip: trips > 0 && litres > 0 ? litres / trips : null,
    costPerTonne: tonnage > 0 && fuelSpend > 0 ? fuelSpend / tonnage : null,
    costPerM3: volumeM3 > 0 && fuelSpend > 0 ? fuelSpend / volumeM3 : null,
    costPerTrip: trips > 0 && fuelSpend > 0 ? fuelSpend / trips : null,
    flags,
  };
}

export type ProjectProduction = {
  projectId: string;
  tonnage: number;
  volumeM3: number;
  trips: number;
  workedHours: number;
  machines: number;
  byMaterial: { material: string; tonnage: number; volumeM3: number; trips: number }[];
};

export function projectProduction(projectId: string, logs: LogLite[]): ProjectProduction {
  const mine = logs.filter((l) => l.projectId === projectId);
  const mat = new Map<string, { material: string; tonnage: number; volumeM3: number; trips: number }>();
  for (const l of mine) {
    const key = l.material || "Unspecified";
    const cur = mat.get(key) ?? { material: key, tonnage: 0, volumeM3: 0, trips: 0 };
    cur.tonnage += l.tonnage; cur.volumeM3 += l.volumeM3; cur.trips += l.trips;
    mat.set(key, cur);
  }
  return {
    projectId,
    tonnage: mine.reduce((s, l) => s + l.tonnage, 0),
    volumeM3: mine.reduce((s, l) => s + l.volumeM3, 0),
    trips: mine.reduce((s, l) => s + l.trips, 0),
    workedHours: mine.reduce((s, l) => s + l.workedHours, 0),
    machines: new Set(mine.map((l) => l.assetId)).size,
    byMaterial: [...mat.values()].sort((a, b) => b.tonnage - a.tonnage || b.volumeM3 - a.volumeM3),
  };
}

/** Default production targets, seeded so the module ships configured. */
export const DEFAULT_PROD_NORMS: { assetClass: string; unit: ProdUnit; targetLow: number; targetHigh: number }[] = [
  { assetClass: "DUMPER", unit: "TRIPS_PER_DAY", targetLow: 6, targetHigh: 12 },
  { assetClass: "TIPPER", unit: "TRIPS_PER_DAY", targetLow: 6, targetHigh: 14 },
  { assetClass: "TRUCK", unit: "TRIPS_PER_DAY", targetLow: 4, targetHigh: 10 },
  { assetClass: "TRANSIT_MIXER", unit: "TRIPS_PER_DAY", targetLow: 5, targetHigh: 12 },
  { assetClass: "EXCAVATOR", unit: "M3_PER_HOUR", targetLow: 40, targetHigh: 90 },
  { assetClass: "BACKHOE", unit: "M3_PER_HOUR", targetLow: 15, targetHigh: 40 },
  { assetClass: "GRADER", unit: "M3_PER_HOUR", targetLow: 30, targetHigh: 70 },
  { assetClass: "CRUSHER", unit: "TONNES_PER_DAY", targetLow: 150, targetHigh: 400 },
  { assetClass: "PLANT", unit: "TONNES_PER_DAY", targetLow: 100, targetHigh: 350 },
  { assetClass: "ROLLER", unit: "CYCLES_PER_HOUR", targetLow: 4, targetHigh: 12 },
  { assetClass: "CRANE", unit: "CYCLES_PER_HOUR", targetLow: 2, targetHigh: 8 },
];
