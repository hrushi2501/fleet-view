import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scorecard, offenderProfiles, type CaseLite } from "@/lib/loss-prevention";
import { getFraudIntelligence } from "@/app/(app)/loss-prevention/actions";

export async function GET() {
  try {
    const [cases, assets, drivers, fraudIntel] = await Promise.all([
      db.fraudCase.findMany({
        include: { asset: { select: { code: true } }, driver: { select: { name: true } }, _count: { select: { evidence: true, recoveries: true } } },
        orderBy: [{ status: "asc" }, { score: "desc" }, { openedAt: "desc" }],
      }),
      db.asset.findMany({ select: { id: true, code: true, registrationNo: true, name: true } }),
      db.driver.findMany({ select: { id: true, name: true, empCode: true } }),
      getFraudIntelligence(),
    ]);

    const assetLabel = new Map(assets.map((a) => [a.id, a.code]));
    const driverLabel = new Map(drivers.map((d) => [d.id, d.name]));

    const sc = scorecard(cases.map((c) => ({ domain: c.domain, status: c.status, amountAtRisk: c.amountAtRisk, amountRecovered: c.amountRecovered, openedAt: c.openedAt, closedAt: c.closedAt })));
    const offenders = offenderProfiles(
      cases.map((c): CaseLite => ({ domain: c.domain, status: c.status, amountAtRisk: c.amountAtRisk, amountRecovered: c.amountRecovered, vendor: c.vendor ?? null, assetId: c.assetId ?? null, driverId: c.driverId ?? null })),
      (id: string) => assetLabel.get(id) ?? "Unknown asset",
      (id: string) => driverLabel.get(id) ?? "Unknown driver"
    );

    return NextResponse.json({ scorecard: sc, offenders, fraudIntel, cases });
  } catch (error) {
    console.error("[API] /insight/loss-prevention error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
