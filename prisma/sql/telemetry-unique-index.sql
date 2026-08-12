-- One telemetry observation per vehicle, per instant, per source.
--
-- WHY
--
-- All three ingestion paths (the Fleet Edge cron pull, the device push at
-- /api/telematics, and the provider webhook at /api/fuel/telemetry) check for an
-- existing row before inserting. That check and the insert are two statements,
-- so two deliveries racing — a provider retry arriving while the first call is
-- still in flight, or a slow sync still running when the next cron fires — both
-- pass the check and both write.
--
-- A duplicate is not cosmetic here. Every reading is a point in a series that
-- distance and fuel consumption are measured across, so a doubled row doubles
-- the journey it belongs to and inflates the fuel attributed to it.
--
-- `source` is part of the key deliberately: the same instant reported by the OEM
-- pull and by a tracker push are two independent observations, and collapsing
-- them would silently discard one provider's data.
--
-- WHY THIS FILE EXISTS RATHER THAN JUST `prisma db push`
--
-- The constraint is declared in schema.prisma, but the application role
-- (`fleetview_app`) does not own the table — `postgres` does — so neither the
-- app nor `prisma db push` run as that role can create it:
--
--     ERROR: must be owner of table TelemetryReading
--
-- Run this as the table owner. Verified safe at the time of writing: production
-- held zero duplicate (assetId, recordedAt, source) groups.
--
--   psql "$DATABASE_URL_UNPOOLED" -f prisma/sql/telemetry-unique-index.sql
--
-- The index name matches Prisma's own convention, so a later `prisma db push`
-- recognises it as already applied rather than trying to recreate it.
--
-- Safe to run while the sync is live: syncTataFleetEdge catches Prisma's P2002
-- unique violation and counts it as a duplicate rather than failing the run.

-- Surface any pre-existing violations before attempting the index, so a failure
-- explains itself instead of just reporting a duplicate key.
DO $$
DECLARE
  offending integer;
BEGIN
  SELECT COUNT(*) INTO offending FROM (
    SELECT 1
    FROM "TelemetryReading"
    GROUP BY "assetId", "recordedAt", "source"
    HAVING COUNT(*) > 1
  ) dupes;

  IF offending > 0 THEN
    RAISE EXCEPTION
      'Cannot add the unique index: % duplicate (assetId, recordedAt, source) group(s) already exist. '
      'Resolve them first — keep the earliest row in each group and delete the rest.', offending;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TelemetryReading_assetId_recordedAt_source_key"
  ON "TelemetryReading" ("assetId", "recordedAt", "source");
