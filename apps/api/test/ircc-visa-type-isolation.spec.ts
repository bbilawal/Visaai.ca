/**
 * Cross-visa-type isolation on the IRCC Portal Assistant (handoff 2026-10-18
 * §4.D): the TRV, super visa and eTA routes each resolve their own mapping,
 * and no answer stored for one route changes another's writes.
 *
 * Also the super visa audit findings of 2026-10-18:
 *  - the residence row's summary said "Citizen since 1988-09-16" (the
 *    profile's residence_since, the marriage date) after the date was
 *    corrected on the Forms page / consultant review (app 61f16bb5);
 *  - "A second person is inviting you: Yes" left the second inviter's details
 *    unlisted for the applicant;
 *  - the super visa's own Forms-page items (host income, insurance, IME)
 *    depended on the free-form generator.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';
import '../src/modules/automation/portal-fills/canada-ircc-super-visa';
import { CA_ETA_VISAAI_ID, type PrefilledFormField } from '@visaai/types';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
import { portalForRoute } from '../src/strategies';
import {
  finalizeFields,
  type FinalizeContext,
} from '../src/modules/prefill/graphs/nodes/finalize-fields';

const TRV_ID = 'ca-visitor-visa-temporary-resident-visa';
const SV_ID = 'ca-super-visa';
const ETA_ID = CA_ETA_VISAAI_ID;

/** The mapping the app resolves for a route, exactly as the services do. */
function mappingFor(visaaiId: string) {
  const portalId = portalForRoute('CA', visaaiId)?.portalId;
  return resolvePortalFillFor(portalId!, visaaiId)!;
}

const PURPOSE_472 =
  'Visit children or grandchildren for more than 6 months (super visa)';

const value = (
  inputs: ReturnType<typeof buildMappingInputs>,
  key: string,
): unknown => inputs.find((m) => m.fieldKey === key)?.mappedValue;

const PARENT: Record<string, unknown> = {
  given_name: 'Muhammad',
  family_name: 'Khan',
  date_of_birth: '1958-03-09',
  nationality: 'PAK',
  country_of_residence: 'Pakistan',
  passport_number: 'AB1234567',
  purpose_of_visit: 'family visit',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2028-02-28',
  host_name: 'Ali Khan',
  inviter_status: 'Canadian citizen',
};

const form = (
  key: string,
  v: string,
  source: PrefilledFormField['source'],
): PrefilledFormField => ({
  key,
  label: key,
  value: v,
  group: 'Personal',
  source,
});

describe('route → mapping resolution', () => {
  it('each Canada route resolves its own mapping', () => {
    expect(portalForRoute('CA', TRV_ID)?.portalId).toBe('ircc');
    expect(portalForRoute('CA', SV_ID)?.portalId).toBe('ircc');
    expect(portalForRoute('CA', ETA_ID)?.portalId).toBe('ircc-eta');
    expect(mappingFor(TRV_ID)).toBe(resolvePortalFill('ircc'));
    expect(mappingFor(ETA_ID)).toBe(resolvePortalFill('ircc-eta'));
    expect(mappingFor(SV_ID)).not.toBe(resolvePortalFill('ircc'));
    expect(mappingFor(SV_ID)).not.toBe(resolvePortalFill('ircc-eta'));
  });

  it('the eTA mapping shares no page with tr-rt, and neither variant has eTA pages', () => {
    const pages = (m: ReturnType<typeof mappingFor>) =>
      new Set(m.map((f) => f.page));
    const eta = pages(mappingFor(ETA_ID));
    for (const id of [TRV_ID, SV_ID])
      for (const p of pages(mappingFor(id))) expect(eta.has(p)).toBe(false);
  });
});

