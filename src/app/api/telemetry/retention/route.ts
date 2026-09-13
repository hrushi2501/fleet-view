import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { checkSharedSecret } from "@/lib/auth";
import { recordSystemAudit } from "@/lib/audit-writer";
import {
  slimPayload,
  alreadySlim,
  FULL_PAYLOAD_DAYS,
  RETENTION_BATCH,
} from "@/lib/telemetry-retention";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Reduces old telemetry payloads to the fields worth keeping.
 *
 * Runs nightly and deliberately incremental: one batch per run, so the job is
 * short, holds no long locks, and catches up over a few nights rather than
 * rewriting a large slice of the table in one transaction while vehicles are
 * still reporting into it.
 *
 * A run that finds nothing old enough is the normal case, not an error.
 */
export async function GET(req: Request) {
  const auth = checkSharedSecret(req, "CRON_SECRET");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const cutoff = new Date(Date.now() - FULL_PAYLOAD_DAYS * 86_400_000);

  const candidates = await db.telemetryReading.findMany({
    where: { recordedAt: { lt: cutoff }, raw: { not: Prisma.JsonNull } },
    orderBy: { recordedAt: "asc" },
    take: RETENTION_BATCH,
    select: { id: true, raw: true },
  });

  let slimmed = 0;
  let skipped = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (const row of candidates) {
    if (row.raw === null || alreadySlim(row.raw)) {
      skipped++;
      continue;
    }
    const { slimmed: reduced } = slimPayload(row.raw);
    bytesBefore += JSON.stringify(row.raw).length;
    bytesAfter += JSON.stringify(reduced).length;

    await db.telemetryReading.update({
      where: { id: row.id },
      data: { raw: reduced as Prisma.InputJsonValue },
    });
    slimmed++;
  }

  // Recorded whatever the outcome, for the same reason the theft scan is: a job
  // that has silently stopped looks exactly like a job with nothing to do.
  await recordSystemAudit({
    action: "UPDATE",
    module: "ADMIN",
    summary:
      slimmed > 0
        ? `Telemetry retention: reduced ${slimmed} payloads older than ${FULL_PAYLOAD_DAYS} days ` +
          `(${Math.round(bytesBefore / 1024)} KB to ${Math.round(bytesAfter / 1024)} KB)`
        : `Telemetry retention: nothing older than ${FULL_PAYLOAD_DAYS} days to reduce`,
    changes: JSON.stringify({ slimmed, skipped, examined: candidates.length, cutoff }),
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    cutoff,
    examined: candidates.length,
    slimmed,
    alreadySmall: skipped,
    kbBefore: Math.round(bytesBefore / 1024),
    kbAfter: Math.round(bytesAfter / 1024),
    more: candidates.length === RETENTION_BATCH,
  });
}
