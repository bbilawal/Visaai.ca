/**
 * Live 2026-10-18 (draft 12556085): the second inviter's name, address and
 * phone filled, but IRCC also requires their relationship, phone type and
 * email — which VisaAI never asked. The Forms page (and the intake) now ask
 * them, and the IRCC fill writes them. The first inviter's three are asked
 * on the Forms page too.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';
import '../src/modules/automation/portal-fills/canada-ircc-super-visa';
import { CA_ETA_VISAAI_ID, intakeFactSpecs } from '@visaai/types';
import type { PrefilledFormField } from '@visaai/types';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
import {
  finalizeFields,
  type FinalizeContext,
} from '../src/modules/prefill/graphs/nodes/finalize-fields';

const sv = () => resolvePortalFillFor('ircc', 'ca-super-visa')!;
const trv = () => resolvePortalFill('ircc')!;
const eta = () => resolvePortalFill('ircc-eta')!;

const PARENT: Record<string, unknown> = {
  given_name: 'Muzaffar',
  family_name: 'Ahmad',
  date_of_birth: '1958-03-09',
  nationality: 'PAK',
  country_of_residence: 'Pakistan',
  passport_number: 'AB1234567',
  purpose_of_visit: 'family visit',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2028-02-28',
  host_name: 'Mian Muhammad Bilawal',
  inviter_relationship: 'son',
  inviter_phone: '905-226-5664',
  inviter_address: '1202 Stirling Todd Terrace, Milton, ON L9T 6Y7',
};
const SECOND = {
  ...PARENT,
  has_second_inviter: true,
  second_inviter_name: 'Mian Muhammad Sajawal',
  second_inviter_address: '1228 Turner Drive, Milton, ON L9T 5R6',
  second_inviter_phone: '647-819-8953',
};

const ctx = (
  profile: Record<string, unknown>,
  visaaiId = 'ca-super-visa',
): FinalizeContext => ({
  applicantName: 'MUZAFFAR AHMAD',
  profile,
  documentFields: {},
  documentFieldsByType: {},
  otherPartyDocuments: [],
  accountProfile: {},
  route: { country: 'CA', visaaiId },
});
const asked = (p: Record<string, unknown>, visaaiId?: string) =>
  finalizeFields([], ctx(p, visaaiId)).map((f) => f.key);
const at = (p: Record<string, unknown>, target: string) =>
  buildMappingInputs(sv(), p).find((x) => x.targetField === target)
    ?.mappedValue;

describe('Forms page asks what IRCC requires of the second inviter', () => {
  it.each(['ca-super-visa', 'ca-visitor-visa-temporary-resident-visa'])(
    '%s: relationship, phone type and email when a second inviter is declared',
    (id) => {
      expect(asked(SECOND, id)).toEqual(
        expect.arrayContaining([
          'second_inviter_relationship',
          'second_inviter_phone_type',
          'second_inviter_email',
        ]),
      );
    },
  );

  it('name, phone and address too when missing; none when already known', () => {
    const keys = asked({ ...PARENT, has_second_inviter: true });
    expect(keys).toEqual(
      expect.arrayContaining([
        'second_inviter_name',
        'second_inviter_address',
        'second_inviter_phone',
      ]),
    );
    const known = finalizeFields([], ctx(SECOND)).filter((f) =>
      /^second_inviter_(name|address|phone)$/.test(f.key),
    );
    expect(known.every((f) => f.value.trim() !== '')).toBe(true);
  });

  it('nothing about a second inviter without one, or on the eTA', () => {
    expect(
      asked({ ...PARENT, has_second_inviter: false }).filter((k) =>
        k.startsWith('second_inviter'),
      ),
    ).toEqual([]);
    expect(
      asked(SECOND, CA_ETA_VISAAI_ID).filter((k) => /inviter/.test(k)),
    ).toEqual([]);
  });

  it("the first inviter's relationship, phone type and email are asked too", () => {
    expect(asked({ ...PARENT, inviter_relationship: undefined })).toEqual(
      expect.arrayContaining([
        'inviter_relationship',
        'inviter_phone_type',
        'inviter_email',
      ]),
    );
  });
});

describe('the IRCC fill writes the Forms answers for inviter two', () => {
  const answered = (source: PrefilledFormField['source'] = 'applicant') =>
    applyPrefillOverrides(sv(), SECOND, [
      {
        key: 'second_inviter_relationship',
        label: 'r',
        value: 'Family member',
        source,
      },
      {
        key: 'second_inviter_phone_type',
        label: 't',
        value: 'Cellular',
        source,
      },
      {
        key: 'second_inviter_email',
        label: 'e',
        value: 'sajawal@example.com',
        source,
      },
    ]);

  it('relationship, phone type and email', () => {
    const q = answered();
    expect(at(q, '#relationInviterTwo_select')).toBe('Family member');
    expect(at(q, '#telType_phoneNumberInviterTwo_radio-button-02-input')).toBe(
      'Cellular',
    );
    expect(at(q, '#emailAddressInviterTwo_input')).toBe('sajawal@example.com');
    expect(
      portalFillCoverage(sv(), q)
        .pages.find((x) => x.page === '/inviter-info')
        ?.left.some((l) => l.label === 'Second inviter'),
    ).toBe(false);
  });

  it.each([
    ['son', 'Family member'],
    ['Friend', 'Friend'],
    ['Organization', 'Organization'],
  ])('relationship "%s" → %s', (rel, want) => {
    expect(
      at(
        { ...SECOND, second_inviter_relationship: rel },
        '#relationInviterTwo_select',
      ),
    ).toBe(want);
  });

  it('no stated relationship → none derived; listed with email and phone type', () => {
    expect(at(SECOND, '#relationInviterTwo_select')).toBeUndefined();
    const note = portalFillCoverage(sv(), SECOND)
      .pages.find((x) => x.page === '/inviter-info')
      ?.left.find((l) => l.label === 'Second inviter')?.note;
    expect(note).toMatch(/relationship to you/);
    expect(note).toMatch(/telephone type/);
    expect(note).toMatch(/email address/);
  });

  it("a consultant's review correction under the block's own key is used", () => {
    const q = applyPrefillOverrides(
      sv(),
      { ...SECOND, second_inviter_relationship: 'son' },
      [
        {
          key: 'ircc_second_inviter_relationship',
          label: 'Second inviter — relationship to you',
          value: 'Friend',
          source: 'consultant',
        },
      ],
    );
    expect(at(q, '#relationInviterTwo_select')).toBe('Friend');
  });
});

describe('first inviter', () => {
  it('relationship, phone type and email are written from the profile', () => {
    const p = {
      ...PARENT,
      inviter_phone_type: 'cell',
      inviter_email: 'bilawal@example.com',
    };
    const targets = buildMappingInputs(sv(), p).map((x) => x.targetField);
    expect(targets).toEqual(
      expect.arrayContaining([
        '#relationInviter_select',
        '#telType_phoneNumberInviter_radio-button-02-input',
        '#emailAddressInviter_input',
      ]),
    );
  });
});

describe('intake (TRV / business / super visa)', () => {
  it('asks the second inviter details only after a second inviter is declared', () => {
    const specs = intakeFactSpecs({ country: 'CA', visaaiId: 'ca-super-visa' });
    for (const key of [
      'second_inviter_relationship',
      'second_inviter_email',
      'second_inviter_phone_type',
    ]) {
      const s = specs.find((x) => x.key === key);
      expect(s?.when).toBe('has_second_inviter');
      expect(s?.form?.label).toMatch(/^Second inviter/);
    }
    expect(
      intakeFactSpecs({ country: 'CA', visaaiId: CA_ETA_VISAAI_ID }).some((s) =>
        s.key.startsWith('second_inviter'),
      ),
    ).toBe(false);
  });
});

describe('isolation', () => {
  it('super visa purpose stays 472; eTA has no inviter-two writes', () => {
    expect(
      buildMappingInputs(sv(), { ...SECOND, ircc_visa_purpose: 'Tourism' }).map(
        (x) => x.targetField,
      ),
    ).toContain('#visaPurpose_radio-button-472-input');
    expect(eta().some((f) => /InviterTwo|secondInviter/.test(f.selector))).toBe(
      false,
    );
    expect(trv().some((f) => /InviterTwo/.test(f.selector))).toBe(true);
  });
});
