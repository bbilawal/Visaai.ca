import type { PrefilledFormField } from '@visaai/types';
import { finalizeFields, type FinalizeContext } from './finalize-fields';
import { collectDocumentFields } from './load-context';

/**
 * Replay of the prod prefill for super visa app 61f16bb5 (2026-10-16 21:23Z).
 * Applicant SUMERA AHMAD (born 1968-10-09); host her son Mian Muhammad Bilawal
 * (born 1989-10-14). The generated form said:
 *  - host_date_of_birth "1968-10-09" (source document) — the applicant's own
 *    DOB, read off a household list whose extraction paired the host's name
 *    with the mother's date;
 *  - insurance_coverage_amount "" although both policies print 100000;
 * and every insurance field depended on which of two uploaded policies the
 * model happened to read.
 */

function f(
  key: string,
  value: string,
  source: PrefilledFormField['source'] = 'profile',
): PrefilledFormField {
  return { key, label: key, value, source, group: 'G' };
}

const HOUSEHOLD = {
  documentType: 'letter_of_invitation_contents',
  subject: 'third_party' as const,
  holderName: 'Mian Muhammad Bilawal',
  fields: { full_name: 'Mian Muhammad Bilawal', date_of_birth: '1968-10-09' },
};
const HOST_PASSPORT = {
  documentType: 'proof_of_host_status',
  subject: 'third_party' as const,
  holderName: 'MIAN MUHAMMAD',
  fields: { full_name: 'MIAN MUHAMMAD', date_of_birth: '1989-10-14' },
};

const EXPIRED_POLICY = {
  full_name: 'AHMAD, Sumera AHMAD, Muzaffar',
  expiry_date: 'May-31-2026',
  insurer_name: '21st Century TRAVEL INSURANCE LIMITED',
  policy_number: '11460162V-A',
  coverage_amount: 100000,
  coverage_end_date: '(Jun-15-1961 / 63 yrs)',
  coverage_start_date: 'Jun-01-2025',
};
const COVERING_POLICY = {
  full_name: 'SUMERA AHMAD',
  insurer_name: 'TEST DUMMY Canadian Insurance Company Inc.',
  policy_number: 'SV-DUMMY-2027-001',
  coverage_amount: 100000,
  coverage_end_date: '2028-03-01',
  coverage_start_date: '2027-03-01',
};

function ctx(over: Partial<FinalizeContext> = {}): FinalizeContext {
  return {
    applicantName: 'SUMERA AHMAD',
    profile: {
      full_name: 'SUMERA AHMAD',
      date_of_birth: '1968-10-09',
      inviter_name: 'Mian Muhammad Bilawal',
      planned_entry_date: '2027-03-01',
      planned_departure_date: '2028-02-28',
    },
    documentFields: { full_name: 'SUMERA AHMAD', date_of_birth: '1968-10-09' },
    documentFieldsByType: {},
    otherPartyDocuments: [HOUSEHOLD, HOST_PASSPORT],
    accountProfile: {},
    ...over,
  };
}

const byKey = (fields: PrefilledFormField[], key: string) =>
  fields.find((x) => x.key === key);

describe("finalizeFields — the host's date of birth is the host's", () => {
  it("replaces the applicant's DOB with the host DOB the intake recorded", () => {
    const out = finalizeFields(
      [
        f('host_full_name', 'Mian Muhammad Bilawal'),
        f('host_date_of_birth', '1968-10-09', 'document'),
      ],
      ctx({
        profile: { ...ctx().profile, inviter_date_of_birth: '1989-10-14' },
      }),
    );
    expect(byKey(out, 'host_date_of_birth')).toMatchObject({
      value: '1989-10-14',
      source: 'profile',
    });
  });

  it("falls back to the host's own identity document, never a DOB equal to the applicant's", () => {
    const out = finalizeFields(
      [f('host_date_of_birth', '1968-10-09', 'document')],
      ctx(),
    );
    expect(byKey(out, 'host_date_of_birth')).toMatchObject({
      value: '1989-10-14',
      source: 'document',
    });
  });

  it("clears it for review when only the applicant's DOB is on offer", () => {
    const out = finalizeFields(
      [f('host_date_of_birth', '1968-10-09', 'document')],
      ctx({ otherPartyDocuments: [HOUSEHOLD] }),
    );
    const field = byKey(out, 'host_date_of_birth');
    expect(field?.value).toBe('');
    expect(field?.needsReview).toBe(true);
  });

  it('leaves a correct host DOB alone', () => {
    const out = finalizeFields(
      [f('inviter_date_of_birth', '1989-10-14', 'document')],
      ctx(),
    );
    expect(byKey(out, 'inviter_date_of_birth')).toMatchObject({
      value: '1989-10-14',
      source: 'document',
    });
    expect(byKey(out, 'inviter_date_of_birth')?.needsReview).toBeUndefined();
  });
});

