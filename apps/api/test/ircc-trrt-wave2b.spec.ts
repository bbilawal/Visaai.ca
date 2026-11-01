/**
 * tr-rt coverage audit, wave 2b (2026-10-31): a school in Canada / the U.S. /
 * Mexico (matrix B A4), phone extension and extra phone rows (matrix C 61,
 * 62), a deceased child (C 35), the TB questions of an applicant aged 5 or
 * under (B 5), and "I don't know who my parents are" / a 3rd parent (C 37,
 * 47). The extension halts on the first missing selector, so only ids
 * recorded live are written; the rest become exact notes. Names are invented.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import { intakeFactSpecs, missingIntakeFacts } from '@visaai/types';
import { withoutUnaskedDeclarations } from '../src/modules/intake/graphs/nodes/required-facts';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  placePhone,
  splitPhoneExtension,
} from '../src/modules/automation/portal-fills/phone-numbers';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';

const trv = () => resolvePortalFill('ircc')!;
const TRV = { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' };

const BASE: Record<string, unknown> = {
  given_name: 'Nadeem',
  family_name: 'Qureshi',
  date_of_birth: '1975-06-02',
  nationality: 'PAK',
  country_of_residence: 'Pakistan',
  residential_address: {
    street: '14 Jail Road',
    city: 'Gujranwala',
    country: 'Pakistan',
  },
  passport_number: 'ZK1234567',
  purpose_of_visit: 'tourism',
  phone_number: '+92 300 7654321',
  phone_type: 'cell',
};

const all = (p: Record<string, unknown>) =>
  buildMappingInputs(trv(), { ...BASE, ...p });
const on = (p: Record<string, unknown>, page: string) =>
  all(p).filter((x) => x.page === page);
const left = (p: Record<string, unknown>, page: string) =>
  portalFillCoverage(trv(), { ...BASE, ...p }).pages.find((x) => x.page === page)
    ?.left ?? [];
const notes = (p: Record<string, unknown>, page: string) =>
  left(p, page)
    .map((l) => `${l.label}: ${l.note ?? ''}`)
    .join(' | ');
const missingKeys = (p: Record<string, unknown>) =>
  missingIntakeFacts({ ...BASE, ...p }, TRV).map((s) => s.key);

// ── 1. school in Canada / U.S. / Mexico — one street line: NOTE (rows: wave3b spec) ──
describe('A4: a school in Canada, the U.S. or Mexico', () => {
  const TORONTO = {
    school: 'Lakeshore Polytechnic',
    street_address: '88 Harbour Street',
    city: 'Toronto',
    province: 'ON',
    postal_code: 'M5J 2B1',
    country: 'Canada',
    from: '2001-09',
    to: '2004-06',
    level: "Bachelor's",
    field_of_study: 'Computer science',
  };
  const p = { has_post_secondary_education: 'yes', education_history: [TORONTO] };

  it('writes no education row and does not answer Yes without one', () => {
    expect(
      on(p, '/activities').filter((x) => x.fieldKey.startsWith('ircc_school_')),
    ).toEqual([]);
    expect(all(p).some((x) => /addressEducation/.test(x.targetField))).toBe(false);
  });

  it('the note names the school, level, field, dates and the full address', () => {
    const n = notes(p, '/activities');
    expect(n).toMatch(/Lakeshore Polytechnic/);
    expect(n).toMatch(/Bachelor's/);
    expect(n).toMatch(/Computer science/);
    expect(n).toMatch(/2001-09 to 2004-06/);
    expect(n).toMatch(/88 Harbour Street, Toronto, ON, M5J 2B1, Canada/);
    // One street line is never split into number + street (wave 3b).
    expect(n).toMatch(/street number and street name, each on its own/);
  });
});

// ── 2. phones ───────────────────────────────────────────────────────────────
describe('C61: a phone extension is never merged into the number', () => {
  it('splitPhoneExtension strips "ext 12", "x 45", "extension 678"', () => {
    expect(splitPhoneExtension('+1 905 226 5664 ext 12')).toEqual({
      number: '+1 905 226 5664',
      extension: '12',
    });
    expect(splitPhoneExtension('(905) 226-5664 x45')).toEqual({
      number: '(905) 226-5664',
      extension: '45',
    });
    expect(splitPhoneExtension('905-226-5664, extension 678').extension).toBe('678');
    expect(splitPhoneExtension('+92 300 7654321')).toEqual({ number: '+92 300 7654321' });
  });

  it('placePhone keeps only the number digits and carries the extension apart', () => {
    expect(placePhone('+1 905 226 5664 ext 12')).toEqual({
      location: 'Canada or the U.S.',
      number: '9052265664',
      extension: '12',
    });
    expect(placePhone('+92 42 3576 1234 ext. 7')).toEqual({
      location: 'Other',
      countryCode: '92',
      number: '4235761234',
      extension: '7',
    });
  });

  it('the TRV row writes the bare number; the extension goes to #telExt_telNumContactInfo', () => {
    const p = { phone_number: '+92 42 3576 1234 ext 12', phone_type: 'home' };
    const tel = on(p, '/contact-info-tel');
    const other = tel.filter((x) => x.fieldKey.startsWith('ircc_phone_number'));
    expect(other.map((x) => x.mappedValue)).toEqual(
      expect.arrayContaining(['4235761234', '92']),
    );
    expect(tel.find((x) => x.targetField === '#telExt_telNumContactInfo')?.mappedValue).toBe('12');
    expect(notes(p, '/contact-info-tel')).not.toMatch(/extension 12/i);
  });

  it('a separately recorded extension is written too', () => {
    const p = { phone_extension: '305' };
    expect(
      on(p, '/contact-info-tel').find((x) => x.targetField === '#telExt_telNumContactInfo')
        ?.mappedValue,
    ).toBe('305');
  });
});

describe('C62: additional phone rows through the same live dialog', () => {
  const p = {
    other_phone_numbers: [
      { number: '+92 55 3841122', type: 'home' },
      '+92 300 7654321', // the main number again: not a second row
    ],
  };

  it('a second number becomes a second row in #contactInfoTel_add_button', () => {
    const rows = on(p, '/contact-info-tel').filter((x) =>
      /_row$/.test(x.fieldKey),
    );
    expect(rows.map((x) => x.targetField)).toEqual([
      '#contactInfoTel_add_button',
      '#contactInfoTel_add_button',
    ]);
    const second = on(p, '/contact-info-tel').filter((x) =>
      x.fieldKey.startsWith('ircc_phone_2_'),
    );
    expect(second.map((x) => x.targetField)).toEqual(
      expect.arrayContaining([
        '#contactInfoTel_add_button',
        '#telType_telNumContactInfo_radio-button-01-input',
        '#telCountryCode_telNumContactInfo',
        '#telNumber_telNumContactInfo',
      ]),
    );
    expect(second.map((x) => x.mappedValue)).toEqual(
      expect.arrayContaining(['553841122', '92']),
    );
    expect(
      on(p, '/contact-info-tel').some((x) => x.fieldKey.startsWith('ircc_phone_3_')),
    ).toBe(false);
  });

  it('a number without its type is a note, never a row', () => {
    const q = { other_phone_numbers: ['+92 55 3841122'] };
    expect(
      on(q, '/contact-info-tel').some((x) => x.fieldKey.startsWith('ircc_phone_2_')),
    ).toBe(false);
    expect(notes(q, '/contact-info-tel')).toMatch(/\+92 55 3841122/);
  });

  it('the intake asks for another number on tr-rt and takes "none"', () => {
    expect(missingKeys({})).toContain('other_phone_numbers');
    expect(missingKeys({ other_phone_numbers: [] })).not.toContain('other_phone_numbers');
  });
});

// ── 3. deceased child ───────────────────────────────────────────────────────
describe('C35: a child who has died', () => {
  const KIDS = [
    {
      name: 'Hina Qureshi',
      relationship: 'daughter',
      date_of_birth: '2001-03-04',
      country_of_birth: 'Pakistan',
      same_address: true,
      coming_to_canada: false,
    },
    {
      name: 'Bilal Qureshi',
      relationship: 'son',
      date_of_birth: '2004-08-19',
      country_of_birth: 'Pakistan',
    },
  ];

  it('the intake asks whether any child has died, only when there are children', () => {
    expect(missingKeys({ has_children: 'yes', children: KIDS })).toContain(
      'children_deceased',
    );
    expect(missingKeys({ has_children: 'no', children: [] })).not.toContain(
      'children_deceased',
    );
    expect(
      missingKeys({ has_children: 'yes', children: KIDS, children_deceased: [] }),
    ).not.toContain('children_deceased');
  });

  it('a deceased child row is written with the box ticked and without the fields it hides', () => {
    const p = {
      has_children: 'yes',
      children: KIDS,
      children_deceased: ['Bilal Qureshi'],
    };
    const second = on(p, '/family-info-children').filter((x) =>
      x.fieldKey.startsWith('ircc_child_2_'),
    );
    expect(second.map((x) => x.targetField)).toEqual(
      expect.arrayContaining([
        '#lastName_input',
        '#firstName_input',
        '#firstChildIsDeceased_chk-input',
        '#relationshipChild_select',
        '#countryOfBirthChild_select',
      ]),
    );
    expect(second.some((x) => /hasSameAddress|childComingCanada|childInfoAddress/.test(x.targetField))).toBe(false);
    // The living child is unchanged.
    const first = on(p, '/family-info-children').filter((x) => x.fieldKey.startsWith('ircc_child_1_'));
    expect(first.some((x) => /hasSameAddress/.test(x.targetField))).toBe(true);
    expect(first.some((x) => x.targetField === '#firstChildIsDeceased_chk-input')).toBe(false);
    expect(notes(p, '/family-info-children')).not.toMatch(/Bilal Qureshi/);
  });

  it('deceased on the child itself is written the same', () => {
    const p = {
      has_children: 'yes',
      children: [KIDS[0], { ...KIDS[1], deceased: true }],
    };
    expect(
      on(p, '/family-info-children').some(
        (x) => x.fieldKey.startsWith('ircc_child_2_') && x.targetField === '#firstChildIsDeceased_chk-input',
      ),
    ).toBe(true);
  });
});

// ── 4. TB, applicant aged 5 or under — NOTE-GATED ───────────────────────────
describe('B5: the 2-year TB questions of an applicant aged 5 or under', () => {
  const year = new Date().getUTCFullYear();
  const toddler = { date_of_birth: `${year - 3}-01-15` };

  it('the intake asks the 2-year question of a young applicant only', () => {
    expect(missingKeys(toddler)).toContain('tuberculosis_contact_two_years');
    expect(missingKeys({})).not.toContain('tuberculosis_contact_two_years');
  });

  it('a birth year alone counts when there is no date of birth', () => {
    expect(missingKeys({ date_of_birth: undefined, birth_year: year - 4 })).toContain(
      'tuberculosis_contact_two_years',
    );
    expect(missingKeys({ date_of_birth: undefined, birth_year: year - 9 })).not.toContain(
      'tuberculosis_contact_two_years',
    );
  });

  it('with only a birth year the 5-year question is not written to a page that may lack it', () => {
    const p = { date_of_birth: undefined, birth_year: year - 4, tuberculosis_contact: 'no' };
    expect(all(p).some((x) => /contactFiveYears/.test(x.targetField))).toBe(false);
  });

  it('its follow-ups chain on explicit Yes answers', () => {
    const k = missingKeys({ ...toddler, tuberculosis_contact_two_years: 'yes' });
    expect(k).toContain('tuberculosis_tested_two_years');
    expect(k).not.toContain('tuberculosis_test_positive_two_years');
    const k2 = missingKeys({
      ...toddler,
      tuberculosis_contact_two_years: 'yes',
      tuberculosis_tested_two_years: 'yes',
      tuberculosis_test_positive_two_years: 'yes',
    });
    expect(k2).toContain('tuberculosis_positive_treated_two_years');
  });

  it('a child surely 5 or under: the chain is written (ids live 2026-10-31, wave 3c)', () => {
    const p = {
      ...toddler,
      tuberculosis_contact_two_years: 'yes',
      tuberculosis_tested_two_years: 'no',
    };
    const tb = on(p, '/medical-tuberculosis').map((x) => x.targetField);
    expect(tb).toContain('#contactTwoYears_radio-button-01-input');
    expect(tb).toContain('#hasTestTwoYears_radio-button-02-input');
    expect(tb.some((x) => /contactFiveYears/.test(x))).toBe(false);
  });

  it('an unanswered 2-year question is never guessed', () => {
    const n = notes(toddler, '/medical-tuberculosis');
    expect(n).not.toMatch(/last 2 years: (Yes|No)/);
  });
});

// ── 5. parents edge cases ───────────────────────────────────────────────────
describe('C37/C47: parents unknown, and a 3rd parent', () => {
  it('"I don\'t know who my parents are" is asked only when no parent is listed', () => {
    expect(missingKeys({})).toContain('parents_unknown');
    expect(
      missingKeys({ parents: [{ name: 'Rashid Qureshi', relationship: 'father' }] }),
    ).not.toContain('parents_unknown');
  });

  it('an explicit Yes satisfies the parents question and ticks #declaringParents_chk-input', () => {
    const p = { parents_unknown: 'yes' };
    expect(missingKeys(p)).not.toContain('parents');
    const par = on(p, '/family-info-parents');
    expect(par.find((x) => x.fieldKey === 'parents_unknown')?.targetField).toBe(
      '#declaringParents_chk-input',
    );
    expect(par.some((x) => x.targetField === '#parentInfoGrid_add_button')).toBe(false);
  });

  it('never ticked without an explicit answer, or when parents are listed', () => {
    expect(on({}, '/family-info-parents').some((x) => x.fieldKey === 'parents_unknown')).toBe(false);
    expect(
      on(
        { parents_unknown: 'no' },
        '/family-info-parents',
      ).some((x) => x.fieldKey === 'parents_unknown'),
    ).toBe(false);
    const both = {
      parents_unknown: 'yes',
      parents: [{ name: 'Rashid Qureshi', relationship: 'father' }],
    };
    expect(on(both, '/family-info-parents').some((x) => x.fieldKey === 'parents_unknown')).toBe(false);
  });

  const TRV_STATE = {
    destinationCountry: 'CA',
    requirementsJson: { visaai_id: 'ca-visitor-visa-temporary-resident-visa' },
  };
  const question = (key: string) =>
    intakeFactSpecs(TRV).find((s) => s.key === key)!.question;

  it('a reply to the main parents question never records parents_unknown', () => {
    // "I don't know my parents' dates" is not "I don't know who they are".
    const out = withoutUnaskedDeclarations(
      { ...TRV_STATE, currentQuestion: question('parents') },
      { parents_unknown: 'yes' },
    );
    expect(out).toEqual({});
  });

  it('kept only from the dedicated question', () => {
    const out = withoutUnaskedDeclarations(
      { ...TRV_STATE, currentQuestion: question('parents_unknown') },
      { parents_unknown: 'yes' },
    );
    expect(out).toEqual({ parents_unknown: 'yes' });
    expect(
      withoutUnaskedDeclarations(
        { ...TRV_STATE, currentQuestion: 'Do you know who your parents are?' },
        { parents_unknown: 'no' },
      ),
    ).toEqual({ parents_unknown: 'no' });
  });

  it('listed parents with gaps are still asked, whatever parents_unknown says', () => {
    const p = {
      parents_unknown: 'yes',
      parents: [{ name: 'Rashid Qureshi', relationship: 'father', deceased: true }],
    };
    expect(missingKeys(p)).toContain('parents');
    expect(on(p, '/family-info-parents').some((x) => x.targetField === '#declaringParents_chk-input')).toBe(false);
  });

  it('a 3rd parent is noted, not silently dropped', () => {
    const P = (name: string, relationship: string) => ({
      name,
      relationship,
      date_of_birth: '1950-01-01',
      country_of_birth: 'Pakistan',
      occupation: 'Retired',
      same_address: true,
      coming_to_canada: false,
    });
    const p = {
      parents: [
        P('Rashid Qureshi', 'father'),
        P('Amna Qureshi', 'mother'),
        P('Saima Qureshi', 'step-mother'),
      ],
    };
    expect(notes(p, '/family-info-parents')).toMatch(/Saima Qureshi/);
  });
});
