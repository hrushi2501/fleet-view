// Advanced fuel analytics — mileage, cost/km, efficiency vs benchmark, theft detection.

export type FuelTxn = {
  id: string; assetId: string | null; quantity: number; meterValue: number;
  rate: number; amount: number; date: Date; odometerPhoto: string | null;
  pumpPhoto: string | null; sensorRise: number; anomaly: boolean; variancePct: number;
  geofenceOk?: boolean; lat?: number | null; lng?: number | null;
};
export type AssetLite = {
  id: string; code: string; name: string; assetClass: string; category: string;
  primaryMeter: string; fuelCapacity: number;
};
export type ConsumptionNormLite = {
  assetId: string | null;
  assetClass: string | null;
  unit: string;
  normLow: number;
  normHigh: number;
};
/**
 * Largest meter movement between two fills that is still credible — 700 km for
 * a road vehicle, 24 engine-hours for plant. Beyond this the pair is almost
 * always a missed fill or a mistyped meter rather than a real run, and averaging
 * it in would silently flatter the mileage of whichever asset has the worst
 * paperwork. Segments above it are excluded from efficiency *and* from the
 * spend that efficiency is measured against.
 */
const MAX_SEG = (isEquipment: boolean) => (isEquipment ? 24 : 700);

export type AssetFuel = {
  asset: AssetLite;
  unit: "km/L" | "L/hr";
  fills: number;
  litres: number;
  spend: number;
  travel: number;          // total km (vehicles) or engine-hours (equipment)
  efficiency: number | null; // km/L or L/hr
  costPerUnit: number | null; // ₹/km or ₹/hr
  benchLow: number; benchHigh: number;
  status: "good" | "low" | "high" | "na";
  lastFill: Date | null;
  lastMeter: number;
  flags: FuelFlag[];
};
export type FuelFlag = { entryId: string; date: Date; quantity: number; level: "high" | "medium"; reasons: string[] };

