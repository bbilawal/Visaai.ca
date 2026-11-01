import type { SupabaseClient } from '@supabase/supabase-js';
import { makeSaveVriNode } from '../src/modules/vri/graphs/nodes/save-vri';
import type { VriState } from '../src/modules/vri/graphs/vri.state';

/**
 * Prod bug 2026-10-14: POST /vri/:id/calculate failed for EVERY user with
 *   "Failed to update application VRI score: SEC-4094: applications system
 *    columns are not owner-writable"
 *
 * SEC-4094 (migration 20260816120000) pins applications.vri_score against
 * owner writes, by design. The save node wrote the denormalised score with the
 * caller's RLS-scoped client, so the trigger rejected it. And because the
 * vri_scores / recommendations / suggestions inserts had already landed, every
 * failed calculate left an orphan score row that GET /vri/:id then served as
 * the "latest" result while the request itself had returned a 500.
 *
 * Contract now:
 *  - the applications update goes through the service-role client, scoped to
 *    the one application id AND its owner (ownership is verified upstream in
 *    VriService.calculate before the graph runs);
 *  - the per-score rows stay on the user client (RLS allows them);
 *  - any failure after the score row is inserted deletes that row again, so a
 *    failed calculate leaves nothing behind.
 */

type Call = {
  client: 'user' | 'admin';
  table: string;
  op: string;
  args: unknown[];
};

function recordingClient(
  name: 'user' | 'admin',
  calls: Call[],
  fail: Partial<Record<string, string>> = {},
): SupabaseClient {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      let op = 'select';
      let result: { data: unknown; error: { message: string } | null } = {
        data: null,
        error: null,
      };
      const settle = () => {
        const key = `${table}.${op}`;
        if (fail[key]) return { data: null, error: { message: fail[key] } };
        if (op === 'insert' && table === 'vri_scores')
          return { data: { id: 'score-1' }, error: null };
        if (op === 'update') return { data: [{ id: 'app-1' }], error: null };
        return result;
      };
      for (const m of ['insert', 'update', 'delete']) {
        chain[m] = (...args: unknown[]) => {
          op = m;
          calls.push({ client: name, table, op: m, args });
          result = settle();
          return chain;
        };
      }
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
        chain[m] = (...args: unknown[]) => {
          calls.push({ client: name, table, op: m, args });
          return chain;
        };
      }
      chain.single = () => Promise.resolve(result);
      chain.then = (
        res: (v: unknown) => unknown,
        rej?: (e: unknown) => unknown,
      ) => Promise.resolve(result).then(res, rej);
      return chain;
    },
  } as unknown as SupabaseClient;
}

const baseState = {
  applicationId: 'app-1',
  overallScore: 42,
  scores: {
    documentation_pct: 50,
    financial_pct: 40,
    travel_history_pct: 30,
    home_ties_pct: 60,
    employment_pct: 20,
    consistency_pct: 70,
  },
  unassessedFactors: [],
  escalate: true,
  escalationReason: 'low_overall_readiness',
  recommendations: [
    {
      factor: 'financial_pct',
      issue: 'x',
      recommendation_text: 'y',
      priority: 60,
    },
  ],
  visaSuggestions: [],
} as unknown as VriState;

describe('save-vri — SEC-4094 denormalisation', () => {
  it('writes applications.vri_score with the admin client, scoped to id + owner', async () => {
    const calls: Call[] = [];
    const node = makeSaveVriNode(
      recordingClient('user', calls),
      recordingClient('admin', calls),
      'user-1',
    );

    await node(baseState);

    const userAppUpdates = calls.filter(
      (c) =>
        c.client === 'user' && c.table === 'applications' && c.op === 'update',
    );
    expect(userAppUpdates).toHaveLength(0);

    const adminUpdate = calls.find(
      (c) =>
        c.client === 'admin' && c.table === 'applications' && c.op === 'update',
    );
    expect(adminUpdate?.args[0]).toEqual({
      vri_score: 42,
      needs_consultant_escalation: true,
      escalation_reason: 'low_overall_readiness',
    });
    const adminEqs = calls
      .filter((c) => c.client === 'admin' && c.op === 'eq')
      .map((c) => c.args);
    expect(adminEqs).toEqual(
      expect.arrayContaining([
        ['id', 'app-1'],
        ['user_id', 'user-1'],
      ]),
    );

    // The admin client touches applications and nothing else.
    expect(
      calls.filter((c) => c.client === 'admin' && c.table !== 'applications'),
    ).toHaveLength(0);
    // Per-score rows stay under RLS.
    expect(
      calls.some(
        (c) =>
          c.client === 'user' && c.table === 'vri_scores' && c.op === 'insert',
      ),
    ).toBe(true);
  });

  it('deletes the inserted score row when the applications update fails', async () => {
    const calls: Call[] = [];
    const node = makeSaveVriNode(
      recordingClient('user', calls),
      recordingClient('admin', calls, {
        'applications.update':
          'SEC-4094: applications system columns are not owner-writable',
      }),
      'user-1',
    );

    await expect(node(baseState)).rejects.toThrow(
      /Failed to update application VRI score/,
    );

    const del = calls.find(
      (c) => c.table === 'vri_scores' && c.op === 'delete',
    );
    expect(del).toBeDefined();
    expect(
      calls.some(
        (c) =>
          c.table === 'vri_scores' && c.op === 'eq' && c.args[1] === 'score-1',
      ),
    ).toBe(true);
  });

  it('deletes the inserted score row when the recommendations insert fails', async () => {
    const calls: Call[] = [];
    const node = makeSaveVriNode(
      recordingClient('user', calls, { 'vri_recommendations.insert': 'boom' }),
      recordingClient('admin', calls),
      'user-1',
    );

    await expect(node(baseState)).rejects.toThrow(/recommendations/);
    expect(
      calls.some((c) => c.table === 'vri_scores' && c.op === 'delete'),
    ).toBe(true);
    // And the application row is never touched for a score that does not exist.
    expect(
      calls.some((c) => c.table === 'applications' && c.op === 'update'),
    ).toBe(false);
  });

  it('fails (and cleans up) when the update matched no application row', async () => {
    const calls: Call[] = [];
    const admin = recordingClient('admin', calls);
    // Simulate a 0-row update: owner filter excluded it.
    const origFrom = (
      admin as unknown as { from: (t: string) => Record<string, unknown> }
    ).from;
    (admin as unknown as { from: unknown }).from = (t: string) => {
      const chain = origFrom(t);
      const upd = chain.update as (...a: unknown[]) => Record<string, unknown>;
      chain.update = (...a: unknown[]) => {
        const c = upd(...a);
        c.then = (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(res);
        return c;
      };
      return chain;
    };
    const node = makeSaveVriNode(
      recordingClient('user', calls),
      admin,
      'user-1',
    );

    await expect(node(baseState)).rejects.toThrow(/no application row/);
    expect(
      calls.some((c) => c.table === 'vri_scores' && c.op === 'delete'),
    ).toBe(true);
  });
});
