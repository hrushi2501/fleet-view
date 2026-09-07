-- Verifies the deny-all Supabase/PostgREST boundary after `enable-rls.sql`.
--
-- This intentionally checks both RLS and direct table privileges. RLS alone is
-- not a guarantee when a role still has a permissive policy or table grant.
-- The Prisma database owner is out of scope: it connects directly and bypasses
-- RLS by design; anon/authenticated must have no access at all.

do $$
declare
  r record;
  problems text[] := array[]::text[];
  privilege text;
begin
  if exists (select 1 from pg_roles where rolname in ('anon', 'authenticated') and (rolsuper or rolbypassrls)) then
    raise exception 'PostgREST roles must not be superusers or bypass RLS';
  end if;
  for r in
    select c.oid, t.tablename, c.relrowsecurity
    from pg_tables t
    join pg_namespace n on n.nspname = t.schemaname
    join pg_class c on c.relnamespace = n.oid and c.relname = t.tablename
    where t.schemaname = 'public'
    order by t.tablename
  loop
    if not r.relrowsecurity then
      problems := array_append(problems, format('%I has RLS disabled', r.tablename));
    end if;

    if (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = r.tablename
        and p.policyname in ('deny_anon_access', 'deny_authenticated_access')
        and p.permissive = 'RESTRICTIVE' and p.qual = 'false' and p.with_check = 'false') <> 2 then
      problems := array_append(problems, format('%I is missing restrictive deny policies', r.tablename));
    end if;

    foreach privilege in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
    loop
      if has_any_column_privilege('anon', r.oid, privilege) or has_any_column_privilege('authenticated', r.oid, privilege) then
        problems := array_append(problems, format('PostgREST role retains column %s access on %I', privilege, r.tablename));
      end if;
    end loop;

    foreach privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    loop
      if has_table_privilege('anon', r.oid, privilege) then
        problems := array_append(problems, format('anon retains %s on %I', privilege, r.tablename));
      end if;
      if has_table_privilege('authenticated', r.oid, privilege) then
        problems := array_append(problems, format('authenticated retains %s on %I', privilege, r.tablename));
      end if;
    end loop;
  end loop;

  if cardinality(problems) > 0 then
    raise exception 'RLS verification failed: %', array_to_string(problems, '; ');
  end if;
end $$;

select 'RLS verification passed: public PostgREST roles have no table access.' as result;
