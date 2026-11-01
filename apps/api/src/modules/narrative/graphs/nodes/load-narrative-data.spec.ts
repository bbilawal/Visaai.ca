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

describe('loadNarrativeData — the route names the visa', () => {
  // Dry run 2026-10-16: an eTA applicant's LOE said "applying for a visitor
  // visa". The registry flow never sets a framework, so the prompt received an
  // empty visa name and the model filled the gap with the commonest answer.
  function registryDb(): SupabaseClient {
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
              vri_score: null,
              destination_country: 'CA',
              country_frameworks: null,
              visa_types: {
                visaai_id: 'ca-electronic-travel-authorization-eta',
                official_name: 'Electronic travel authorization (eTA)',
              },
            })
          : chain({ profile_json: { purpose_of_visit: 'tourism' } }),
    } as unknown as SupabaseClient;
  }

  it('uses the registry visa type and destination when there is no framework', async () => {
    const out = await makeLoadNarrativeDataNode(registryDb())({
      applicationId: 'app-1',
    } as NarrativeState);
    expect(out.context?.visaType).toBe('Electronic travel authorization (eTA)');
    expect(out.context?.countryCode).toBe('CA');
  });
});
