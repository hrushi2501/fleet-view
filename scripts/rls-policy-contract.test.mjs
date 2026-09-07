import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const files = [
  "prisma/sql/enable-rls.sql",
  "prisma/sql/supabase-schema-alignment.sql",
];

for (const file of files) {
  test(`${file} uses the canonical restrictive PostgREST deny policy contract`, async () => {
    const sql = await readFile(new URL(`../${file}`, import.meta.url), "utf8");

    assert.match(
      sql,
      /create policy "deny_anon_access" on public\.%I as restrictive for all to anon using \(false\) with check \(false\)/,
    );
    assert.match(
      sql,
      /create policy "deny_authenticated_access" on public\.%I as restrictive for all to authenticated using \(false\) with check \(false\)/,
    );
    assert.match(sql, /revoke all on public\.%I from public, anon, authenticated/);
    assert.doesNotMatch(sql, /create policy "deny_anon_direct_access"/);
    assert.doesNotMatch(sql, /create policy "deny_authenticated_direct_access"/);
  });
}
