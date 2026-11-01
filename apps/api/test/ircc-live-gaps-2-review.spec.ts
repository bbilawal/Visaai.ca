/**
 * PR #182 review follow-ups: the second inviter is typed only when clearly
 * not the host (router misroute), funds currency keys, medical number
 * corrections behind the format gate, a Canadian refusal winning over "No" to
 * the general parts (TRV and eTA), children's countries of birth.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';
import '../src/modules/automation/portal-fills/canada-ircc-super-visa';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
import { routeSecondInviter } from '../src/modules/shared/profile/canonical-fact-keys';

type M = ReturnType<typeof resolvePortalFill> & object;
const trv = () => resolvePortalFill('ircc')!;
const sv = () => resolvePortalFillFor('ircc', 'ca-super-visa')!;
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
  inviter_relationship: 'son',
};

const on = (m: M, p: Record<string, unknown>, page: string) =>
  buildMappingInputs(m, p).filter((x) => x.page === page);
const val = (m: M, p: Record<string, unknown>, page: string, target: string) =>
  on(m, p, page).find((x) => x.targetField === target)?.mappedValue;
const left = (m: M, p: Record<string, unknown>, page: string) =>
  portalFillCoverage(m, p).pages.find((x) => x.page === page)?.left ?? [];

describe('S1: the second inviter is typed only when clearly not the host', () => {
  const HOST = {
    ...PARENT,
    host_name: 'Mian Muhammad Bilawal',
    inviter_phone: '905-226-5664',
    inviter_address: '1202 Stirling Todd Terrace, Milton, ON L9T 6Y7',
  };
  const typed = (p: Record<string, unknown>) =>
    on(sv(), p, '/inviter-info').filter((x) =>
      /secondInviter|InviterTwo/.test(x.targetField),
    );
  const note = (p: Record<string, unknown>) =>
    left(sv(), p, '/inviter-info').find((l) => l.label === 'Second inviter');

  it('the misroute: the host named again differently, same phone and house', () => {
    const routed = routeSecondInviter(
      HOST,
      {
        inviter_name: 'Bilawal Muzaffar',
        inviter_phone: '905-226-5664',
        inviter_address: '1202 Stirling Todd Terrace, Milton, ON L9T 6Y7',
        inviter_relationship: 'son',
      },
      'Is anyone else inviting you to Canada besides your primary inviter?',
    );
    expect(routed.second_inviter_source).toBe('router');
    const p: Record<string, unknown> = {
      ...HOST,
      ...routed,
      second_inviter_phone_type: 'cell',
    };
    expect(p.second_inviter_name).toBe('Bilawal Muzaffar');
    expect(typed(p)).toEqual([]);
    expect(note(p)?.note).toMatch(/could not confirm/);
    // Without the router's mark, the shared phone and address still stop it.
    const { second_inviter_source: _s, ...unmarked } = p;
    expect(typed(unmarked)).toEqual([]);
  });

  it.each([
    ['the host by a shorter name', { second_inviter_name: 'Bilawal' }],
    ["the host's email", { second_inviter_email: 'host@example.com' }],
  ])('nothing typed: %s', (_n, extra) => {
    const p = {
      ...HOST,
      inviter_email: 'host@example.com',
      has_second_inviter: true,
      second_inviter_name: 'Sara Ahmad',
      second_inviter_relationship: 'daughter-in-law',
      ...extra,
    };
    expect(typed(p)).toEqual([]);
    expect(note(p)).toBeDefined();
  });

  it('no name: nothing typed', () => {
    expect(
      typed({
        ...HOST,
        has_second_inviter: true,
        second_inviter_phone: '647-555-0101',
      }),
    ).toEqual([]);
  });

  it('(e) a number outside Canada and the U.S. goes in as "Other" with its code (live 2026-10-19)', () => {
    const p = {
      ...HOST,
      has_second_inviter: true,
      second_inviter_name: 'Sara Ahmad',
      second_inviter_relationship: 'daughter-in-law',
      second_inviter_phone: '+92 300 1234567',
      second_inviter_phone_type: 'cell',
    };
    const w = Object.fromEntries(
      typed(p).map((x) => [x.targetField, x.mappedValue]),
    );
    expect(w['#secondInviter_lastName_input']).toBeDefined();
    expect(w['#telLocation_phoneNumberInviterTwo_radio-button-02-input']).toBe(
      'Other',
    );
    expect(w['#telCountryCode_phoneNumberInviterTwo']).toBe('92');
    expect(w['#telNumber_phoneNumberInviterTwo']).toBe('3001234567');
    expect(note(p)?.note ?? '').not.toMatch(/telephone/);
  });
});

describe('S2: funds currency keys', () => {
  const at = (p: Record<string, unknown>) =>
    val(trv(), { ...PARENT, ...p }, '/finances', '#moneyDetails_input');
  it('a bare `currency` key is not the funds currency', () => {
    expect(
      at({ available_funds: 5000, funds_currency: 'PKR', currency: 'CAD' }),
    ).toBeUndefined();
    expect(at({ available_funds: 5000, currency: 'CAD' })).toBeUndefined();
    expect(at({ available_funds: 5000, available_funds_currency: 'CAD' })).toBe(
      '5000',
    );
  });
});

describe('S3: medical number corrections', () => {
  const BASE = {
    ...PARENT,
    medical_exam_last_12_months: 'Yes',
    medical_exam_number: 'AB11111111',
  };
  const at = (p: Record<string, unknown>) =>
    val(sv(), p, '/medical-background-questions', '#medicalNumber_input');

  it.each(['applicant', 'consultant'] as const)(
    "a %s's Forms correction under another name wins over the stale profile number",
    (source) => {
      const q = applyPrefillOverrides(sv(), BASE, [
        {
          key: 'medical_exam_reference_number',
          label: 'Medical exam reference number',
          value: 'ab 22222222',
          source,
        },
      ]);
      expect(at(q)).toBe('AB22222222');
    },
  );

  it('a corrected value still passes the format gate', () => {
    const q = applyPrefillOverrides(sv(), BASE, [
      {
        key: 'ime_number',
        label: 'IME number',
        value: '1234567890',
        source: 'applicant',
      },
    ]);
    expect(at(q)).toBeUndefined();
  });

  it("a raw value under the field's own key cannot bypass the gate", () => {
    expect(
      at({ ...BASE, ircc_medical_exam_number: '1234567890' }),
    ).toBeUndefined();
    expect(at({ ...BASE, ircc_medical_exam_number: 'U123456789' })).toBe(
      'U123456789',
    );
    const q = applyPrefillOverrides(sv(), BASE, [
      {
        key: 'ircc_medical_exam_number',
        label: 'IRCC medical exam — IME or UMI number',
        value: 'X-1',
        source: 'consultant',
      },
    ]);
    expect(at(q)).toBeUndefined();
  });
});

describe('S4: a Canadian refusal wins over "No" to the general parts', () => {
  const ALL_NO = {
    visa_refusal_history: false,
    denied_entry_history: false,
    ordered_to_leave_country: false,
  };
  it('TRV', () => {
    const target = (p: Record<string, unknown>) =>
      on(trv(), { ...PARENT, ...p }, '/validity-status').find(
        (x) => x.fieldKey === 'refused_or_ordered_to_leave',
      )?.targetField;
    expect(target({ ...ALL_NO, refused_by_canada: true })).toBe(
      '#refusedVisaInOtherCountry_radio-button-01-input',
    );
    expect(target(ALL_NO)).toBe(
      '#refusedVisaInOtherCountry_radio-button-02-input',
    );
  });
  it('eTA', () => {
    const f = eta().find(
      (x) => x.profileKey === 'refused_visa_or_denied_entry',
    )!;
    expect(f.derive!({ ...ALL_NO, canada_refusal: 'Yes' })).toBe('Yes');
    expect(f.derive!(ALL_NO)).toBe('No');
  });
});

describe("(f) children's countries of birth", () => {
  const kid = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    relationship: 'son',
    date_of_birth: '1989-10-14',
    ...extra,
  });
  const merged = (children: unknown[], value: string) =>
    applyPrefillOverrides(sv(), { ...PARENT, children }, [
      {
        key: 'children_countries_of_birth',
        label: 'Children: country of birth',
        value,
        source: 'applicant',
      },
    ]).children as Array<Record<string, unknown>>;

  it('one child lacking a country takes the one line, whatever the name says', () => {
    const out = merged(
      [
        kid('Sajawal Ahmad'),
        kid('Bilawal Ahmad', { country_of_birth: 'Pakistan' }),
      ],
      'Sajawal: Pakistan',
    );
    expect(out[0].country_of_birth).toBe('Pakistan');
  });

  it('a bare value applies to all only when it is a country', () => {
    expect(
      merged([kid('A B'), kid('C D')], 'Pakistan').map(
        (c) => c.country_of_birth,
      ),
    ).toEqual(['Pakistan', 'Pakistan']);
    for (const text of ['Both in Pakistan', 'Lahore'])
      expect(
        merged([kid('A B'), kid('C D')], text).map((c) => c.country_of_birth),
      ).toEqual([undefined, undefined]);
  });
});
