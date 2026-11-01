/**
 * Real Postgres for migration tests: PGlite (Postgres compiled to WASM, in
 * process, no server). Prod's database is the self-hosted Supabase stack, so
 * the helper recreates what matters for SQL functions there: the anon /
 * authenticated / service_role roles, the default privileges that grant every
 * new public function to all three (the reason a SECURITY DEFINER must revoke
 * from anon and authenticated explicitly), the `extensions` schema, and
 * uuid_generate_v4. Tables are created by each test, as narrow as it needs.
 *
 * PGlite's Emscripten loader uses dynamic import(), which jest's VM allows
 * only under --experimental-vm-modules, so these specs have their own config
 * and run with `pnpm --filter api test:sql` (also part of `pnpm test:all`).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');

/** A migration's SQL by file name; `rollback/<name>` for a rollback. */
export const migration = (name: string) =>
  readFileSync(join(MIGRATIONS, name), 'utf8');

export async function supabaseLikeDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists extensions;
    create or replace function uuid_generate_v4() returns uuid
      language sql as 'select gen_random_uuid()';
    create role anon;
    create role authenticated;
    create role service_role;
    alter default privileges in schema public
      grant execute on functions to anon, authenticated, service_role;
  `);
  return db;
}

/** Whether `role` may execute `signature` (e.g. 'public.f(uuid, text)'). */
export async function canExecute(
  db: PGlite,
  role: string,
  signature: string,
): Promise<boolean> {
  const r = await db.query<{ p: boolean }>(
    `select has_function_privilege($1, $2, 'execute') as p`,
    [role, signature],
  );
  return r.rows[0].p;
}
