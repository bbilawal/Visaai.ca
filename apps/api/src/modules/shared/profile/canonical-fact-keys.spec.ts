import {
  canonicalizeFactKeys,
  canonicalGapFill,
  routeSecondInviter,
} from './canonical-fact-keys';

/**
 * Prod 2026-10-17, app 61f16bb5 (Canada super visa): the extractor recorded
 * `birthplace_city: "Rawalpindi"` and `occupation`-style answers under keys
 * nothing downstream reads, so place of birth stayed null on the form; and the
 * answer to "Is anyone else inviting you besides Mian Muhammad Bilawal?" —
 * a second son at 1228 Turner Drive — overwrote the PRIMARY inviter's address.
 */
describe('canonicalizeFactKeys', () => {
  it('moves birthplace synonyms onto place_of_birth', () => {
    for (const key of [
      'birthplace_city',
      'birthplace',
      'birth_place',
      'city_of_birth',
      'birth_city',
      'town_of_birth',
      'place_of_birth_city',
    ]) {
      expect(canonicalizeFactKeys({ [key]: 'Rawalpindi' })).toEqual({
        place_of_birth: 'Rawalpindi',
      });
    }
  });

  it('moves occupation synonyms onto occupation (what IMM 5257 reads)', () => {
    for (const key of ['current_occupation', 'current_job', 'profession']) {
      expect(canonicalizeFactKeys({ [key]: 'Homemaker' })).toEqual({
        occupation: 'Homemaker',
      });
    }
  });

  it('moves second-host synonyms onto second_inviter_*', () => {
    expect(
      canonicalizeFactKeys({
        second_host_name: 'Mian Muhammad Sajawal',
        second_host_address: '1228 Turner Drive',
        second_host_phone: '647-819-8953',
      }),
    ).toEqual({
      second_inviter_name: 'Mian Muhammad Sajawal',
      second_inviter_address: '1228 Turner Drive',
      second_inviter_phone: '647-819-8953',
    });
  });

  it('keeps the canonical value when both are given, and the synonym too', () => {
    expect(
      canonicalizeFactKeys({
        place_of_birth: 'Rawalpindi, Pakistan',
        birthplace_city: 'Rawalpindi',
      }),
    ).toEqual({
      place_of_birth: 'Rawalpindi, Pakistan',
      birthplace_city: 'Rawalpindi',
    });
  });

  it('fills a null canonical from the synonym', () => {
    expect(
      canonicalizeFactKeys({
        place_of_birth: null,
        birthplace_city: 'Rawalpindi',
      }),
    ).toEqual({ place_of_birth: 'Rawalpindi' });
  });

  it('never drops unknown keys', () => {
    expect(
      canonicalizeFactKeys({ favourite_colour: 'blue', birth_city: 'Lahore' }),
    ).toEqual({ favourite_colour: 'blue', place_of_birth: 'Lahore' });
  });

  it("leaves a synonym alone when it is the route's own canonical key", () => {
    // The eTA route asks `city_of_birth` itself.
    expect(
      canonicalizeFactKeys(
        { city_of_birth: 'Lahore' },
        new Set(['city_of_birth']),
      ),
    ).toEqual({ city_of_birth: 'Lahore' });
  });
});

describe('canonicalGapFill', () => {
  it('repairs a row that holds the fact only under a synonym', () => {
    expect(
      canonicalGapFill({
        place_of_birth: null,
        birthplace_city: 'Rawalpindi',
        current_occupation: 'Homemaker',
      }),
    ).toEqual({ place_of_birth: 'Rawalpindi', occupation: 'Homemaker' });
  });

  it('never overwrites a canonical value already present', () => {
    expect(
      canonicalGapFill({
        place_of_birth: 'Rawalpindi, Pakistan',
        birthplace_city: 'Lahore',
        occupation: 'Homemaker',
        current_job: 'Teacher',
      }),
    ).toEqual({});
  });
});

describe('routeSecondInviter', () => {
  const PROFILE = {
    inviter_name: 'Mian Muhammad Bilawal',
    inviter_address: '1202 Stirling Todd Terrace, Milton, Ontario L9E 2E2',
  };
  const SECOND_Q =
    'Is anyone else inviting you to Canada besides your primary inviter, Mian Muhammad Bilawal?';

  it('routes an answer to the second-inviter question into second_inviter_*', () => {
    // What the extractor actually returned on prod: the primary's field.
    expect(
      routeSecondInviter(
        PROFILE,
        {
          inviter_address: '1228 Turner Drive, Milton ON L9T 5R6',
          inviter_phone: '647-819-8953',
        },
        SECOND_Q,
      ),
    ).toEqual({
      has_second_inviter: true,
      second_inviter_address: '1228 Turner Drive, Milton ON L9T 5R6',
      second_inviter_phone: '647-819-8953',
      // Moved on a guess: the IRCC fill leaves these to the applicant.
      second_inviter_source: 'router',
    });
  });

  it('routes a different inviter name into second_inviter_*, whatever the question', () => {
    expect(
      routeSecondInviter(
        PROFILE,
        {
          inviter_name: 'Mian Muhammad Sajawal',
          host_address: '1228 Turner Drive',
          inviter_relationship: 'son',
        },
        'Anything else to add?',
      ),
    ).toEqual({
      has_second_inviter: true,
      second_inviter_name: 'Mian Muhammad Sajawal',
      second_inviter_address: '1228 Turner Drive',
      second_inviter_relationship: 'son',
      second_inviter_source: 'router',
    });
  });

  it('keeps a correction to the primary inviter on inviter_*', () => {
    const extracted = {
      inviter_name: 'Mian Muhammad Bilawal',
      inviter_address: '1202 Stirling Todd Terrace',
    };
    expect(routeSecondInviter(PROFILE, extracted, SECOND_Q)).toEqual(extracted);
  });

  it('treats a shortened name as the same person', () => {
    const extracted = {
      inviter_name: 'Bilawal',
      inviter_phone: '905-226-5664',
    };
    expect(routeSecondInviter(PROFILE, extracted, 'Anything else?')).toEqual(
      extracted,
    );
  });

  it('records the primary normally when none is on file yet', () => {
    const extracted = { inviter_name: 'Mian Muhammad Bilawal' };
    expect(routeSecondInviter({}, extracted, 'Who is inviting you?')).toEqual(
      extracted,
    );
  });

  it('does not let a routed value overwrite a second_inviter_* the model also gave', () => {
    expect(
      routeSecondInviter(
        PROFILE,
        {
          inviter_name: 'Mian Muhammad Sajawal',
          second_inviter_name: 'Mian Muhammad Sajawal (co-signer)',
        },
        'Anything else?',
      ),
    ).toEqual({
      has_second_inviter: true,
      second_inviter_name: 'Mian Muhammad Sajawal (co-signer)',
    });
  });

  it('leaves non-inviter facts in a second-inviter answer alone', () => {
    expect(
      routeSecondInviter(PROFILE, { has_second_inviter: false }, SECOND_Q),
    ).toEqual({ has_second_inviter: false });
  });
});
