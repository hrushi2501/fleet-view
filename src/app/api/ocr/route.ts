import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { generateObject } from "ai";
import { z } from "zod";
import { visionModelForOdometer, visionModelForPump, visionModelForGauge, ocrAvailable } from "@/lib/ai";
import { validatePhotoVerification } from "@/lib/fuel-verification";
import { reserveRateLimit } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ODO_PROMPT =
  "You are an expert AI reading an Indian construction vehicle's ODOMETER or HOUR-METER (digital LCD or analog rolling drum digits).\n" +
  "STEP 1 — In 'reasoning', note what you see (dust/cracks, meter type, lit digits).\n" +
  "STEP 2 — Read the MAIN distance/hours number only. Ignore the trip meter, fuel gauge, RPM, and warning lights.\n" +
  "For hour-meters (excavators/graders), include tenths decimal if present. For odometers, read whole integer KM.\n" +
  "If unreadable due to glare, dust or blur, value = null and set confidence = low.";

const PUMP_PROMPT =
  "You are reading an Indian fuel dispenser display (HPCL / BPCL / IOCL / Reliance / Shell).\n" +
  "Indian pumps display THREE stacked lines:\n" +
  "• AMOUNT (₹) — total cost (top / largest font, ₹500 to ₹50,000).\n" +
  "• VOLUME (L) — litres dispensed (middle, 5.0 to 500.0 L).\n" +
  "• RATE (₹/L) — unit price (bottom / smallest, in India typically ₹80 to ₹115/L).\n" +
  "STEP 1 — In 'reasoning', list every visible number and its printed label.\n" +
  "STEP 2 — Extract exact values including decimals. Validate that AMOUNT ≈ VOLUME × RATE (within rounding).\n" +
  "If values are obscured or unreadable, set them to null and lower confidence.";

const GAUGE_PROMPT =
  "This is a photo of a vehicle's FUEL GAUGE on the dashboard. Read how full the tank is.\n" +
  "It will be ANALOG_NEEDLE (sweeping E to F), DIGITAL_BAR (lit segments), or DIGITAL_NUMERIC (percentage).\n" +
  "STEP 1 — In 'reasoning', note gauge type and exact needle/segment position.\n" +
  "STEP 2 — Convert to 0–100 percentage full (E=0, 1/4=25, 1/2=50, 3/4=75, F=100).\n" +
  "Be genuine about precision: an analog needle between marks is approximate, so lower confidence if blurry.";

const pumpSchema = z.object({
  reasoning: z.string(),
  amount: z.number().nullable(),
  volume: z.number().nullable(),
  rate: z.number().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  numericConfidence: z.number().min(0).max(1).default(0.8),
});

const gaugeSchema = z.object({
  reasoning: z.string(),
  gaugeType: z.enum(["ANALOG_NEEDLE", "DIGITAL_BAR", "DIGITAL_NUMERIC", "UNREADABLE"]),
  levelPct: z.number().nullable(),
  odometerKm: z.number().nullable(),
  confidence: z.number().min(0).max(1),
});

function reconcile(o: { amount: number | null; volume: number | null; rate: number | null }) {
  const amount = o.amount;
  let { volume, rate } = o;
  if (rate != null && (rate < 60 || rate > 140)) rate = null; // implausible Indian diesel rate
  if (amount != null && rate && rate > 0) {
    const calc = amount / rate;
    if (volume == null || Math.abs(volume - calc) / calc > 0.05) volume = Math.round(calc * 100) / 100;
  } else if (amount != null && volume && volume > 0 && rate == null) {
    const r = Math.round((amount / volume) * 100) / 100;
    if (r >= 60 && r <= 140) rate = r;
  }
  return { amount, volume, rate };
}

const consistent = (o: { amount: number | null; volume: number | null; rate: number | null }) =>
  o.amount != null && o.volume != null && o.rate != null && Math.abs(o.amount - o.volume * o.rate) / o.amount <= 0.08;