describe('super visa purpose is always 472', () => {
  const sv = () => mappingFor(SV_ID);
  const purpose = (p: Record<string, unknown>) =>
    buildMappingInputs(sv(), p).filter((m) => m.page === '/purpose');

  it('even with a stored TRV purpose under the radio key and its aliases', () => {
    const inputs = purpose({
      ...PARENT,
      ircc_visa_purpose: 'Tourism',
      visa_purpose: 'Visit other family or friends',
      inviter_relationship: 'friend',
      purpose_of_visit: 'business meeting',
    });
    expect(value(inputs, 'ircc_applying_for')).toBe('Visitor visa');
    expect(value(inputs, 'ircc_visa_purpose')).toBe(PURPOSE_472);
    expect(
      inputs.find((m) => m.fieldKey === 'ircc_visa_purpose')?.targetField,
    ).toBe('#visaPurpose_radio-button-472-input');
  });

  it('even when a consultant typed another purpose on the saved form', () => {
    const q = applyPrefillOverrides(sv(), PARENT, [
      form('ircc_visa_purpose', 'Tourism', 'consultant'),
      form('visa_purpose', 'Business', 'applicant'),
    ]);
    expect(value(purpose(q), 'ircc_visa_purpose')).toBe(PURPOSE_472);
  });
});

describe('TRV purpose still derives from the host', () => {
  const trv = () => mappingFor(TRV_ID);
  it.each([
    [
      'son',
      'Canadian citizen',
      'Visit a grandparent, grandchild, sibling or adult child who is a Canadian citizen or permanent resident',
    ],
    [
      'wife',
      'permanent resident',
      'Visit a spouse, parent or dependent child who is a Canadian citizen or permanent resident',
    ],
    [
      'son',
      'work permit',
      'Visit a spouse, parent or dependent child who is in Canada temporarily',
    ],
    ['friend', 'Canadian citizen', 'Visit other family or friends'],
  ])('host %s, %s → %s', (rel, status, want) => {
    const inputs = buildMappingInputs(trv(), {
      ...PARENT,
      inviter_relationship: rel,
      inviter_status: status,
    });
    expect(value(inputs, 'ircc_visa_purpose')).toBe(want);
  });

  it('never answers 472 for a TRV', () => {
    const inputs = buildMappingInputs(trv(), {
      ...PARENT,
      inviter_relationship: 'son',
      ircc_visa_purpose: PURPOSE_472,
    });
    expect(value(inputs, 'ircc_visa_purpose')).not.toBe(PURPOSE_472);
  });
});

describe('eTA output is unchanged by TRV / super visa keys', () => {
  const ETA_PROFILE: Record<string, unknown> = {
    is_representative: false,
    passport_type: 'ordinary',
    nationality: 'GBR',
    passport_number: '123456789',
    family_name: 'Smith',
    given_name: 'Jane Mary',
    date_of_birth: '1960-05-01',
    sex: 'F',
    place_of_birth: 'Leeds, England',
    passport_issue_date: '2022-03-04',
    passport_expiry_date: '2032-03-03',
    email: 'jane@example.com',
    planned_entry_date: '2026-12-01',
  };
  const SUPER_AND_TRV_KEYS: Record<string, unknown> = {
    ircc_visa_purpose: PURPOSE_472,
    ircc_applying_for: 'Visitor visa',
    inviter_relationship: 'son',
    inviter_status: 'Canadian citizen',
    has_second_inviter: true,
    second_inviter_name: 'Sara Khan',
    has_super_visa_insurance: true,
    medical_insurance_coverage_cad: 150000,
    host_annual_income_cad: 95000,
    host_household_members: [{ name: 'Ali Khan' }],
    residence_since: '1988-09-16',
    ircc_residence_since: '1968-10-09',
  };

  it('same writes with or without them', () => {
    const eta = mappingFor(ETA_ID);
    expect(
      buildMappingInputs(eta, { ...ETA_PROFILE, ...SUPER_AND_TRV_KEYS }),
    ).toEqual(buildMappingInputs(eta, ETA_PROFILE));
  });

  it('same writes after a Forms page holding super visa answers', () => {
    const eta = mappingFor(ETA_ID);
    const q = applyPrefillOverrides(eta, ETA_PROFILE, [
      form('has_super_visa_insurance', 'Yes', 'applicant'),
      form('host_annual_income_cad', '95000', 'applicant'),
      form('residential_address_since', '1968-10-09', 'consultant'),
    ]);
    expect(buildMappingInputs(eta, q)).toEqual(
      buildMappingInputs(eta, ETA_PROFILE),
    );
  });
});

