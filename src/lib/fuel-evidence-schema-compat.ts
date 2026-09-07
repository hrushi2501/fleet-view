import { Prisma } from "@prisma/client";

/**
 * `afterOdometerPhoto` was deliberately introduced as optional evidence: a
 * driver must still be able to log a fill when a camera is unavailable. Some
 * existing Supabase deployments can receive application code before an owner
 * has applied the additive column. Keep that rollout order from crashing the
 * fuel module, but only after PostgreSQL has explicitly identified this exact
 * missing column. Once the migration is applied, this path is never used.
 */
const MISSING_COLUMN = "afterOdometerPhoto";

const LEGACY_FUEL_SELECT = {
  id: true, type: true, assetId: true, projectId: true, quantity: true,
  rate: true, amount: true, meterValue: true, sensorRise: true, variancePct: true,
  anomaly: true, geofenceOk: true, odometerPhoto: true, pumpPhoto: true,
  lat: true, lng: true, date: true, tankId: true, source: true, issuedBy: true,
  approvedBy: true, shift: true, expectedL: true, expectedVarPct: true,
  sessionId: true, captureMethod: true, captureConfidence: true,
} as const;

const RETURNING_RECORD_OPERATIONS = new Set([
  "findFirst", "findFirstOrThrow", "findMany", "findUnique", "findUniqueOrThrow",
  "create", "update", "upsert", "delete",
]);

type Args = Record<string, unknown>;

function isRecord(value: unknown): value is Args {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Remove the absent field from data, filters and explicit selections. */
function withoutMissingColumn(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutMissingColumn);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== MISSING_COLUMN)
      .map(([key, nested]) => [key, withoutMissingColumn(nested)]),
  );
}

/**
 * A FuelTransaction can also be loaded below Asset, Project or FuelTank as
 * `fuelTxns`. Prisma selects every scalar field for that relation by default,
 * so removing the top-level field is not enough for `asset.findUnique({
 * include: { fuelTxns: … } })`. Replace only that nested relation's default
 * scalar selection, while preserving all of its filters, ordering and nested
 * relation requests.
 */
function legacyFuelRelationArgs(value: unknown): unknown {
  if (value === true) return { select: LEGACY_FUEL_SELECT };
  if (!isRecord(value)) return value;

  const cleaned = legacyNestedFuelEvidenceArgs(withoutMissingColumn(value));
  if (!isRecord(cleaned)) return cleaned;
  const select = isRecord(cleaned.select) ? cleaned.select : null;
  if (select) return { ...cleaned, select };

  const include = isRecord(cleaned.include) ? cleaned.include : null;
  const { include: _include, ...rest } = cleaned;
  return { ...rest, select: { ...LEGACY_FUEL_SELECT, ...(include ?? {}) } };
}

/** Applies the legacy scalar selection to FuelTransaction relations at any depth. */
export function legacyNestedFuelEvidenceArgs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(legacyNestedFuelEvidenceArgs);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      key === "fuelTxns" ? legacyFuelRelationArgs(nested) : legacyNestedFuelEvidenceArgs(nested),
    ]),
  );
}

/** True only for the specific additive-column rollout error we can recover. */
export function isMissingAfterOdometerPhotoColumn(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2022" && error.message.includes(MISSING_COLUMN);
}

/**
 * Produces a query suitable for the database schema before the optional column
 * exists. Relation `include`s are converted into `select`s because Prisma does
 * not permit both at once.
 */
export function legacyFuelEvidenceArgs(operation: string, args: unknown): unknown {
  const cleaned = legacyNestedFuelEvidenceArgs(withoutMissingColumn(args));
  if (!isRecord(cleaned) || !RETURNING_RECORD_OPERATIONS.has(operation)) return cleaned;

  const include = isRecord(cleaned.include) ? cleaned.include : null;
  const select = isRecord(cleaned.select) ? cleaned.select : null;
  if (select) return { ...cleaned, select };

  const { include: _include, ...rest } = cleaned;
  return {
    ...rest,
    select: { ...LEGACY_FUEL_SELECT, ...(include ?? {}) },
  };
}

let warned = false;

/** Query extension applied outside audit logging so it can retry one failed ORM call. */
export const fuelEvidenceSchemaCompatExtension = Prisma.defineExtension({
  name: "fuel-evidence-schema-compat",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        try {
          return await query(args);
        } catch (error) {
          if (!isMissingAfterOdometerPhotoColumn(error)) throw error;

          if (!warned) {
            warned = true;
            // This is an expected compatibility path, not an application
            // failure. Keep it visible in server logs without emitting a
            // browser console error or triggering the development error overlay.
            console.info(
              "[fuel-evidence-schema-compat] Database migration is pending: optional afterOdometerPhoto evidence is temporarily unavailable. Apply prisma/sql/add-fuel-refuelling-evidence.sql with the table-owner connection.",
            );
          }
          // Prisma's `$allOperations` callback exposes a union of every model
          // argument type. The column may be selected directly on
          // FuelTransaction or under an Asset/Project/Tank `fuelTxns` relation,
          // so retry the smallest matching shape without the pending field.
          const legacyArgs = model === "FuelTransaction"
            ? legacyFuelEvidenceArgs(operation, args)
            : legacyNestedFuelEvidenceArgs(withoutMissingColumn(args));
          return query(legacyArgs as never);
        }
      },
    },
  },
});