describe('finalizeFields — insurance comes from the policy that covers the stay', () => {
  const generated = () => [
    f(
      'insurance_insurer_name',
      '21st Century TRAVEL INSURANCE LIMITED',
      'document',
    ),
    f('insurance_policy_number', '11460162V-A', 'document'),
    f('insurance_coverage_amount', ''),
    f('insurance_coverage_start_date', '2025-06-01', 'document'),
    f('insurance_coverage_end_date', '2026-05-31', 'document'),
  ];

  it.each([
    ['expired first', [EXPIRED_POLICY, COVERING_POLICY]],
    ['covering first', [COVERING_POLICY, EXPIRED_POLICY]],
  ])('%s', (_l, insurancePolicies) => {
    const out = finalizeFields(generated(), ctx({ insurancePolicies }));
    expect(byKey(out, 'insurance_insurer_name')?.value).toBe(
      'TEST DUMMY Canadian Insurance Company Inc.',
    );
    expect(byKey(out, 'insurance_policy_number')?.value).toBe(
      'SV-DUMMY-2027-001',
    );
    expect(byKey(out, 'insurance_coverage_amount')?.value).toBe('100000');
    expect(byKey(out, 'insurance_coverage_start_date')?.value).toBe(
      '2027-03-01',
    );
    expect(byKey(out, 'insurance_coverage_end_date')?.value).toBe('2028-03-01');
  });

  it('flags a policy that does not cover the stay', () => {
    const out = finalizeFields(
      generated(),
      ctx({ insurancePolicies: [EXPIRED_POLICY] }),
    );
    expect(byKey(out, 'insurance_policy_number')?.needsReview).toBe(true);
    expect(byKey(out, 'insurance_policy_number')?.note).toMatch(
      /does not cover/,
    );
  });

  it('fills the cover amount from the intake when no policy is uploaded', () => {
    const out = finalizeFields(
      [f('insurance_coverage_amount', '')],
      ctx({
        profile: { ...ctx().profile, medical_insurance_coverage_cad: 100000 },
      }),
    );
    expect(byKey(out, 'insurance_coverage_amount')?.value).toBe('100000');
  });
});

describe('finalizeFields — form fields the profile already answers', () => {
  it('fills empty fields from the profile under their recorded keys', () => {
    const out = finalizeFields(
      [
        f('place_of_birth', ''),
        f('residential_address', ''),
        f('second_host_full_name', ''),
        f('previous_visa_refusal', ''),
        f('spouse_family_name', ''),
        f('spouse_given_name', ''),
      ],
      ctx({
        profile: {
          ...ctx().profile,
          city_of_birth: 'Rawalpindi',
          residential_address: '138 Millat Colony, Rawalpindi 46000, Pakistan',
          second_inviter_name: 'Mian Muhammad Sajawal',
          refused_visa_or_denied_entry: false,
          spouse_family_name: 'Ahmad',
          spouse_given_name: 'Muzaffar',
        },
      }),
    );
    expect(byKey(out, 'place_of_birth')?.value).toBe('Rawalpindi');
    expect(byKey(out, 'residential_address')?.value).toBe(
      '138 Millat Colony, Rawalpindi 46000, Pakistan',
    );
    expect(byKey(out, 'second_host_full_name')?.value).toBe(
      'Mian Muhammad Sajawal',
    );
    expect(byKey(out, 'previous_visa_refusal')?.value).toBe('No');
    expect(byKey(out, 'spouse_family_name')?.value).toBe('Ahmad');
    expect(byKey(out, 'spouse_given_name')?.value).toBe('Muzaffar');
  });

  it('fills prod 2026-10-17 app 61f16bb5: birthplace_city, occupation, second inviter', () => {
    // The form the generator produced: place_of_birth, current_occupation and
    // the second inviter left empty although the profile answered them.
    const out = finalizeFields(
      [
        f('place_of_birth', ''),
        f('current_occupation', ''),
        f('second_inviter_name', ''),
        f('second_inviter_address', ''),
        f('second_inviter_phone', ''),
      ],
      ctx({
        profile: {
          ...ctx().profile,
          place_of_birth: null,
          birthplace_city: 'Rawalpindi',
          occupation: 'Homemaker',
          second_inviter_name: 'Mian Muhammad Sajawal',
          second_inviter_address: '1228 Turner Drive, Milton, Ontario L9T 5R6',
          second_inviter_phone: '647-819-8953',
        },
      }),
    );
    expect(byKey(out, 'place_of_birth')?.value).toBe('Rawalpindi');
    expect(byKey(out, 'current_occupation')?.value).toBe('Homemaker');
    expect(byKey(out, 'second_inviter_name')?.value).toBe(
      'Mian Muhammad Sajawal',
    );
    expect(byKey(out, 'second_inviter_address')?.value).toBe(
      '1228 Turner Drive, Milton, Ontario L9T 5R6',
    );
    expect(byKey(out, 'second_inviter_phone')?.value).toBe('647-819-8953');
  });

  it('never overwrites a value the form already has', () => {
    const out = finalizeFields(
      [f('place_of_birth', 'Lahore')],
      ctx({ profile: { ...ctx().profile, place_of_birth: 'Rawalpindi' } }),
    );
    expect(byKey(out, 'place_of_birth')?.value).toBe('Lahore');
  });
});

describe('collectDocumentFields — every uploaded policy reaches finalize', () => {
  it('lists each insurance document separately', () => {
    const rows = [EXPIRED_POLICY, COVERING_POLICY].map((fields) => ({
      verification_type: 'identity',
      details_json: { extracted_fields: fields },
      documents: { document_type: 'medical_insurance' },
    }));
    const out = collectDocumentFields(rows, 'SUMERA AHMAD');
    expect(out.insurancePolicies.map((p) => p.policy_number)).toEqual([
      '11460162V-A',
      'SV-DUMMY-2027-001',
    ]);
  });
});
