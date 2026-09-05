import { withApiErrors } from "@/lib/api-error";
import { db } from "@/lib/db";
import { requireApi, assetScope, projectIdScope } from "@/lib/access";
import { toCsv } from "@/lib/reporting";
import { NextResponse } from "next/server";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";

/** Ceiling on any single export. The larger reports had none, so one request
 *  could stream an entire table into memory. */
const MAX_ROWS = 5000;

/**
 * CSV export. These files contain the client's commercial data — vendor rates,
 * fuel spend, staff records — so they are gated on the `reports.export`
 * permission, not merely on being signed in. Exports are written to the audit
 * log because "who took a copy of the vendor rates" is a question that gets
 * asked after someone leaves.
 */
async function handleGET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  // Same rule as before — `reports.export`, with the legacy-Admin fallback while
  // roles are being installed — now expressed through the shared gate so every
  // route resolves permissions the same way.
  const auth = await requireApi("reports.export");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const session = auth.access.session;

  const limit = await reserveRateLimit({
    scope: "report-export",
    subject: session.id,
    limit: 15,
    windowMs: 5 * 60_000,
  });
  if (!limit.ok) {
    return rateLimitResponse(limit.retryInSeconds, "Export rate limit reached. Please wait a moment before downloading another report.");
  }


  // An export is the easiest way to walk out with more than you can see on
  // screen, so it is bounded by the same scope as every other read.
  const visibleAssets = assetScope(auth.access);
  const byProject = projectIdScope(auth.access);

  const { key } = await ctx.params;
  let rows: Record<string, unknown>[] = [];

  switch (key) {
    case "fuel_issues": {
      const d = await db.fuelTransaction.findMany({ where: { type: "ISSUE", asset: visibleAssets }, include: { asset: true, project: true }, orderBy: { date: "desc" }, take: MAX_ROWS });
      rows = d.map((x) => ({
        Date: x.date, Asset: x.asset?.code ?? "", Registration: x.asset?.registrationNo ?? "", Project: x.project?.code ?? "",
        Litres: x.quantity, Rate: x.rate, Amount: x.amount, Meter: x.meterValue, Source: x.source,
        Latitude: x.lat ?? "", Longitude: x.lng ?? "", Anomaly: x.anomaly ? "YES" : "",
      }));
      break;
    }
    case "fuel_reconciliation": {
      const d = await db.fuelReconciliation.findMany({ include: { tank: true }, orderBy: { periodEnd: "desc" }, take: MAX_ROWS });
      rows = d.map((x) => ({
        Tank: x.tank.name, PeriodStart: x.periodStart, PeriodEnd: x.periodEnd, OpeningDip: x.openingDip,
        Received: x.receiptsL, Issued: x.issuesL, Expected: x.expectedClosing, Actual: x.actualClosing,
        VarianceLitres: x.varianceL, VariancePct: x.variancePct.toFixed(2), Status: x.status, Notes: x.notes ?? "",
      }));
      break;
    }
    case "production": {
      const d = await db.productionLog.findMany({ where: byProject, include: { asset: true, project: true, driver: true }, orderBy: { date: "desc" }, take: MAX_ROWS });
      rows = d.map((x) => ({
        Date: x.date, Shift: x.shift, Asset: x.asset.code, Project: x.project?.code ?? "", Operator: x.driver?.name ?? "",
        Material: x.material ?? "", Trips: x.trips, Tonnes: x.tonnage, CubicMetres: x.volumeM3, Cycles: x.cycles,
        WorkedHours: x.workedHours, IdleHours: x.idleHours, Km: x.distanceKm, LeadKm: x.leadKm, Source: x.source,
      }));
      break;
    }
    case "compliance": {
      const d = await db.complianceDoc.findMany({ where: { asset: visibleAssets }, include: { asset: true }, orderBy: { expiryDate: "asc" }, take: MAX_ROWS });
      rows = d.map((x) => ({
        Asset: x.asset.code, Registration: x.asset.registrationNo ?? "", Document: x.docType, Number: x.number,
        Issued: x.issueDate, Expires: x.expiryDate, Status: x.status, Cost: x.cost, Vendor: x.vendor ?? "",
        DaysToExpiry: Math.floor((x.expiryDate.getTime() - Date.now()) / 86400000),
      }));
      break;
    }
    case "loss_cases": {
      const d = await db.fraudCase.findMany({ include: { asset: true }, orderBy: { openedAt: "desc" }, take: MAX_ROWS });
      rows = d.map((x) => ({
        CaseNo: x.caseNo, Opened: x.openedAt, Domain: x.domain, Severity: x.severity, Score: x.score, Title: x.title,
        Asset: x.asset?.code ?? "", Vendor: x.vendor ?? "", AtRisk: x.amountAtRisk, Recovered: x.amountRecovered,
        Status: x.status, RootCause: x.rootCause ?? "", Disposition: x.disposition ?? "", Closed: x.closedAt ?? "",
      }));
      break;
    }
    case "maintenance": {
      const d = await db.workOrder.findMany({ where: { asset: visibleAssets }, include: { asset: true }, orderBy: { reportedAt: "desc" }, take: MAX_ROWS });
      rows = d.map((x) => ({
        WorkOrder: x.woNo, Asset: x.asset.code, Type: x.type, Priority: x.priority, Status: x.status,
        Description: x.description, Labour: x.laborCost, Parts: x.partsCost, Total: x.totalCost,
        DowntimeHours: x.downtimeHrs, Technician: x.technician ?? "", Reported: x.reportedAt, Completed: x.completedAt ?? "",
      }));
      break;
    }
    case "notification_log": {
      // Global alerts (for example, a tank without an assigned asset) are an
      // admin-only concern. Scoped report users receive only alerts attached
      // to an asset inside their normal visibility boundary.
      const where = auth.access.group === "ADMIN" ? {} : { asset: visibleAssets };
      const d = await db.alert.findMany({
        where,
        include: { asset: true, driver: true },
        orderBy: { createdAt: "desc" },
        take: MAX_ROWS,
      });
      rows = d.map((x) => ({
        Reported: x.createdAt,
        Category: x.category,
        Severity: x.severity,
        Status: x.status,
        Title: x.title,
        Message: x.message,
        Asset: x.asset?.code ?? "",
        Driver: x.driver?.name ?? "",
        AcknowledgedBy: x.acknowledgedBy ?? "",
        AcknowledgedAt: x.acknowledgedAt ?? "",
        ResolvedAt: x.resolvedAt ?? "",
      }));
      break;
    }
    case "weighbridge": {
      const d = await db.weighbridgeTicket.findMany({ include: { asset: true }, orderBy: { date: "desc" }, take: MAX_ROWS });
      rows = d.map((x) => ({
        Date: x.date, Ticket: x.ticketNo, Kind: x.kind, PairedWith: x.pairedTicketNo ?? "", Material: x.material,
        Asset: x.asset?.code ?? "", GrossKg: x.grossKg, TareKg: x.tareKg, NetKg: x.netKg, BilledKg: x.billedKg,
        From: x.fromLocation ?? "", To: x.toLocation ?? "", Rate: x.rate, Amount: x.amount,
      }));
      break;
    }
    case "attendance": {
      const d = await db.attendance.findMany({ include: { driver: true, project: true }, orderBy: { date: "desc" }, take: MAX_ROWS });
      rows = d.map((x) => ({
        Date: x.date, Person: x.driver.name, EmpCode: x.driver.empCode, Status: x.status, Shift: x.shift,
        Hours: x.hours, Project: x.project?.code ?? "", MarkedBy: x.markedBy ?? "",
      }));
      break;
    }
    case "cost_per_asset": {
      const [assets, fuel, wo] = await Promise.all([
        db.asset.findMany({ where: visibleAssets, orderBy: { code: "asc" }, take: MAX_ROWS }),
        db.fuelTransaction.groupBy({ by: ["assetId"], where: { type: "ISSUE" }, _sum: { amount: true, quantity: true } }),
        db.workOrder.groupBy({ by: ["assetId"], _sum: { totalCost: true, downtimeHrs: true } }),
      ]);
      const f = new Map(fuel.map((x) => [x.assetId ?? "", x._sum]));
      const w = new Map(wo.map((x) => [x.assetId, x._sum]));
      rows = assets.map((a) => ({
        Asset: a.code, Registration: a.registrationNo ?? "", Class: a.assetClass, Ownership: a.ownershipType,
        AcquisitionCost: a.acquisitionCost, BookMethod: a.depMethod, Odometer: a.meterValue, HourMeter: a.hourMeterValue,
        FuelSpend: f.get(a.id)?.amount ?? 0, FuelLitres: f.get(a.id)?.quantity ?? 0,
        MaintenanceCost: w.get(a.id)?.totalCost ?? 0, DowntimeHours: w.get(a.id)?.downtimeHrs ?? 0,
      }));
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  }

  await db.auditEvent.create({
    data: {
      actorId: session.id, actorName: session.name, actorRole: session.role,
      action: "EXPORT", module: "REPORTS", entity: key,
      summary: `Exported ${rows.length} rows of ${key}`,
    },
  });

  const csv = toCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fleetview-${key}-${stamp}.csv"`,
    },
  });
}

export const GET = withApiErrors(handleGET);
