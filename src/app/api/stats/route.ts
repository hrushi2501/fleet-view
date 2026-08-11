import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [assets, statusGroups, fuelIssues, openAlerts, expiring, costs] = await Promise.all([
    db.asset.count(),
    db.asset.groupBy({ by: ["status"], _count: true }),
    db.fuelTransaction.findMany({ where: { type: "ISSUE" } }),
    db.alert.count({ where: { status: "Open" } }),
    db.complianceDoc.count({ where: { status: { in: ["Expiring", "Expired"] } } }),
    db.costTransaction.aggregate({ _sum: { amount: true } }),
  ]);

  const lossL = fuelIssues.reduce((s, f) => s + Math.max(0, f.quantity - f.sensorRise), 0);
  const issuedL = fuelIssues.reduce((s, f) => s + f.quantity, 0);

  return NextResponse.json({
    assets,
    byStatus: Object.fromEntries(statusGroups.map((g) => [g.status, g._count])),
    fuel: { issuedLitres: Math.round(issuedL), estimatedLossLitres: Math.round(lossL), lossPct: +((lossL / issuedL) * 100).toFixed(1), estimatedLossValue: Math.round(lossL * 92.5) },
    openAlerts,
    docsExpiring: expiring,
    operatingCost6mo: costs._sum.amount ?? 0,
    generatedAt: new Date().toISOString(),
  });
}
