import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Schema-hygiene guards for two migrations verified locally but NOT yet applied
 * to production (blocked on BLK-1 — production has no backup):
 *
 *   DB-003    revoke DML grants that no RLS policy can exercise
 *   PERF-007  drop five redundant indexes
 *
 * Each was checked once, by hand. That is worth nothing the day someone adds a
 * table — which arrives with Supabase's default `grant all to anon,
 * authenticated` — or recreates an index a constraint already provides. These
 * assert the PROPERTY, not the migration, so they fail on the next regression
 * rather than on a rerun of the same file.
 *
 * The invariants are exposed by two catalogue-only views
 * (20260809150000_schema_hygiene_views.sql), because information_schema and
 * pg_indexes are not reachable through PostgREST.
 *
 * Gated on Supabase credentials like the RLS suites. CI's tenant-isolation job
 * supplies them and fails if any suite skips, so this cannot quietly stop
 * running. A missing view is a FAILURE, not a skip: a guard that passes because
 * it could not look is worse than no guard at all.
 */
const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONFIGURED = Boolean(URL && SERVICE_KEY);
const describeIf = CONFIGURED ? describe : describe.skip;

/** Pull one string column out of a PostgREST result, which arrives as `any`. */
function names(rows: unknown, key: string): string[] {
  if (!Array.isArray(rows)) return [];
  return (rows as Record<string, unknown>[])
    .map((r) => r[key])
    .filter((v): v is string => typeof v === 'string');
}

const REDUNDANT_INDEXES = [
  'idx_applications_monitor_token',
  'audit_events_app_seq_idx',
  'subscription_credits_balance_idx',
  'voice_sessions_cost_idx',
  'evidence_packages_app_idx',
];

describeIf('schema hygiene (DB-003, PERF-007)', () => {
  let db: SupabaseClient;

  beforeAll(() => {
    // Built here rather than at module scope: describe.skip still evaluates the
    // describe body, so a top-level createClient would run even when skipped.
    db = createClient(URL!, SERVICE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it('DB-003 — no client-role DML grant exists without a matching write policy', async () => {
    const { data, error } = await db
      .from('v_client_dml_grants_without_policy')
      .select('table_name');

    // A missing view means the migration has not been applied, and this suite
    // then has no idea whether the invariant holds — so fail, do not skip.
    expect(error?.message ?? null).toBeNull();

    const offenders = names(data, 'table_name');
    expect(offenders).toEqual([]);
  });

  it('PERF-007 — the redundant indexes have not been recreated', async () => {
    const { data, error } = await db
      .from('v_public_indexes')
      .select('indexname');
    // A missing view means the migration has not been applied — fail, do not skip.
    expect(error?.message ?? null).toBeNull();

    const present = new Set(names(data, 'indexname'));
    const back = REDUNDANT_INDEXES.filter((i) => present.has(i));
    expect(back).toEqual([]);
  });

  it('PERF-007 — the indexes that COVER them still exist', async () => {
    // Dropping the redundant one is only safe while its replacement is there.
    const required = [
      'applications_monitor_token_key',
      'audit_events_application_id_seq_key',
      'subscription_credits_subscription_id_period_start_key',
      'voice_sessions_user_idx',
      'evidence_packages_application_id_version_key',
    ];
    const { data, error } = await db
      .from('v_public_indexes')
      .select('indexname');
    expect(error).toBeNull();

    const present = new Set(names(data, 'indexname'));
    const missing = required.filter((i) => !present.has(i));
    expect(missing).toEqual([]);
  });
});
