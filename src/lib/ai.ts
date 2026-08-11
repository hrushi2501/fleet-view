import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Picks the best available vision model:
 *  1. Google Gemini  — free tier, NO credit card needed (set GOOGLE_GENERATIVE_AI_API_KEY)
 *  2. OpenAI direct  — set OPENAI_API_KEY
 *  3. Vercel AI Gateway — requires a card on file
 */
export function visionModel(): LanguageModel {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return google("gemini-2.5-flash");
  if (process.env.OPENAI_API_KEY) return openai("gpt-4o");
  return "openai/gpt-4o"; // gateway fallback
}

/** Higher-accuracy model for tricky reads (fuel pump displays). */
export function visionModelPro(): LanguageModel {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return google("gemini-2.5-pro");
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

export function aiProvider(): string {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google-gemini (free key)";
  if (process.env.OPENAI_API_KEY) return "openai (direct key)";
  return "vercel-gateway (needs card)";
}

