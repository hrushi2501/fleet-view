import { NextResponse } from "next/server";
import { createTelemetryAdapter } from "@/lib/telemetry-ingestion";
import { AiFraudDetectionService } from "@/lib/ai-fraud";

export async function POST() {
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