export function analyzeAsset(asset: AssetLite, txnsAll: FuelTxn[], norms: ConsumptionNormLite[] = []): AssetFuel {
  const isEquip = asset.category === "EQUIPMENT";
  const expectedUnit = isEquip ? "LPH" : "KMPL";
  const configuredNorm =
    norms.find((norm) => norm.assetId === asset.id && norm.unit === expectedUnit) ??
    norms.find((norm) => !norm.assetId && norm.assetClass === asset.assetClass && norm.unit === expectedUnit) ??
    null;
  const unit: "km/L" | "L/hr" = isEquip ? "L/hr" : "km/L";
  const txns = [...txnsAll].sort((a, b) => a.date.getTime() - b.date.getTime());
  const litres = txns.reduce((s, t) => s + t.quantity, 0);
  const spend = txns.reduce((s, t) => s + t.amount, 0);

  let segTravel = 0, segLitres = 0;
  // Spend belonging to the same fills that back segTravel. Cost per km divided
  // total spend by *measured* distance, so every fill whose segment was
  // rejected (no meter reading, a rollback, a 900 km gap) inflated the rate for
  // the ones that remained — and that number is quoted per vehicle as a cost.
  let segSpend = 0;
  const flags: FuelFlag[] = [];
  const segMileages: number[] = [];

  for (let i = 0; i < txns.length; i++) {
    const t = txns[i];
    const reasons: string[] = []; let high = false;
    if (asset.fuelCapacity > 0 && t.quantity > asset.fuelCapacity * 1.05) { reasons.push(`Filled ${Math.round(t.quantity)}L > tank ${asset.fuelCapacity}L`); high = true; }
    if (t.anomaly && t.variancePct > 10) { reasons.push(`Sensor mismatch ${t.variancePct.toFixed(0)}%`); high = true; }
    if (t.geofenceOk === false) { reasons.push("Filled away from vehicle's GPS location"); high = true; }
    if (!t.odometerPhoto && !t.pumpPhoto) reasons.push("No photo evidence");

    if (i > 0) {
      const p = txns[i - 1];
      const hrsGap = (t.date.getTime() - p.date.getTime()) / 3.6e6;
      if (hrsGap >= 0 && hrsGap < 4) reasons.push(`Refuelled ${hrsGap.toFixed(1)}h after last fill`);
      const delta = t.meterValue - p.meterValue;
      if (t.meterValue > 0 && p.meterValue > 0) {
        if (delta < 0) { reasons.push(isEquip ? "Hour-meter went backwards" : "Odometer rollback"); high = true; }
        else if (delta > MAX_SEG(isEquip)) reasons.push(`Meter jump ${Math.round(delta)} (check reading)`);
        else if (delta > 0 && p.quantity > 0) {
          const eff = isEquip ? p.quantity / delta : delta / p.quantity; // L/hr or km/L
          if (eff > 0 && isFinite(eff)) {
            segMileages.push(eff);
            segTravel += delta;
            segLitres += p.quantity;
            // The fill that powered this segment, so numerator and denominator
            // describe the same journeys.
            segSpend += p.amount;
          }
        }
      }
    }
    if (reasons.length) flags.push({ entryId: t.id, date: t.date, quantity: t.quantity, level: high ? "high" : "medium", reasons });
  }

  let efficiency: number | null = null;
  if (segLitres > 0 && segTravel > 0) efficiency = isEquip ? segLitres / segTravel : segTravel / segLitres;

  // mileage-drop detection: any segment far worse than the asset's own average
  if (efficiency && segMileages.length >= 3) {
    const avg = efficiency;
    txns.forEach((t, i) => {
      if (i === 0) return;
      const p = txns[i - 1]; const delta = t.meterValue - p.meterValue;
      if (delta > 0 && p.quantity > 0 && delta <= MAX_SEG(isEquip)) {
        const eff = isEquip ? p.quantity / delta : delta / p.quantity;
        const bad = isEquip ? eff > avg * 1.5 : eff < avg * 0.6; // burns much more than usual
        if (bad) {
          const f = flags.find((x) => x.entryId === t.id);
          const reason = isEquip ? `Burn ${eff.toFixed(1)} L/hr vs avg ${avg.toFixed(1)} (possible theft)` : `Mileage ${eff.toFixed(1)} km/L vs avg ${avg.toFixed(1)} (possible siphoning)`;
          if (f) { f.reasons.push(reason); f.level = "high"; }
          else flags.push({ entryId: t.id, date: t.date, quantity: t.quantity, level: "high", reasons: [reason] });
        }
      }
    });
  }

  const bench: [number, number] = configuredNorm ? [configuredNorm.normLow, configuredNorm.normHigh] : [0, 0];
  let status: AssetFuel["status"] = "na";
  if (efficiency && bench[1] > 0) {
    // Equipment is measured in L/hr, where lower is better, so only burning
    // *above* the benchmark is a problem. (The previous form had both branches
    // of its inner ternary returning "good", which read as a bug even though
    // the outcome was right.)
    if (isEquip) status = efficiency > bench[1] ? "high" : "good";
    else status = efficiency < bench[0] ? "low" : efficiency > bench[1] ? "high" : "good";
  }

  return {
    asset, unit, fills: txns.length, litres, spend,
    travel: segTravel, efficiency,
    costPerUnit: segTravel > 0 && segSpend > 0 ? segSpend / segTravel : null,
    benchLow: bench[0], benchHigh: bench[1], status,
    lastFill: txns.length ? txns[txns.length - 1].date : null,
    lastMeter: txns.length ? txns[txns.length - 1].meterValue : 0,
    flags,
  };
}

export function analyzeFleet(assets: AssetLite[], txns: FuelTxn[], norms: ConsumptionNormLite[] = []) {
  const byAsset: Record<string, FuelTxn[]> = {};
  for (const t of txns) if (t.assetId) (byAsset[t.assetId] ||= []).push(t);
  const rows = assets.map((a) => analyzeAsset(a, byAsset[a.id] || [], norms)).filter((r) => r.fills > 0);

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalLitres = rows.reduce((s, r) => s + r.litres, 0);
  const totalKm = rows.filter((r) => r.unit === "km/L").reduce((s, r) => s + r.travel, 0);
  const kmLitres = rows.filter((r) => r.unit === "km/L").reduce((s, r) => s + (r.efficiency ? r.travel / r.efficiency : 0), 0);
  // Null, not zero. A fleet with no measurable segments has *unknown* mileage;
  // 0 km/L reads as a fleet burning fuel and going nowhere, and it is the kind
  // of number that gets screenshotted into a meeting.
  const avgFleetKmpl = kmLitres > 0 && totalKm > 0 ? totalKm / kmLitres : null;
  const allFlags = rows.flatMap((r) => r.flags.map((f) => ({ ...f, code: r.asset.code })));
  const highFlags = allFlags.filter((f) => f.level === "high");

  const vehicles = rows.filter((r) => r.unit === "km/L" && r.efficiency);
  const best = [...vehicles].sort((a, b) => (b.efficiency! - a.efficiency!)).slice(0, 5);
  const worst = [...vehicles].sort((a, b) => (a.efficiency! - b.efficiency!)).slice(0, 5);

  return { rows, totalSpend, totalLitres, totalKm, avgFleetKmpl, allFlags, highFlags, best, worst };
}
