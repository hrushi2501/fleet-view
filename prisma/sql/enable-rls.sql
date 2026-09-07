-- Row Level Security — deny-all posture for Supabase.
--
-- Run this after any `prisma db push` that creates new tables, because Prisma
-- creates them with RLS off and this schema is exposed through Supabase's
-- auto-generated PostgREST API.
--
-- Why deny-all rather than real policies:
--
-- This application does not use Supabase Auth. It connects to Postgres directly
-- through Prisma as the table owner and does its own authorization in the app
-- layer — roles, permissions and rupee approval limits (module M0). Postgres
-- owners bypass RLS, so the app is unaffected by anything here.
--
-- RLS therefore has exactly one job: guarantee that Supabase's REST API can
-- never serve this client's commercial data to whoever holds the anon key. That
-- key is published to browsers by design, and an older repository already
-- contains it. Enabling RLS with NO policies means anon and authenticated get
-- nothing, permanently.
--
-- Grants are revoked too, so two independent mechanisms have to fail before data
-- leaks, rather than relying on either one alone.
--
--   psql "$DATABASE_URL_UNPOOLED" -f prisma/sql/enable-rls.sql

do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('revoke all on public.%I from public, anon, authenticated', r.tablename);
    execute format('drop policy if exists "deny_anon_access" on public.%I', r.tablename);
    execute format('create policy "deny_anon_access" on public.%I as restrictive for all to anon using (false) with check (false)', r.tablename);
    execute format('drop policy if exists "deny_authenticated_access" on public.%I', r.tablename);
    execute format('create policy "deny_authenticated_access" on public.%I as restrictive for all to authenticated using (false) with check (false)', r.tablename);
  end loop;
end $$;

-- Future tables must not inherit access automatically.
revoke all on all sequences in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;

-- Verification: every row should read rls = true.
select tablename,
       (select relrowsecurity from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relname = t.tablename and n.nspname = 'public') as rls
from pg_tables t
where schemaname = 'public'
order by rls, tablename;
