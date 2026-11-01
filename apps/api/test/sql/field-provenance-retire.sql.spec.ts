/**
 * field_provenance_retire (#248) against real Postgres: the splice, the
 * one-current index, the approval skip, the document cascade and the relink
 * trigger, the grants under Supabase-style default privileges, and the
 * rollback. The review of #248 caught a SECURITY DEFINER left executable by
 * anon — a check only a real database with real roles can make.
 */
import { spawnSync } from 'child_process';
import { join } from 'path';
import type { PGlite } from '@electric-sql/pglite';
import { canExecute, migration, supabaseLikeDb } from './pglite-db';

const APP = '00000000-0000-0000-0000-000000000001';
const CARD = '00000000-0000-0000-0000-0000000000c1';
const LEASE = '00000000-0000-0000-0000-0000000000e1';
const RETIRE = 'public.field_provenance_retire(uuid, uuid, text[])';
const LOCK = 'public.field_provenance_lock(uuid, text)';

/**
 * field_provenance as prod has it where the functions touch it:
 * 20260606000002 (origin and OCR-run checks), 20261014232000 (document and
 * OCR-run cascades), and the deferred NO ACTION lineage FK that
 * 20261015043000 sets; consultant_approvals as 20260606000005.
 */
const FIXTURE = `
  create table documents (id uuid primary key);
  create table ocr_runs (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references documents on delete cascade);
  create table field_provenance (
    id uuid primary key default uuid_generate_v4(),
    application_id uuid not null, field_key text not null,
    origin text not null
      check (origin in ('ocr', 'intake', 'inferred', 'user_entered')),
    value_snapshot text, value_hash text,
    source_document_id uuid references documents on delete cascade,
    source_page int, source_bbox jsonb,
    ocr_run_id uuid references ocr_runs on delete cascade,
    extraction_timestamp timestamptz not null default now(),
    confidence numeric(4,3), confidence_band text,
    superseded_by uuid references field_provenance,
    created_at timestamptz not null default now(),
    constraint field_provenance_ocr_requires_run
      check (origin <> 'ocr' or ocr_run_id is not null));
  create unique index field_provenance_current_uidx
    on field_provenance (application_id, field_key)
    where superseded_by is null;
  create type consultant_decision as enum ('reviewed', 'approved', 'rejected');
  create table consultant_approvals (
    id uuid primary key default gen_random_uuid(),
    application_id uuid not null, consultant_id uuid not null,
    scope text not null, field_key text, section text,
    decision consultant_decision not null, value_hash text, reason text,
    decided_at timestamptz not null default now());
`;

async function schema(): Promise<PGlite> {
  const db = await supabaseLikeDb();
  await db.exec(FIXTURE);
  await db.exec(migration('20261015043000_field_provenance_relink_chain.sql'));
  await db.exec(migration('20261020120000_field_provenance_retire.sql'));
  await db.query(`insert into documents values ($1), ($2)`, [CARD, LEASE]);
  return db;
}

