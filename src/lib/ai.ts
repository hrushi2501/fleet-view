import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Picks the best available vision model:
 *  1. Google Gemini  — free tier, NO credit card needed (set GOOGLE_GENERATIVE_AI_API_KEY)
 *  2. OpenAI direct  — set OPENAI_API_KEY
 *  3. Vercel AI Gateway — requires a card on file
 */
/**
 * Model ids are a moving target and a silent failure.
 *
 * The previous ids — gemini-2.5-flash and -pro — were retired to new keys, and
 * the API rejects them with "no longer available to new users". Nothing in the
 * app noticed: the call threw, the OCR route reported it as an unreadable
 * photograph, and a driver was told to retake a picture that was never at
 * fault. Verified against the live API on 2026-08-13; when a read starts
 * failing on every image, check here first.
 */
export const GEMINI_VISION_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
/** Cheaper, faster; used where a rough read is enough. */
export const GEMINI_VISION_MODEL_LITE = process.env.GEMINI_MODEL_LITE || "gemini-3.1-flash-lite";

export function visionModel(): LanguageModel {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return google(GEMINI_VISION_MODEL);
  if (process.env.OPENAI_API_KEY) return openai("gpt-4o");
  return "openai/gpt-4o"; // gateway fallback
}

/** Higher-accuracy model for tricky reads (fuel pump displays). */
export function visionModelPro(): LanguageModel {
  // Deliberately the same model as the standard read. The Gemini pro tier is
  // not included in the free quota this deployment uses — it answers
  // "exceeded your current quota" — and a gauge read that always fails is
  // worse than a good-enough one that works. Point GEMINI_MODEL at a pro id
  // once the account is on a paid plan.
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return google(GEMINI_VISION_MODEL);
  if (process.env.OPENAI_API_KEY) return openai("gpt-4o");
  return "openai/gpt-4o";
}

/** Task-optimized model for vehicle odometer and hour-meter OCR. */
export function visionModelForOdometer(): LanguageModel {
  return visionModel();
}

/** Task-optimized model for Indian fuel dispenser displays (HPCL/BPCL/IOCL). */
export function visionModelForPump(): LanguageModel {
  return process.env.GEMINI_PRO === "1" ? visionModelPro() : visionModel();
}

/** Task-optimized model for dashboard analog/digital fuel gauge readings. */
export function visionModelForGauge(): LanguageModel {
  return visionModelPro();
}

/**
 * Whether a vision provider is actually configured.
 *
 * Without a key the model functions fall through to the Vercel AI Gateway,
 * which needs a card on file. On a deployment that has neither, every OCR call
 * throws — and the failure surfaced to the driver as "your photo is unclear",
 * so they retook the same photo indefinitely. The camera was never the problem.
 *
 * Callers use this to tell "we cannot read photos right now" apart from "this
 * photo cannot be read", which are different messages and different remedies.
 */
export function ocrAvailable(): boolean {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY);
}

export function aiProvider(): string {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google-gemini (free key)";
  if (process.env.OPENAI_API_KEY) return "openai (direct key)";
  return "vercel-gateway (needs card)";
}

