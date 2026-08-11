// Rule-based fraud + risk scoring (no external ML needed — runs on your existing data)

export type FuelEntryLite = {
  id: string;
  assetId: string | null;
  assetCode?: string;
  fuelCapacity?: number;
  quantity: number;
  date: Date;
  anomaly: boolean;
  variancePct: number;
  odometerPhoto: string | null;
  pumpPhoto: string | null;
};

export type RiskFlag = { entryId: string; assetCode: string; date: Date; quantity: number; level: "high" | "medium"; reasons: string[] };

/** Flags suspicious fuel issues using simple, explainable rules. */
export function scoreFuelRisk(entries: FuelEntryLite[]): RiskFlag[] {
  const byAsset: Record<string, FuelEntryLite[]> = {};
  for (const e of entries) {
    if (!e.assetId) continue;
    (byAsset[e.assetId] ||= []).push(e);
  }
  for (const k in byAsset) byAsset[k].sort((a, b) => a.date.getTime() - b.date.getTime());

  const flags: RiskFlag[] = [];
  for (const e of entries) {
    const reasons: string[] = [];
    let high = false;

    if (e.fuelCapacity && e.fuelCapacity > 0 && e.quantity > e.fuelCapacity * 1.05) {
      reasons.push(`Issued ${Math.round(e.quantity)}L > tank capacity ${e.fuelCapacity}L (impossible fill)`);
      high = true;
    }
    if (e.anomaly && e.variancePct > 10) {
      reasons.push(`Telematics mismatch ${e.variancePct.toFixed(0)}% (diesel diverted)`);
      high = true;
    }
    // two fills of same vehicle within 4 hours
    if (e.assetId) {
      const list = byAsset[e.assetId];
      const idx = list.findIndex((x) => x.id === e.id);
      const prev = idx > 0 ? list[idx - 1] : null;
      if (prev) {
        const hrs = (e.date.getTime() - prev.date.getTime()) / 3.6e6;
        if (hrs >= 0 && hrs < 4) reasons.push(`Re-fueled ${hrs.toFixed(1)}h after previous fill`);
      }
    }
    if (!e.odometerPhoto && !e.pumpPhoto) reasons.push("No odometer/pump photo evidence");

    if (reasons.length === 0) continue;
    flags.push({ entryId: e.id, assetCode: e.assetCode ?? "—", date: e.date, quantity: e.quantity, level: high ? "high" : "medium", reasons });
  }
  return flags.sort((a, b) => (a.level === b.level ? b.date.getTime() - a.date.getTime() : a.level === "high" ? -1 : 1));
}

export type AssetForRisk = {
  id: string; code: string; name: string; assetClass: string;
  yearMfg: number; healthScore: number; serviceDueDate: Date | null; lastServiceDate: Date | null;
  breakdownCount: number;
};

export type BreakdownRisk = { id: string; code: string; name: string; assetClass: string; score: number; level: "High" | "Medium" | "Low"; factors: string[] };

/** Predicts breakdown likelihood from age, service overdue, breakdown history & health. */
export function scoreBreakdownRisk(assets: AssetForRisk[]): BreakdownRisk[] {
  const now = Date.now();
  return assets
    .map((a) => {
      let score = 0;
      const factors: string[] = [];

      const age = a.yearMfg ? new Date().getFullYear() - a.yearMfg : 0;
      if (age >= 15) { score += 25; factors.push(`${age} yrs old`); }
      else if (age >= 10) { score += 15; factors.push(`${age} yrs old`); }

      if (a.serviceDueDate) {
        const daysOver = (now - new Date(a.serviceDueDate).getTime()) / 8.64e7;
        if (daysOver > 0) { score += Math.min(30, 10 + daysOver / 3); factors.push(`service ${Math.round(daysOver)}d overdue`); }
      }
      if (a.breakdownCount >= 3) { score += 25; factors.push(`${a.breakdownCount} past breakdowns`); }
      else if (a.breakdownCount >= 1) { score += 12; factors.push(`${a.breakdownCount} past breakdown(s)`); }

      if (a.healthScore < 50) { score += 25; factors.push(`low health ${a.healthScore}`); }
      else if (a.healthScore < 70) { score += 12; factors.push(`health ${a.healthScore}`); }

      if (a.lastServiceDate) {
        const sinceDays = (now - new Date(a.lastServiceDate).getTime()) / 8.64e7;
        if (sinceDays > 150) { score += 10; factors.push(`${Math.round(sinceDays)}d since service`); }
      }

      score = Math.min(100, Math.round(score));
      const level: BreakdownRisk["level"] = score >= 60 ? "High" : score >= 35 ? "Medium" : "Low";
      return { id: a.id, code: a.code, name: a.name, assetClass: a.assetClass, score, level, factors };
    })
    .sort((a, b) => b.score - a.score);
}
