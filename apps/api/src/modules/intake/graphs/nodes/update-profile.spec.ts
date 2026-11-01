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

  describe('an applicant correction after the documents (dry run 2026-10-15)', () => {
    const SONS = [
      { name: 'Mian Talha', date_of_birth: '2000-05-12', relationship: 'son' },
      { name: 'Mian Hamza', date_of_birth: '1992-02-01', relationship: 'son' },
    ];
    const FLAG = {
      code: 'marriage_after_child_birth',
      field: 'marriage_date',
      message: 'The marriage date (1999-09-16) is after …',
    };
    const OTHER_FLAG = {
      code: 'name_mismatch',
      field: 'full_name',
      message: 'x',
    };

    it('the corrected marriage date wins and clears the flags it resolves', async () => {
      const { client, upsert } = db({
        marriage_date: '1999-09-16',
        children: SONS,
        _document_sources: {
          marriage_date: { document_id: 'd1', value: '1999-09-16' },
        },
        document_consistency_flags: [FLAG, FLAG, OTHER_FLAG],
      });
      await makeUpdateProfileNode(client)(
        state({ marriage_date: '1988-09-16', children: SONS }),
      );
      const written = upsert.mock.calls[0][0].profile_json;
      expect(written.marriage_date).toBe('1988-09-16');
      // Only the flags the new date resolves are gone; others stay.
      expect(written.document_consistency_flags).toEqual([OTHER_FLAG]);
    });

    it('keeps the flag when the corrected date still contradicts a child', async () => {
      const { client, upsert } = db({
        marriage_date: '1999-09-16',
        children: SONS,
        document_consistency_flags: [FLAG],
      });
      await makeUpdateProfileNode(client)(
        state({ marriage_date: '1995-01-01', children: SONS }),
      );
      const written = upsert.mock.calls[0][0].profile_json;
      expect(written.document_consistency_flags).toHaveLength(1);
      expect(written.document_consistency_flags[0].code).toBe(
        'marriage_after_child_birth',
      );
    });

    it("merges the interview's children into the documents' by name", async () => {
      const { client, upsert } = db({
        children: [{ name: 'Mian Talha', date_of_birth: '2000-05-12' }],
      });
      await makeUpdateProfileNode(client)(
        state({
          children: [
            { name: 'Mian Talha', birth_year: 2000, in_home_country: true },
            { name: 'Mian Hamza', relationship: 'son' },
          ],
        }),
      );
      const written = upsert.mock.calls[0][0].profile_json;
      expect(written.children).toEqual([
        {
          name: 'Mian Talha',
          date_of_birth: '2000-05-12',
          birth_year: 2000,
          in_home_country: true,
        },
        { name: 'Mian Hamza', relationship: 'son', sex: 'Male' },
      ]);
    });

    it('folds flat child keys already on the profile into `children`', async () => {
      // The live application: sons recorded only under ad-hoc keys.
      const { client, upsert } = db({
        youngest_son_name: 'Mian Talha',
        youngest_son_birth_year: 2000,
        children: [
          { name: 'Mian Talha Muzaffar', date_of_birth: '2000-05-12' },
        ],
      });
      await makeUpdateProfileNode(client)(
        state({ purpose_of_visit: 'family' }),
      );
      const written = upsert.mock.calls[0][0].profile_json;
      expect(written.children).toEqual([
        {
          name: 'Mian Talha Muzaffar',
          date_of_birth: '2000-05-12',
          relationship: 'son',
          sex: 'Male',
        },
      ]);
    });
  });
});

describe('updateProfile — facts held only under a synonym (prod 2026-10-17)', () => {
  it('fills place_of_birth and occupation from the synonyms the row holds', async () => {
    const { client, upsert } = db({
      place_of_birth: null,
      birthplace_city: 'Rawalpindi',
    });
    await makeUpdateProfileNode(client)(
      state({ current_occupation: 'Homemaker' }),
    );
    const written = upsert.mock.calls[0][0].profile_json;
    expect(written.place_of_birth).toBe('Rawalpindi');
    expect(written.occupation).toBe('Homemaker');
    // Nothing is dropped.
    expect(written.birthplace_city).toBe('Rawalpindi');
    expect(written.current_occupation).toBe('Homemaker');
  });

  it('never overwrites a canonical value with a synonym', async () => {
    const { client, upsert } = db({
      place_of_birth: 'Rawalpindi, Pakistan',
      birthplace_city: 'Lahore',
    });
    await makeUpdateProfileNode(client)(state({}));
    expect(upsert.mock.calls[0][0].profile_json.place_of_birth).toBe(
      'Rawalpindi, Pakistan',
    );
  });
});

describe('updateProfile — a removed child leaves no flat keys (dry run 2026-10-16)', () => {
  it("drops the removed child's youngest_son_* keys from the row, keeps the host's", async () => {
    const { client, upsert } = db({
      youngest_son_name: 'Mian Talha',
      youngest_son_birth_year: 2000,
      youngest_son_in_home_country: true,
      family_member_name: 'Mian Muhammad Bilawal',
      relationship_to_family_in_destination: 'son',
      children: [{ name: 'Mian Muhammad Bilawal', relationship: 'son' }],
    });
    // The checkpoint still holds the keys (its reducer cannot delete).
    await makeUpdateProfileNode(client)(
      state({
        youngest_son_name: 'Mian Talha',
        youngest_son_birth_year: 2000,
        removed_children: ['Mian Talha'],
      }),
    );
    const written = upsert.mock.calls[0][0].profile_json;
    expect(written).not.toHaveProperty('youngest_son_name');
    expect(written).not.toHaveProperty('youngest_son_birth_year');
    expect(written).not.toHaveProperty('youngest_son_in_home_country');
    expect(written.family_member_name).toBe('Mian Muhammad Bilawal');
    expect(written.relationship_to_family_in_destination).toBe('son');
    expect(written.removed_children).toEqual(['Mian Talha']);
  });
});
