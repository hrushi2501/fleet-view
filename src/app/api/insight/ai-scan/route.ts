import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { createTelemetryAdapter } from "@/lib/telemetry-ingestion";
import { AiFraudDetectionService } from "@/lib/ai-fraud";

/**
 * Runs the fraud scan and writes cases. Was callable anonymously, so anyone
 * could both drive the AI spend on this account and cause cases to be raised
 * against real drivers. Gated on `fleet.view`, the permission every non-driver
 * role holds — the UI poller that calls this sits on pages those roles use.
 */
export async function POST() {
  const auth = await requirePermission("fleet.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    // AUTO: the live Fleet Edge feed once it is configured, the generator until
    // then. `simulated` is returned so the UI can label fabricated results —
    // this scan writes fraud cases, and an invented case costs a real driver.
    const adapter = createTelemetryAdapter('AUTO');
    const stream = await adapter.fetchStream();

    const aiService = new AiFraudDetectionService();
    await aiService.processTelemetry(stream);

    return NextResponse.json({ ok: true, processed: stream.length, simulated: adapter.simulated });
  } catch (error) {
    console.error("[API] /insight/ai-scan error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