describe('field_provenance_retire (real Postgres)', () => {
  let db: PGlite;

  /** One OCR read of `doc` giving national_id_number = `v`. */
  const version = async (doc: string, v: string) => {
    const run = await db.query<{ id: string }>(
      `insert into ocr_runs (document_id) values ($1) returning id`,
      [doc],
    );
    const r = await db.query<{ id: string }>(
      `select id from field_provenance_create_version(
         $1, 'national_id_number', 'ocr', $2, $2, $3, null, null, $4, null, null)`,
      [APP, v, doc, run.rows[0].id],
    );
    return r.rows[0].id;
  };
  const current = async () =>
    (
      await db.query<{ value_snapshot: string }>(
        `select value_snapshot from field_provenance
          where application_id = $1 and field_key = 'national_id_number'
            and superseded_by is null`,
        [APP],
      )
    ).rows.map((r) => r.value_snapshot);
  const retire = async (keep: string[]) =>
    (
      await db.query<{
        field_key: string;
        retired: number;
        skipped_approved: boolean;
      }>(`select * from field_provenance_retire($1, $2, $3::text[])`, [
        APP,
        LEASE,
        keep,
      ])
    ).rows;
  const next = async (v: string) =>
    (
      await db.query<{ nxt: string | null }>(
        `select (select n.value_snapshot from field_provenance n
                  where n.id = f.superseded_by) as nxt
           from field_provenance f where f.value_snapshot = $1`,
        [v],
      )
    ).rows[0].nxt;

  beforeEach(async () => {
    db = await schema();
    // card-1 → lease-1 → card-2 → lease-2 (current)
    await version(CARD, 'card-1');
    await version(LEASE, 'lease-1');
    await version(CARD, 'card-2');
    await version(LEASE, 'lease-2');
  });
  afterEach(async () => {
    await db.close();
  });

  it("retires the document's versions and falls back to the latest other evidence", async () => {
    expect(await current()).toEqual(['lease-2']);
    expect(await retire(['tenant'])).toEqual([
      { field_key: 'national_id_number', retired: 2, skipped_approved: false },
    ]);
    expect(await current()).toEqual(['card-2']);
    // Spliced by pointers: card-1 now leads straight to card-2.
    expect(await next('card-1')).toBe('card-2');
    // Retired rows point at themselves; the history keeps them.
    expect(await next('lease-1')).toBe('lease-1');
    expect(await next('lease-2')).toBe('lease-2');
  });

  it('is idempotent, and a later read becomes current again', async () => {
    await retire([]);
    expect(await retire([])).toEqual([]);
    await version(LEASE, 'lease-3');
    expect(await current()).toEqual(['lease-3']);
  });

  it('never retires a kept field', async () => {
    expect(await retire(['national_id_number'])).toEqual([]);
    expect(await current()).toEqual(['lease-2']);
  });

  it('leaves a consultant-approved current value alone, and says so', async () => {
    await db.query(
      `insert into consultant_approvals
         (application_id, consultant_id, scope, field_key, decision, value_hash)
       values ($1, gen_random_uuid(), 'field', 'national_id_number', 'approved', 'lease-2')`,
      [APP],
    );
    expect(await retire([])).toEqual([
      { field_key: 'national_id_number', retired: 0, skipped_approved: true },
    ]);
    expect(await current()).toEqual(['lease-2']);
  });

  it("deleting the document (cascade) after a retire keeps the other evidence's chain", async () => {
    await retire([]);
    await db.query(`delete from documents where id = $1`, [LEASE]);
    expect(await current()).toEqual(['card-2']);
    expect(await next('card-1')).toBe('card-2');
    const left = await db.query<{ n: number }>(
      `select count(*)::int as n from field_provenance`,
    );
    expect(left.rows[0].n).toBe(2);
  });

  it('only the service role may retire (Supabase default privileges)', async () => {
    expect(await canExecute(db, 'anon', RETIRE)).toBe(false);
    expect(await canExecute(db, 'authenticated', RETIRE)).toBe(false);
    expect(await canExecute(db, 'service_role', RETIRE)).toBe(true);
    expect(await canExecute(db, 'anon', LOCK)).toBe(false);
    expect(await canExecute(db, 'authenticated', LOCK)).toBe(false);
  });

  it('the rollback removes both functions and leaves create_version working', async () => {
    await db.exec(
      migration('rollback/20261020120000_field_provenance_retire.down.sql'),
    );
    const left = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_proc
        where proname in ('field_provenance_retire', 'field_provenance_lock')`,
    );
    expect(left.rows[0].n).toBe(0);
    await version(LEASE, 'after-rollback');
    expect(await current()).toEqual(['after-rollback']);
  });
});

/**
 * The relink trigger must not follow a retired row's self-pointer: before
 * #248 a live row pointing at a retired one made it loop forever. PGlite
 * ignores statement_timeout, so a regression would hang the worker; the case
 * runs in a child process with a hard kill instead.
 */
describe('relink trigger and a retired row (real Postgres, child process)', () => {
  it('fails the delete cleanly instead of looping', () => {
    const out = spawnSync(
      process.execPath,
      [join(__dirname, 'relink-self-pointer.case.mjs')],
      { encoding: 'utf8', timeout: 20_000 },
    );
    expect(out.error?.message ?? '').not.toMatch(/ETIMEDOUT/);
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toMatch(/^refused: .*foreign key/);
  });
});
