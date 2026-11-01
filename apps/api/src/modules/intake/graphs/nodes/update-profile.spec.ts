import type { SupabaseClient } from '@supabase/supabase-js';
import { makeUpdateProfileNode } from './update-profile';
import type { IntakeState } from '../intake.state';

/**
 * The intake graph carries the profile in its checkpoint, which can be hours
 * old. Document OCR writes fields into the same row in the meantime. Writing
 * the checkpoint back wholesale erased them — prod 2026-10-15: full_name,
 * nationality, marriage_date, job_title and employment_start_date vanished
 * the moment the applicant sent one new intake answer.
 */
function db(current: Record<string, unknown> | null, readError?: string) {
  const upsert = jest.fn().mockResolvedValue({ error: null });
  const maybeSingle = jest.fn().mockResolvedValue({
    data: current === null ? null : { profile_json: current },
    error: readError ? { message: readError } : null,
  });
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      upsert,
    }),
  } as unknown as SupabaseClient;
  return { client, upsert };
}

function state(profileJson: Record<string, unknown>): IntakeState {
  return {
    applicationId: 'app-1',
    profileJson,
    riskIndicators: {},
  } as unknown as IntakeState;
}

describe('updateProfile', () => {
  it('keeps fields written to the row since the checkpoint was taken', async () => {
    const { client, upsert } = db({
      planned_entry_date: '2026-12-01',
      nationality: 'PAK',
      marriage_date: '16-9-1999',
    });
    await makeUpdateProfileNode(client)(
      state({ planned_entry_date: '2027-03-01', duration_of_stay_days: 61 }),
    );
    expect(upsert.mock.calls[0][0].profile_json).toEqual({
      planned_entry_date: '2027-03-01',
      duration_of_stay_days: 61,
      nationality: 'PAK',
      marriage_date: '16-9-1999',
    });
  });

  it('never rolls back document provenance or consistency flags from a stale checkpoint', async () => {
    const fresh = {
      marriage_date: {
        document_id: 'd2',
        document_type: 'marriage_certificate',
        value: '1988-09-16',
      },
    };
    const { client, upsert } = db({
      marriage_date: '1988-09-16',
      _document_sources: fresh,
    });
    await makeUpdateProfileNode(client)(
      state({
        purpose_of_visit: 'family',
        _document_sources: { marriage_date: { value: '16-9-1999' } },
        document_consistency_flags: [{ code: 'marriage_after_child_birth' }],
      }),
    );
    const written = upsert.mock.calls[0][0].profile_json;
    expect(written._document_sources).toEqual(fresh);
    expect(written.document_consistency_flags).toBeUndefined();
  });

  it('writes the intake profile as-is when there is no row yet', async () => {
    const { client, upsert } = db(null);
    await makeUpdateProfileNode(client)(state({ a: 1 }));
    expect(upsert.mock.calls[0][0].profile_json).toEqual({ a: 1 });
  });

  it('does not write at all when the current row cannot be read', async () => {
    const { client, upsert } = db(null, 'boom');
    await expect(
      makeUpdateProfileNode(client)(state({ a: 1 })),
    ).rejects.toThrow('boom');
    expect(upsert).not.toHaveBeenCalled();
  });
});
