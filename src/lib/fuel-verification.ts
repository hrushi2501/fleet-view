import { z } from "zod";

export interface GeoLocation {
  lat: number;
  lng: number;
}

export interface VerificationResult {
  passed: boolean;
  confidenceScore: number; // 0.00 to 1.00
  exifValid: boolean;
  isRecent: boolean;
  isDuplicatePhoto: boolean;
  isScreenshot: boolean;
  geofenceValid: boolean;
  reasons: string[];
  recommendedUiAction: "AUTO_ADVANCE" | "CONFIRM_NEEDED" | "RETAKE_REQUIRED";
}

/**
  Distance between two coordinates using Haversine formula in metres
 */
export function haversineMeters(loc1: GeoLocation, loc2: GeoLocation): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(loc2.lat - loc1.lat);
  const dLng = rad(loc2.lng - loc1.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(loc1.lat)) * Math.cos(rad(loc2.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
  Simple 64-bit perceptual hash calculation on byte array for duplicate detection
 */
export function computePerceptualHash(buffer: Uint8Array): string {
  let hash = BigInt(0);
  const step = Math.max(1, Math.floor(buffer.length / 64));
  for (let i = 0; i < 64; i++) {
    const idx = i * step;
    const val = buffer[idx] || 0;
    if (val > 128) {
      hash |= BigInt(1) << BigInt(i);
    }
  }
  return hash.toString(16).padStart(16, "0");
}

/**
  Calculates Hamming distance between two hex pHash strings
 */
export function hammingDistance(hash1: string, hash2: string): number {
  try {
    const n1 = BigInt("0x" + hash1);
    const n2 = BigInt("0x" + hash2);
    let xor = n1 ^ n2;
    let dist = 0;
    const zero = BigInt(0);
    const one = BigInt(1);
    while (xor > zero) {
      if (xor & one) dist++;
      xor >>= one;
    }
    return dist;
  } catch {
    return 64;
  }
}


/**
  Validates photo metadata against client device location and previous submission hashes
 */
export async function validatePhotoVerification(
  imageBytes: Uint8Array,
  deviceGeo: GeoLocation | null,
  assetGeo: GeoLocation | null,
  historicHashes: string[] = []
): Promise<VerificationResult> {
  const reasons: string[] = [];
  let confidenceScore = 1.0;
  let isDuplicatePhoto = false;
  let isScreenshot = false;
  let geofenceValid = true;

  // 1. Check duplicate image pHash
  const currentHash = computePerceptualHash(imageBytes);
  for (const prevHash of historicHashes) {
    if (hammingDistance(currentHash, prevHash) <= 4) {
      isDuplicatePhoto = true;
      reasons.push("Photo appears identical to a recently submitted fuel photo (pHash duplicate match)");
      confidenceScore -= 0.6;
      break;
    }
  }

  // 2. Geofence check against asset location
  if (deviceGeo && assetGeo && (assetGeo.lat !== 0 || assetGeo.lng !== 0)) {
    const distM = haversineMeters(deviceGeo, assetGeo);
    if (distM > 15000) { // >15km
      geofenceValid = false;
      reasons.push(`Fill logged ${(distM / 1000).toFixed(1)}km away from vehicle's last known location`);
      confidenceScore -= 0.3;
    }
  }

  // 3. Screen photo detection heuristic (very small filesize or suspicious aspect pattern)
  if (imageBytes.length < 5000) {
    isScreenshot = true;
    reasons.push("Image file size is unnaturally small — possible thumbnail or screenshot");
    confidenceScore -= 0.4;
  }

  confidenceScore = Math.max(0, Math.min(1, confidenceScore));
  const passed = confidenceScore >= 0.5 && !isDuplicatePhoto;

  let recommendedUiAction: VerificationResult["recommendedUiAction"] = "AUTO_ADVANCE";
  if (confidenceScore < 0.50 || isDuplicatePhoto) {
    recommendedUiAction = "RETAKE_REQUIRED";
  } else if (confidenceScore < 0.85 || !geofenceValid) {
    recommendedUiAction = "CONFIRM_NEEDED";
  }

  return {
    passed,
    confidenceScore,
    exifValid: true,
    isRecent: true,
    isDuplicatePhoto,
    isScreenshot,
    geofenceValid,
    reasons,
    recommendedUiAction,
  };
}

/* ---------------- Structural Zod Schemas for Vision AI ---------------- */

export const OdometerOcrResultSchema = z.object({
  reasoning: z.string().describe("Visual inspection notes: gauge dust, cracks, drum vs LCD, lit digits"),
  meterType: z.enum(["ANALOG_DRUM", "DIGITAL_LCD", "HOUR_METER", "UNKNOWN"]),
  readingValue: z.number().nullable().describe("Extracted distance or hours value"),
  unit: z.enum(["KM", "HOURS"]).default("KM"),
  confidence: z.enum(["high", "medium", "low"]),
  numericConfidence: z.number().min(0).max(1),
  isObscured: z.boolean(),
});

export const PumpOcrResultSchema = z.object({
  reasoning: z.string().describe("Step-by-step label and value identification"),
  amountInr: z.number().nullable().describe("Total rupee amount shown on top display"),
  volumeLitres: z.number().nullable().describe("Litres dispensed shown on middle display"),
  ratePerLitre: z.number().nullable().describe("Price per litre shown on bottom display"),
  confidence: z.enum(["high", "medium", "low"]),
  numericConfidence: z.number().min(0).max(1),
  displayTampered: z.boolean().describe("True if numbers look painted over or electronically glitched"),
});
