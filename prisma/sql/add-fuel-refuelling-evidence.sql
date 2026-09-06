-- Additive, owner-run migration for the third mandatory driver fuel photo.
--
-- Run once against production with DATABASE_URL_UNPOOLED, before deploying the
-- application that writes this field:
--   psql "$DATABASE_URL_UNPOOLED" -f prisma/sql/add-fuel-refuelling-evidence.sql
--
-- It changes an existing table only; no new public table or RLS policy is
-- introduced. Follow with `npm run db:check` and `npm run db:rls:verify`.
ALTER TABLE "FuelTransaction"
  ADD COLUMN IF NOT EXISTS "afterOdometerPhoto" TEXT;
