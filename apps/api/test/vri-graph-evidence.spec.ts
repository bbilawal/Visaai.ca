import type { SupabaseClient } from '@supabase/supabase-js';
import { RETIREE_DATA } from './fixtures/vri-trv-refused-retiree';
import { DEFAULT_RISK_SNAPSHOT } from '../src/modules/vri/risk-config.types';

/**
 * End-to-end through the compiled VRI graph (LLMs mocked): the refused-retiree
 * case loads, every factor is scored from evidence, recommendations address
 * the refusal, and the save node writes the pinned applications.vri_score via
 * the service-role client — the path that failed for every user on prod.
 */
const llmInvoke = jest.fn().mockResolvedValue({ content: '[]' });
const suggestInvoke = jest.fn().mockResolvedValue({ suggestions: [] });
jest.mock('../src/modules/shared/ai/model-factory', () => ({
  chatModelForTask: () => ({
    invoke: llmInvoke,
    withStructuredOutput: () => ({ invoke: suggestInvoke }),
  }),
}));

import { buildVriGraph } from '../src/modules/vri/graphs/vri.graph';

type Row = Record<string, unknown>;
const tables: Record<string, unknown> = {
  applications: {
    destination_country: 'CA',
    plan_tier: 'copilot',
    country_frameworks: null,
  },
  application_profiles: { profile_json: RETIREE_DATA.profile },
  checklist_items: RETIREE_DATA.checklistItems,
  documents: RETIREE_DATA.documents,
  document_verifications: RETIREE_DATA.verifications,
  cross_verifications: RETIREE_DATA.crossVerifications,
};

function client(
  writes: Array<{ table: string; op: string; payload?: unknown }>,
) {
  return {
    from(table: string) {
      let result: { data: unknown; error: null } = {
        data: tables[table] ?? null,
        error: null,
      };
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order', 'limit'])
        chain[m] = () => chain;
      chain.insert = (payload: unknown) => {
        writes.push({ table, op: 'insert', payload });
        result = {
          data: table === 'vri_scores' ? { id: 'score-1' } : null,
          error: null,
        };
        return chain;
      };
      chain.update = (payload: unknown) => {
        writes.push({ table, op: 'update', payload });
        result = { data: [{ id: 'app-1' }], error: null };
        return chain;
      };
      chain.delete = () => {
        writes.push({ table, op: 'delete' });
        return chain;
      };
      chain.single = () => Promise.resolve(result);
      chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(result).then(res);
      return chain;
    },
  } as unknown as SupabaseClient;
}

it('scores the refused-retiree case from evidence and saves through the admin client', async () => {
  const userWrites: Array<{ table: string; op: string; payload?: unknown }> =
    [];
  const adminWrites: typeof userWrites = [];
  const graph = buildVriGraph(
    client(userWrites),
    'sk-test',
    'en',
    DEFAULT_RISK_SNAPSHOT,
    undefined,
    { applicationId: 'app-1', userId: 'user-1' },
    client(adminWrites),
  );

  const result = await graph.invoke({ applicationId: 'app-1' });

  // No factor fell back to the old dummy values for this applicant.
  expect(result.scores.home_ties_pct).toBeGreaterThan(0);
  expect(result.scores.financial_pct).toBeGreaterThan(0);
  expect(result.scores.consistency_pct).toBeGreaterThan(0);
  expect(result.scores.documentation_pct).toBeLessThan(100);
  expect(result.unassessedFactors).toEqual(['employment_pct']);
  expect(Object.keys(result.factorEvidence).sort()).toEqual([
    'consistency_pct',
    'documentation_pct',
    'employment_pct',
    'financial_pct',
    'home_ties_pct',
    'travel_history_pct',
  ]);
  expect(
    result.recommendations.some((r: { issue: string }) =>
      /179\(b\)/.test(r.issue),
    ),
  ).toBe(true);

  const recRow = userWrites.find((w) => w.table === 'vri_recommendations');
  expect(recRow).toBeDefined();
  expect(userWrites.some((w) => w.table === 'applications')).toBe(false);
  expect(adminWrites).toEqual([
    expect.objectContaining({ table: 'applications', op: 'update' }),
  ]);
  expect((adminWrites[0].payload as Row).vri_score).toBe(result.overallScore);
});
