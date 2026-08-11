import { db } from "@/lib/db";

export interface FeatureVector {
  entityType: "ASSET" | "DRIVER" | "TANK" | "SUPPLIER";
  entityId: string;
  features: Record<string, number>;
}

/**
 * Updates feature store record for real-time risk scoring and future ML training
 */
export async function updateFeatureRecord(
  entityType: FeatureVector["entityType"],
  entityId: string,
  featureKey: string,
  value: number
) {
  await db.featureStoreRecord.upsert({
    where: {
      entityType_entityId_featureKey: {
        entityType,
        entityId,
        featureKey,
      },
    },
    create: {
      entityType,
      entityId,
      featureKey,
      value,
    },
    update: {
      value,
    },
  });
}

/**
 * Hook 1: Machine Learning Fraud Classification Hook
 */
export async function Hook_AnomalyClassifier(featureVector: FeatureVector): Promise<{ fraudProbability: number; anomalyClass: string }> {
  // Plug point for external Python/Triton ML model endpoint
  const fillFrequency = featureVector.features["fill_frequency_24h"] || 0;
  const variancePct = featureVector.features["variance_pct"] || 0;

  const score = Math.min(1.0, (fillFrequency * 0.2) + (variancePct / 100));
  return {
    fraudProbability: Math.round(score * 100) / 100,
    anomalyClass: score > 0.7 ? "HIGH_PROBABILITY_THEFT" : "NORMAL",
  };
}

/**
 * Hook 2: Analog Fuel Gauge Vision Model Hook
 */
export async function Hook_FuelLevelVisionModel(_imageBytes: Uint8Array): Promise<{ levelPct: number; confidence: number }> {
  // Future Hook for customized edge vision models
  return { levelPct: 75.0, confidence: 0.95 };
}

/**
 * Hook 3: Expected Fuel Consumption Predictor Hook
 */
export async function Hook_ConsumptionPredictor(_assetId: string, deltaWork: number): Promise<{ expectedLitres: number }> {
  // Future Hook for gradient boosted consumption regression models
  return { expectedLitres: deltaWork * 0.35 };
}

/**
 * Hook 4: Supplier Risk Scorer Hook
 */
export async function Hook_SupplierRiskScorer(_supplierName: string): Promise<{ trustScore: number; riskRating: string }> {
  return { trustScore: 88.5, riskRating: "LOW_RISK" };
}

