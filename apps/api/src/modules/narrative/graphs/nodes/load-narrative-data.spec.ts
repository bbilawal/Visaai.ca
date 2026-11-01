import type { SupabaseClient } from '@supabase/supabase-js';
import { makeLoadNarrativeDataNode } from './load-narrative-data';
import type { NarrativeState } from '../narrative.state';

function db(profileJson: Record<string, unknown>): SupabaseClient {
  const chain = (data: unknown) => {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = () => c;
    c.single = () => Promise.resolve({ data, error: null });
    return c;
  };
  return {
    from: (table: string) =>
      table === 'applications'
        ? chain({
            vri_score: 70,
            country_frameworks: {
              country_code: 'CA',
              visa_type: 'visitor',
              purpose: 'family',
            },
          })
        : chain({ profile_json: profileJson }),
  } as unknown as SupabaseClient;
}

describe('loadNarrativeData — length of stay comes from the dates', () => {
  it('replaces the stated 56 with the 62 days the dates cover (cover letter vs LOE drift)', async () => {
    const node = makeLoadNarrativeDataNode(
      db({
        planned_entry_date: '2026-12-01',
        planned_departure_date: '2027-01-31',
        duration_of_stay_days: 56,
      }),
    );
    const out = await node({ applicationId: 'app-1' } as NarrativeState);
    expect(out.context?.profile.duration_of_stay_days).toBe(62);
    expect(out.context?.stay).toEqual({
      entryDate: '2026-12-01',
      departureDate: '2027-01-31',
      days: 62,
      nights: 61,
    });
  });

  it('keeps the stated duration when the dates are unknown', async () => {
    const node = makeLoadNarrativeDataNode(db({ duration_of_stay_days: 56 }));
    const out = await node({ applicationId: 'app-1' } as NarrativeState);
    expect(out.context?.profile.duration_of_stay_days).toBe(56);
    expect(out.context?.stay ?? null).toBeNull();
  });
});
