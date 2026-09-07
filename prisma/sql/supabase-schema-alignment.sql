-- =============================================================================
-- Supabase ⟷ Prisma Schema Alignment & Zero-Exposure Security Hardening
--
-- Instructions:
-- Run this script in the Supabase SQL Editor as 'postgres' (or via psql)
-- whenever new Prisma models are pushed to the database.
-- =============================================================================

-- 1. Enable Row Level Security (RLS) on every table in the public schema
do $$
declare r record;
begin
  for r in
    select t.tablename
    from pg_tables t
    join pg_class c on c.relname = t.tablename
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname
    where t.schemaname = 'public' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
    raise notice 'Enabled RLS on %', r.tablename;
  end loop;
end $$;

-- 2. Revoke all direct permissions from public/PostgREST roles and install the
-- exact restrictive deny-all policy contract verified by verify-rls.sql.
-- Keep these names and clauses in sync with enable-rls.sql: this script is a
-- superset for an operator who also wants its indexes/runtime-role grants.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('revoke all on public.%I from public, anon, authenticated', r.tablename);
    -- Remove legacy names before converging on the canonical contract.
    execute format('drop policy if exists "deny_anon_direct_access" on public.%I', r.tablename);
    execute format('drop policy if exists "deny_authenticated_direct_access" on public.%I', r.tablename);
    execute format('drop policy if exists "deny_anon_access" on public.%I', r.tablename);
    execute format('create policy "deny_anon_access" on public.%I as restrictive for all to anon using (false) with check (false)', r.tablename);
    execute format('drop policy if exists "deny_authenticated_access" on public.%I', r.tablename);
    execute format('create policy "deny_authenticated_access" on public.%I as restrictive for all to authenticated using (false) with check (false)', r.tablename);
  end loop;
end $$;

-- 3. Revoke all default privileges on future objects from public roles
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- 4. Ensure application runtime role (fleetview_app) has full operational privileges
grant usage on schema public to fleetview_app;
grant all privileges on all tables in schema public to fleetview_app;
grant all privileges on all sequences in schema public to fleetview_app;
alter default privileges in schema public grant all privileges on tables to fleetview_app;
alter default privileges in schema public grant all privileges on sequences to fleetview_app;

-- 5. Performance composite indexes for enterprise scalability
CREATE INDEX IF NOT EXISTS "idx_telemetry_reading_asset_recorded"
  ON "TelemetryReading" ("assetId", "recordedAt" DESC);

CREATE INDEX IF NOT EXISTS "idx_trip_session_driver_status"
  ON "TripSession" ("driverId", "status");

CREATE INDEX IF NOT EXISTS "idx_trip_session_asset_status"
  ON "TripSession" ("assetId", "status");

CREATE INDEX IF NOT EXISTS "idx_audit_event_module_at"
  ON "AuditEvent" ("module", "at" DESC);

-- 6. Verification query output
select tablename,
       (select relrowsecurity from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relname = t.tablename and n.nspname = 'public') as rls_enabled
from pg_tables t
where schemaname = 'public'
order by rls_enabled, tablename;
