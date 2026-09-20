import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApi, assetScope, projectIdScope } from "@/lib/access";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";

async function handleGET() {
  const auth = await requireApi("fleet.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limit = await reserveRateLimit({
    scope: "stats-query",
    subject: auth.access.session.id,
    limit: 30,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return rateLimitResponse(limit.retryInSeconds, "Too many statistics requests. Please slow down.");
  }

  // Every figure below is a company-wide total unless it is bounded by what the
  // caller may see. A headline count is still data: "your fleet is 4 vehicles"
  // and "the company runs 60" are different disclosures.
  const visibleAssets = assetScope(auth.access);
  const byProject = projectIdScope(auth.access);
  const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000);

  const [assets, statusGroups, fuelIssues, openAlerts, expiring, costs] = await Promise.all([
    db.asset.count({ where: visibleAssets }),
    db.asset.groupBy({ by: ["status"], where: visibleAssets, _count: true }),
    // Scoped to the 6-month reporting window to bound payload and runtime
    db.fuelTransaction.findMany({
      where: { type: "ISSUE", asset: visibleAssets, date: { gte: sixMonthsAgo } },
      select: { quantity: true, sensorRise: true, rate: true },
    }),
    db.alert.count({ where: { status: "Open", ...(Object.keys(visibleAssets).length ? { asset: visibleAssets } : {}) } }),
    db.complianceDoc.count({ where: { status: { in: ["Expiring", "Expired"] }, ...(Object.keys(visibleAssets).length ? { asset: visibleAssets } : {}) } }),
    db.costTransaction.aggregate({ where: { ...byProject, date: { gte: sixMonthsAgo } }, _sum: { amount: true } }),
  ]);

  const lossL = fuelIssues.reduce((s, f) => s + Math.max(0, f.quantity - f.sensorRise), 0);
  const lossValue = fuelIssues.reduce((s, f) => s + Math.max(0, f.quantity - f.sensorRise) * f.rate, 0);
  const issuedL = fuelIssues.reduce((s, f) => s + f.quantity, 0);

  return NextResponse.json({
    assets,
    byStatus: Object.fromEntries(statusGroups.map((g) => [g.status, g._count])),
    fuel: { issuedLitres: Math.round(issuedL), estimatedLossLitres: Math.round(lossL), lossPct: issuedL > 0 ? +((lossL / issuedL) * 100).toFixed(1) : 0, estimatedLossValue: Math.round(lossValue) },
    openAlerts,
    docsExpiring: expiring,
    operatingCost6mo: costs._sum.amount ?? 0,
    generatedAt: new Date().toISOString(),
  });
}

export const GET = withApiErrors(handleGET);
