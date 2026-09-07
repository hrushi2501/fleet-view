import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { requireApi } from "@/lib/access";
import { canPersistTelemetryFindings, createTelemetryAdapter } from "@/lib/telemetry-ingestion";
import { AiFraudDetectionService } from "@/lib/ai-fraud";
import { reserveRateLimit } from "@/lib/request-rate-limit";
import { requireSameOrigin } from "@/lib/request-security";

/**
 * Runs the fraud scan and writes cases. Was callable anonymously, so anyone
 * could both drive the AI spend on this account and cause cases to be raised
 * against real drivers. Creating fraud cases is investigation work, not a
 * fleet read; it is intentionally limited to loss investigators.
 */
async function handlePOST(req: Request) {
  const auth = await requireApi("loss.investigate");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  requireSameOrigin(req);

  // Fraud scans can fetch telemetry and write cases, so make the cooldown
  // explicit per operator instead of letting a repeated UI click exhaust AI
  // provider quota or create duplicate investigations.
  const limit = await reserveRateLimit({
    scope: "ai-fraud-scan",
    subject: auth.access.session.id,
    limit: 1,
    windowMs: 5 * 60_000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "A fraud scan was run recently. Please wait before running another.", retryInSeconds: limit.retryInSeconds },
      { status: 429, headers: { "Retry-After": String(limit.retryInSeconds) } },
    );
  }

  try {
    // AUTO uses generated readings until Fleet Edge is configured. Generated
    // readings may be shown as a clearly-labelled preview, but must never
    // create FraudCase or Alert rows against an actual person or vehicle.
    const adapter = createTelemetryAdapter('AUTO');
    const stream = await adapter.fetchStream();

    if (!canPersistTelemetryFindings(adapter)) {
      return NextResponse.json({
        ok: true,
        processed: stream.length,
        simulated: true,
        persisted: 0,
        message: "Demo telemetry was analysed as a preview only. No fraud cases or alerts were created.",
      });
    }

    const aiService = new AiFraudDetectionService();
    await aiService.processTelemetry(stream);

    return NextResponse.json({ ok: true, processed: stream.length, simulated: false, persisted: true });
  } catch (error) {
    console.error("[API] /insight/ai-scan error:", error);
    throw error;
  }
}

export const POST = withApiErrors(handlePOST);
