/**
 * Drift guard: the backend Schengen member set and the database
 * public.is_schengen_member() helper must agree, code for code.
 *
 * WHY THIS EXISTS: schengen-members.ts and 20260611000001_schengen_bloc_visibility.sql
 * each carried an independent hardcoded list with only a comment ("MUST stay
 * byte-identical") holding them together. Both drifted the same way and stayed
 * silently wrong for ~19 months — Bulgaria and Romania became full Schengen
 * members (air/sea 31 Mar 2024, land 1 Jan 2025) and neither list was updated.
 * A comment is not an enforcement mechanism; this test is.
 *
 * The consequence of drift is not a crash. consultant_covers_country() expands
 * the 'SCHENGEN' bloc through the DB helper, so a missing member means bloc
 * consultants silently cover nothing for that destination.
 *
 * Requires a live Supabase (the local disposable stack is fine). GATED on env
 * so the default `pnpm test` stays green without a database:
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx jest schengen-registry-db-parity
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SCHENGEN_MEMBER_CODES } from '../src/strategies';

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONFIGURED = Boolean(URL && SERVICE_KEY);

const describeIf = CONFIGURED ? describe : describe.skip;

/** Non-members used as negative controls. */
const NON_MEMBERS = ['GB', 'IE', 'US', 'CA', 'AU', 'TR', 'RS', 'UA', 'CY'];

describeIf('Schengen registry ↔ database parity', () => {
  jest.setTimeout(45_000);

  // Built lazily in beforeAll, NOT in the describe body: describe.skip still
  // evaluates its callback, so constructing the client here would throw on
  // undefined credentials and fail the suite to *run* rather than skip it.
  let db: SupabaseClient;

  beforeAll(() => {
    db = createClient(URL!, SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  async function isMember(code: string): Promise<boolean> {
    const { data, error } = await db.rpc('is_schengen_member', {
      p_code: code,
    });
    if (error)
      throw new Error(`is_schengen_member('${code}') failed: ${error.message}`);
    return data as boolean;
  }

  it('recognises every code the backend registry considers a member', async () => {
    const disagreements: string[] = [];
    for (const code of SCHENGEN_MEMBER_CODES) {
      if (!(await isMember(code))) disagreements.push(code);
    }
    expect(disagreements).toEqual([]);
  });

  it('rejects codes the backend registry does not consider members', async () => {
    const disagreements: string[] = [];
    for (const code of NON_MEMBERS) {
      if (await isMember(code)) disagreements.push(code);
    }
    expect(disagreements).toEqual([]);
  });

  it('includes Bulgaria and Romania (full members since 2024/2025)', async () => {
    expect(await isMember('BG')).toBe(true);
    expect(await isMember('RO')).toBe(true);
    expect(SCHENGEN_MEMBER_CODES).toContain('BG');
    expect(SCHENGEN_MEMBER_CODES).toContain('RO');
  });

  it('is case-insensitive on the database side', async () => {
    expect(await isMember('de')).toBe(true);
    expect(await isMember('De')).toBe(true);
  });

  it('treats the bloc sentinel itself as a non-member', async () => {
    // consultant_covers_country() relies on this: 'SCHENGEN' matches legacy
    // rows through the EXACT branch, never through bloc expansion.
    expect(await isMember('SCHENGEN')).toBe(false);
  });
});