describe('residence row: a correction reaches the written dates AND the row summary', () => {
  const sv = () => mappingFor(SV_ID);
  const PROFILE = { ...PARENT, residence_since: '1988-09-16' };
  const row = (q: Record<string, unknown>) => {
    const inputs = buildMappingInputs(sv(), q);
    return {
      summary: value(inputs, 'ircc_residence_row'),
      year: inputs.find(
        (m) =>
          m.fieldKey === 'ircc_residence_since' && /Year/.test(m.targetField),
      )?.mappedValue,
    };
  };

  it('without a correction the profile date is used', () => {
    expect(row(PROFILE)).toEqual({
      summary: 'Pakistan — Citizen since 1988-09-16',
      year: '1988',
    });
  });

  it('a consultant edit of the row date (review list) also changes the summary', () => {
    const q = applyPrefillOverrides(sv(), PROFILE, [
      form('ircc_residence_since', '1968-10-09', 'consultant'),
    ]);
    expect(row(q)).toEqual({
      summary: 'Pakistan — Citizen since 1968-10-09',
      year: '1968',
    });
  });

  it.each(['residential_address_since', 'residential_address_from_date'])(
    'a person correcting %s on the Forms page outranks the profile',
    (key) => {
      for (const source of ['applicant', 'consultant'] as const) {
        const q = applyPrefillOverrides(sv(), PROFILE, [
          form(key, '1968-10-09', source),
        ]);
        expect(row(q)).toEqual({
          summary: 'Pakistan — Citizen since 1968-10-09',
          year: '1968',
        });
      }
    },
  );

  it.each(['09/10/1968', 'October 1968', '1968', '1968-13-45'])(
    'a person typing a date the row cannot read (%s) keeps the profile date',
    (typed) => {
      for (const id of [SV_ID, TRV_ID]) {
        for (const source of ['applicant', 'consultant'] as const) {
          const q = applyPrefillOverrides(mappingFor(id), PROFILE, [
            form('residential_address_from_date', typed, source),
          ]);
          expect(q.residence_since).toBe('1988-09-16');
          const inputs = buildMappingInputs(mappingFor(id), q);
          expect(value(inputs, 'ircc_residence_row')).toBe(
            'Pakistan — Citizen since 1988-09-16',
          );
          expect(
            inputs.filter((m) => m.fieldKey === 'ircc_residence_since'),
          ).toHaveLength(3);
        }
      }
    },
  );

  it('"since birth" typed by a person reads as the date of birth', () => {
    const q = applyPrefillOverrides(sv(), PROFILE, [
      form('residential_address_since', 'Since birth', 'applicant'),
    ]);
    expect(row(q)).toEqual({
      summary: 'Pakistan — Citizen since 1958-03-09',
      year: '1958',
    });
  });

  it('a generated copy on the form does not outrank the profile', () => {
    const q = applyPrefillOverrides(sv(), PROFILE, [
      form('residential_address_from_date', '1968-10-09', 'profile'),
      form('residential_address_since', '1968-10-09', 'inferred'),
    ]);
    expect(row(q).summary).toBe('Pakistan — Citizen since 1988-09-16');
  });

  it('only the residence date: other synonyms keep "the interview answer wins"', () => {
    const trv = mappingFor(TRV_ID);
    for (const source of ['applicant', 'consultant'] as const) {
      const q = applyPrefillOverrides(
        trv,
        { ...PARENT, refused_or_ordered_to_leave: 'No' },
        [
          form('visa_refusal_or_denial', 'Yes', source),
          form('purpose_of_trip', 'Business', source),
        ],
      );
      expect(q.refused_or_ordered_to_leave).toBe('No');
      expect(q.purpose_of_visit).toBe('family visit');
    }
  });
});