async function handlePOST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Each attempt can make one or two paid vision requests. Reserve before
  // reading the multipart body so a caller cannot use large uploads to bypass
  // the spend guard when the account is already over its allowance.
  const limit = await reserveRateLimit({
    scope: "ocr",
    subject: session.id,
    limit: 10,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many photo-reading requests. Please wait before trying again.", retryInSeconds: limit.retryInSeconds },
      { status: 429, headers: { "Retry-After": String(limit.retryInSeconds) } },
    );
  }

  // Answered before touching the image: with no provider configured, every read
  // below would throw and the driver would be told to retake a photo that was
  // never at fault. Reading a meter is a convenience; recording the fuel is the
  // job, so this reports the feature as unavailable and lets them type it.
  if (!ocrAvailable()) {
    return NextResponse.json({
      value: null, litres: null, rate: null, amount: null,
      confidence: "low",
      numericConfidence: 0,
      recommendedUiAction: "MANUAL_ENTRY",
      unavailable: true,
      error: "Photo reading is switched off on this system. Please type the number in.",
    });
  }

  try {
    const form = await req.formData();
    const file = form.get("image");
    const kind = String(form.get("kind") || "odometer");
    const lat = form.get("lat") ? Number(form.get("lat")) : null;
    const lng = form.get("lng") ? Number(form.get("lng")) : null;

    if (!file || typeof file === "string") return NextResponse.json({ error: "no image" });
    const bytes = new Uint8Array(await (file as File).arrayBuffer());

    // Perform photo validation (pHash, geofence, screenshot check)
    const deviceGeo = lat != null && lng != null ? { lat, lng } : null;
    const verification = await validatePhotoVerification(bytes, deviceGeo, null);

    if (kind === "pump") {
      const run = () =>
        generateObject({
          model: visionModelForPump(),
          temperature: 0,
          schema: pumpSchema,
          messages: [{ role: "user", content: [{ type: "text", text: PUMP_PROMPT }, { type: "image", image: bytes }] }],
        });

      const raw = (await run()).object;
      let best = reconcile(raw);
      if (!consistent(best) || best.volume == null) {
        try {
          const secondRaw = (await run()).object;
          const second = reconcile(secondRaw);
          if (consistent(second) && !consistent(best)) best = second;
          else if (best.volume == null && second.volume != null) best = second;
        } catch { /* keep first */ }
      }

      const isConsistent = consistent(best);
      let numericConfidence = raw.confidence === "high" ? 0.90 : raw.confidence === "medium" ? 0.70 : 0.40;
      if (!isConsistent) numericConfidence -= 0.25;

      let recommendedUiAction: "AUTO_ADVANCE" | "CONFIRM_NEEDED" | "RETAKE_REQUIRED" = "AUTO_ADVANCE";
      if (numericConfidence < 0.50 || best.volume == null || !verification.passed) {
        recommendedUiAction = "RETAKE_REQUIRED";
      } else if (numericConfidence < 0.85 || !isConsistent) {
        recommendedUiAction = "CONFIRM_NEEDED";
      }

      return NextResponse.json({
        litres: best.volume,
        rate: best.rate,
        amount: best.amount,
        confidence: raw.confidence,
        numericConfidence: Math.max(0, Math.min(1, numericConfidence)),
        verification,
        recommendedUiAction,
      });
    }

    if (kind === "gauge") {
      const run = () =>
        generateObject({
          model: visionModelForGauge(),
          temperature: 0,
          schema: gaugeSchema,
          messages: [{ role: "user", content: [{ type: "text", text: GAUGE_PROMPT }, { type: "image", image: bytes }] }],
        });

      let g = (await run()).object;
      if (g.levelPct == null || g.confidence < 0.6) {
        try {
          const second = (await run()).object;
          if (g.levelPct == null && second.levelPct != null) g = second;
        } catch { /* keep */ }
      }

      return NextResponse.json({
        levelPct: g.gaugeType === "UNREADABLE" ? null : g.levelPct,
        odometerKm: g.odometerKm,
        gaugeType: g.gaugeType,
        confidence: g.confidence,
        numericConfidence: g.confidence,
        reasoning: g.reasoning,
        verification,
        recommendedUiAction: g.confidence >= 0.85 ? "AUTO_ADVANCE" : g.confidence >= 0.5 ? "CONFIRM_NEEDED" : "RETAKE_REQUIRED",
      });
    }

    // Odometer / Hour-Meter
    const odoSchema = z.object({
      reasoning: z.string(),
      value: z.number().nullable(),
      confidence: z.enum(["high", "medium", "low"]),
      numericConfidence: z.number().min(0).max(1).default(0.8),
    });

    const runOdo = () =>
      generateObject({
        model: visionModelForOdometer(),
        temperature: 0,
        schema: odoSchema,
        messages: [{ role: "user", content: [{ type: "text", text: ODO_PROMPT }, { type: "image", image: bytes }] }],
      });

    let res = (await runOdo()).object;
    if (res.value == null || res.confidence === "low") {
      try {
        const r2 = (await runOdo()).object;
        if (r2.value != null) res = r2;
      } catch { /* keep */ }
    }

    let numConf = res.confidence === "high" ? 0.92 : res.confidence === "medium" ? 0.72 : 0.40;
    if (res.value == null) numConf = 0.0;

    let recommendedUiAction: "AUTO_ADVANCE" | "CONFIRM_NEEDED" | "RETAKE_REQUIRED" = "AUTO_ADVANCE";
    if (numConf < 0.50 || res.value == null || !verification.passed) {
      recommendedUiAction = "RETAKE_REQUIRED";
    } else if (numConf < 0.85) {
      recommendedUiAction = "CONFIRM_NEEDED";
    }

    return NextResponse.json({
      value: res.value,
      confidence: res.confidence,
      numericConfidence: numConf,
      verification,
      recommendedUiAction,
    });
  } catch (e) {
    // Provider SDK errors quote the failing request — endpoint, headers and at
    // times the key — so the detail stays server-side.
    console.error("[API] /ocr POST error:", e);

    // A provider outage, a timeout or a bad key is not a bad photograph, and
    // telling the driver to retake one sends them round a loop that cannot
    // end. Anything that is not the model genuinely reading the image and
    // failing is reported as the service being unavailable, which lets them
    // enter the number by hand and get on with the fill.
    return NextResponse.json({
      value: null,
      litres: null,
      rate: null,
      amount: null,
      confidence: "low",
      numericConfidence: 0,
      recommendedUiAction: "MANUAL_ENTRY",
      unavailable: true,
      error: "Photo reading is not working right now. Please type the number in.",
    });
  }
}

export const POST = withApiErrors(handlePOST);
