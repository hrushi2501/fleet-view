import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApi } from "@/lib/access";
import { audit } from "@/lib/audit";
import { isValidPeriod } from "@/lib/payroll";
import { payrollWorkbook, payrollPdf, periodLabel } from "@/lib/payroll-export";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";

/** PDFKit and ExcelJS are Node libraries; neither runs on the edge runtime. */
export const runtime = "nodejs";

const COMPANY = "Mahadev Constructions";

/**
 * Downloads a month's payroll as Excel or PDF.
 *
 * Gated on `payroll.view` rather than `reports.export`, because this file lists
 * what every named person earns — a stricter thing to hand out than a fuel
 * report, and not something the general export permission should unlock. Every
 * download is written to the audit log for the same reason: a copy of the wage
 * sheet leaving the building is worth being able to trace.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ period: string }> },
) {
  const auth = await requireApi("payroll.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limit = await reserveRateLimit({
    scope: "payroll-export",
    subject: auth.access.session.id,
    limit: 10,
    windowMs: 300_000,
  });
  if (!limit.ok) {
    return rateLimitResponse(limit.retryInSeconds, "Too many payroll export requests. Please try again later.");
  }

  const { period } = await ctx.params;
  if (!isValidPeriod(period)) {
    return NextResponse.json({ error: "Choose a month in the form 2026-08." }, { status: 400 });
  }

  const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "xlsx";

  const run = await db.payrollRun.findUnique({
    where: { period },
    include: {
      lines: { orderBy: { empCode: "asc" } },
    },
  });

  if (!run) {
    return NextResponse.json(
      { error: `Payroll for ${period} has not been prepared yet.` },
      { status: 404 },
    );
  }

  const data = {
    period: run.period,
    status: run.status,
    standardDays: run.standardDays,
    standardHours: run.standardHours,
    finalisedAt: run.finalisedAt,
    finalisedBy: run.finalisedBy,
    lines: run.lines,
  };

  const body =
    format === "pdf" ? await payrollPdf(data, COMPANY) : await payrollWorkbook(data, COMPANY);

  await audit({
    action: "EXPORT",
    module: "PAYROLL",
    entity: "PayrollRun",
    entityId: run.id,
    summary: `Downloaded payroll for ${periodLabel(period)} as ${format.toUpperCase()} (${run.lines.length} people)`,
  });

  const stamp = run.status === "FINALISED" ? "" : "-DRAFT";
  const filename = `payroll-${period}${stamp}.${format}`;

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type":
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
    },
  });
}