describe('second inviter', () => {
  const notes = (p: Record<string, unknown>, id = SV_ID) =>
    portalFillCoverage(mappingFor(id), p)
      .pages.find((pg) => pg.page === '/inviter-info')
      ?.left.filter((n) => /^Second inviter/.test(n.label)) ?? [];

  it('answering Yes lists only what VisaAI does not have about them', () => {
    for (const id of [SV_ID, TRV_ID]) {
      const left = notes(
        {
          ...PARENT,
          family_in_destination: true,
          has_second_inviter: true,
          second_inviter_name: 'Sara Khan',
          second_inviter_phone: '647-555-0101',
        },
        id,
      );
      expect(left).toHaveLength(1);
      expect(left[0]).toMatchObject({ reason: 'fill_yourself' });
      // Name and number are typed by the assistant (ircc-live-gaps-2);
      // relationship, address and phone type are the applicant's.
      expect(left[0].note).toMatch(/relationship/);
      expect(left[0].note).toMatch(/address/);
      expect(left[0].note).not.toMatch(/\bname\b/);
    }
  });

  it('no note when there is no second inviter', () => {
    expect(notes({ ...PARENT, has_second_inviter: false })).toEqual([]);
    expect(notes(PARENT)).toEqual([]);
  });
});

describe('Forms page: super visa items only on the super visa', () => {
  const ctx = (
    profile: Record<string, unknown>,
    visaaiId: string,
  ): FinalizeContext => ({
    applicantName: 'MUHAMMAD KHAN',
    profile,
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route: { country: 'CA', visaaiId },
  });
  const ANSWERS = {
    ...PARENT,
    host_annual_income_cad: 95000,
    host_income_tax_year: '2025',
    has_co_signer: 'No',
    has_super_visa_insurance: 'Yes',
    medical_insurance_provider: 'Manulife',
    medical_insurance_coverage_cad: 150000,
    medical_insurance_months: 12,
    medical_insurance_paid: 'Paid in full',
  };
  const keys = (visaaiId: string) =>
    finalizeFields([], ctx(ANSWERS, visaaiId)).map((f) => f.key);

  it('the super visa form carries host income and insurance answers', () => {
    expect(keys(SV_ID)).toEqual(
      expect.arrayContaining([
        'host_annual_income_cad',
        'host_income_tax_year',
        'has_co_signer',
        'has_super_visa_insurance',
        'medical_insurance_provider',
        'medical_insurance_coverage_cad',
        'medical_insurance_months',
        'medical_insurance_paid',
      ]),
    );
  });

  it('TRV and eTA forms do not', () => {
    for (const id of [TRV_ID, ETA_ID]) {
      const k = keys(id);
      expect(k).not.toContain('host_annual_income_cad');
      expect(k).not.toContain('has_super_visa_insurance');
      expect(k).not.toContain('medical_insurance_provider');
    }
  });

  it('the eTA form gets none of the TRV IRCC questions', () => {
    const trv = new Set(keys(TRV_ID));
    const eta = finalizeFields([], ctx(PARENT, ETA_ID)).map((f) => f.key);
    expect(
      eta.filter(
        (k) =>
          trv.has(k) &&
          /inviter|parent|child|spouse|occupation|biometrics/.test(k),
      ),
    ).toEqual([]);
  });

  it('a generator field with the same label is not duplicated', () => {
    const out = finalizeFields(
      [
        {
          key: 'insurer_company_name',
          label: 'Insurance company',
          value: 'Manulife',
          group: 'Insurance',
          source: 'profile',
        },
      ],
      ctx(ANSWERS, SV_ID),
    );
    expect(out.filter((f) => f.label === 'Insurance company')).toHaveLength(1);
  });

  it.each([
    [ETA_ID, 'passport_number', 'Passport number', 'X1'],
    [TRV_ID, 'passport_type', 'Passport type', 'Regular'],
  ])(
    '%s: an EMPTY generator field of the same label becomes the canonical answered field',
    (id, key, label, answer) => {
      const out = finalizeFields(
        [
          {
            key: 'applicant_generated_alias',
            label,
            value: '',
            group: 'Passport',
            source: 'inferred',
          },
        ],
        ctx({ ...PARENT, [key]: answer }, id),
      );
      const rows = out.filter((f) => f.label === label);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ key, value: answer });
    },
  );

  it('a same-label field a person cleared stays cleared', () => {
    const out = finalizeFields(
      [
        {
          key: 'applicant_generated_alias',
          label: 'Passport number',
          value: '',
          group: 'Passport',
          source: 'applicant',
        },
      ],
      ctx({ ...PARENT, passport_number: 'X1' }, ETA_ID),
    );
    const rows = out.filter((f) => f.label === 'Passport number');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'applicant_generated_alias',
      value: '',
    });
  });
});
