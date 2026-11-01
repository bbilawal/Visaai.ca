/**
 * tr-rt wave 3b (live probe 2026-10-31 on a throwaway tr-rt draft):
 *  1. Divorced / Separated / Annulled reveal the same former-spouse block as
 *     Widowed — marriage date (full), names, DOB ("Unknown" month/day
 *     allowed), country of birth, end date (full).
 *  2. A deceased child: the box hides hasSameAddress + childComingCanada, no
 *     date of death; the row is written.
 *  3. A deceased parent: the box reveals dateOfDeath (full) and hides
 *     parentOccupation_input, addressParent, parentComingCanada.
 *  4. The phone dialog's extension: #telExt_telNumContactInfo.
 *  5. A school in Canada / the U.S. / Mexico: the manual-entry form.
 * Names are invented.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import type { PrefilledFormField } from '@visaai/types';
import { missingIntakeFacts } from '@visaai/types';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import {
  finalizeFields,
  type FinalizeContext,
} from '../src/modules/prefill/graphs/nodes/finalize-fields';

const trv = () => resolvePortalFill('ircc')!;
const TRV = { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' };

const BASE: Record<string, unknown> = {
  given_name: 'Farhan',
  family_name: 'Siddiqui',
  date_of_birth: '1972-04-09',
  nationality: 'PAK',
  country_of_residence: 'Pakistan',
  residential_address: { street: '9 Mall Road', city: 'Multan', country: 'Pakistan' },
  passport_number: 'QA7654321',
  purpose_of_visit: 'tourism',
  phone_number: '+92 300 1112233',
  phone_type: 'cell',
};

const values = (p: Record<string, unknown>) =>
  applyPrefillOverrides(trv(), { ...BASE, ...p }, []);
const all = (p: Record<string, unknown>) => buildMappingInputs(trv(), values(p));
const on = (p: Record<string, unknown>, page: string) =>
  all(p).filter((x) => x.page === page);
const val = (p: Record<string, unknown>, page: string, target: string) =>
  on(p, page).find((x) => x.targetField === target)?.mappedValue;
const notes = (p: Record<string, unknown>, page: string) =>
  (portalFillCoverage(trv(), values(p)).pages.find((x) => x.page === page)?.left ?? [])
    .map((l) => `${l.label}: ${l.note ?? ''}`)
    .join(' | ');
const missing = (p: Record<string, unknown>) =>
  missingIntakeFacts({ ...BASE, ...p }, TRV).map((s) => s.key);

const FAM = '/family-info';

// ── 1. former spouse ────────────────────────────────────────────────────────
describe('1. Divorced / Separated / Annulled: the former spouse block', () => {
  const FULL = {
    marriage_end_date: '2018-05-20',
    previous_marriage_date: '2008-11-02',
    previous_spouse_name: 'Sadia Rehman',
    previous_spouse_date_of_birth: '1980-07-15',
    previous_spouse_country_of_birth: 'Pakistan',
  };

  it.each(['Divorced', 'Separated', 'Annulled'])('%s: every revealed field is written', (m) => {
    const p = { marital_status: m, ...FULL };
    expect(val(p, FAM, '#dateOfDatingYear_sltDateYear')).toBe('2008');
    expect(val(p, FAM, '#dateOfDatingDay_sltDateDay')).toBe('2');
    expect(val(p, FAM, '#lastName_input')).toBe('Rehman');
    expect(val(p, FAM, '#firstName_input')).toBe('Sadia');
    expect(val(p, FAM, '#dateOfBirthPartnerYear_sltDateYear')).toBe('1980');
    expect(val(p, FAM, '#countryOfBirthPartner_select')).toBeDefined();
    expect(val(p, FAM, '#endDatePartnerYear_sltDateYear')).toBe('2018');
    // Never the living-spouse questions the status does not show.
    expect(on(p, FAM).some((x) => /partnerOccupation|commonAddressFamily|partnerComingCanada|partnerInfoAddress/.test(x.targetField))).toBe(false);
    expect(notes(p, FAM)).not.toMatch(/Former or late spouse/);
  });

  it('a DOB known only to the year uses the "Unknown" month and day', () => {
    const p = { marital_status: 'Divorced', ...FULL, previous_spouse_date_of_birth: '1980' };
    expect(val(p, FAM, '#dateOfBirthPartnerYear_sltDateYear')).toBe('1980');
    expect(val(p, FAM, '#dateOfBirthPartnerMonth_sltDateMonth')).toBe('Unknown');
    expect(val(p, FAM, '#dateOfBirthPartnerDay_sltDateDay')).toBe('Unknown');
  });

  it('a marriage or end date without the day is never written; the note says so', () => {
    const p = {
      marital_status: 'Separated',
      ...FULL,
      previous_marriage_date: '2008',
      marriage_end_date: '2018-05',
    };
    expect(on(p, FAM).some((x) => /dateOfDating|endDatePartner/.test(x.targetField))).toBe(false);
    const n = notes(p, FAM);
    expect(n).toMatch(/full date of the marriage or relationship/);
    expect(n).toMatch(/full date the marriage or relationship ended/);
  });

  it('intake asks the block of a divorced applicant; a DOB question allows the year alone', () => {
    const m = missing({ marital_status: 'Divorced' });
    expect(m).toEqual(
      expect.arrayContaining([
        'marriage_end_date',
        'previous_marriage_date',
        'previous_spouse_name',
        'previous_spouse_date_of_birth',
        'previous_spouse_country_of_birth',
      ]),
    );
    expect(missing({ marital_status: 'Divorced', ...FULL })).not.toContain('previous_spouse_name');
  });

  it('remarried (Married) writes only the current spouse', () => {
    const p = {
      marital_status: 'Married',
      spouse_name: 'Hira Siddiqui',
      date_of_marriage: '2020-01-10',
      previous_spouse_name: 'Sadia Rehman',
      previous_marriage_date: '2008-11-02',
      previous_spouse_date_of_birth: '1980-07-15',
      marriage_end_date: '2018-05-20',
    };
    expect(val(p, FAM, '#lastName_input')).toBe('Siddiqui');
    expect(val(p, FAM, '#dateOfDatingYear_sltDateYear')).toBe('2020');
    expect(on(p, FAM).some((x) => /endDatePartner/.test(x.targetField))).toBe(false);
    expect(missing({ marital_status: 'Married' })).not.toContain('previous_spouse_name');
  });

  it('Forms page (step 13): a divorced applicant is asked, and the answers reach the mapping', () => {
    const ctx: FinalizeContext = {
      applicantName: 'FARHAN SIDDIQUI',
      profile: {},
      documentFields: {},
      documentFieldsByType: {},
      otherPartyDocuments: [],
      accountProfile: {},
      route: TRV,
    };
    const gen: PrefilledFormField[] = [
      { key: 'family_name', label: 'family_name', value: 'SIDDIQUI', group: 'Personal', source: 'profile' },
      { key: 'marital_status', label: 'marital_status', value: 'Divorced', group: 'Family', source: 'profile' },
    ];
    const out = finalizeFields(gen, ctx);
    const set = (k: string, v: string) => {
      out.find((f) => f.key === k)!.value = v;
    };
    set('previous_marriage_date', '2008-11-02');
    set('previous_spouse_name', 'Sadia Rehman');
    set('previous_spouse_date_of_birth', '1980');
    set('previous_spouse_country_of_birth', 'Pakistan');
    const profile = {
      ...Object.fromEntries(out.map((f) => [f.key, f.value])),
      marriage_end_date: '2018-05-20',
    };
    expect(val(profile, FAM, '#lastName_input')).toBe('Rehman');
    expect(val(profile, FAM, '#dateOfDatingYear_sltDateYear')).toBe('2008');
    expect(val(profile, FAM, '#dateOfBirthPartnerMonth_sltDateMonth')).toBe('Unknown');
  });
});

// ── 2. deceased child ───────────────────────────────────────────────────────
describe('2. a deceased child row (live: saved with a year-only DOB)', () => {
  const p = {
    has_children: 'yes',
    children: [
      { name: 'Usman Siddiqui', relationship: 'son', birth_year: 2010, country_of_birth: 'Pakistan', deceased: true },
    ],
  };

  it('writes names, DOB with Unknown parts, the ticked box, relationship and country only', () => {
    const kid = on(p, '/family-info-children').filter((x) => x.fieldKey.startsWith('ircc_child_1_'));
    const t = kid.map((x) => x.targetField);
    expect(t).toEqual(
      expect.arrayContaining([
        '#lastName_input',
        '#firstName_input',
        '#dateOfBirthChildYear_sltDateYear',
        '#firstChildIsDeceased_chk-input',
        '#relationshipChild_select',
        '#countryOfBirthChild_select',
      ]),
    );
    expect(t.some((x) => /hasSameAddress|childComingCanada|childInfoAddress|dateOfDeath/.test(x))).toBe(false);
    expect(kid.find((x) => x.targetField === '#dateOfBirthChildMonth_sltDateMonth')?.mappedValue).toBe('Unknown');
    expect(val(p, '/family-info-children', '#hasChild_radio-button-01-input')).toBeDefined();
    expect(notes(p, '/family-info-children')).toBe('');
  });
});

// ── 3. deceased parent ──────────────────────────────────────────────────────
describe('3. a deceased parent: never the fields the box hides', () => {
  const FATHER = {
    name: 'Aslam Siddiqui',
    relationship: 'father',
    date_of_birth: '1940-02-02',
    country_of_birth: 'Pakistan',
    deceased: true,
    date_of_death: '2015-09-30',
    // Stale answers that must not be written once the box is ticked.
    occupation: 'Farmer',
    same_address: false,
    address: '3 Canal Road, Multan, Pakistan',
    coming_to_canada: false,
  };
  const MOTHER = {
    name: 'Zainab Siddiqui',
    relationship: 'mother',
    date_of_birth: '1948-03-03',
    country_of_birth: 'Pakistan',
    occupation: 'Homemaker',
    same_address: true,
    coming_to_canada: false,
  };
  const p = { parents: [FATHER, MOTHER] };
  const row = (n: number) =>
    on(p, '/family-info-parents').filter((x) => x.fieldKey.startsWith(`ircc_parent_${n}_`));

  it('writes the box and the full date of death; no occupation, address or coming', () => {
    const t = row(1).map((x) => x.targetField);
    expect(t).toEqual(
      expect.arrayContaining(['#isDeathParent_chk-input', '#dateOfDeathYear_sltDateYear', '#dateOfDeathDay_sltDateDay']),
    );
    expect(t.some((x) => /parentOccupation_input|addressParent|parentComingCanada|_residentialAddress/.test(x))).toBe(false);
  });

  it('the living parent keeps every field and no death fields', () => {
    const t = row(2).map((x) => x.targetField);
    expect(t).toEqual(expect.arrayContaining(['#parentOccupation_input', '#parentComingCanada_radio-button-02-input']));
    expect(t.some((x) => /isDeathParent|dateOfDeath/.test(x))).toBe(false);
  });

  it('a year-only date of death is not written (no "Unknown" there); the row is left with a note', () => {
    const q = { parents: [{ ...FATHER, date_of_death: '2015' }, MOTHER] };
    expect(on(q, '/family-info-parents').some((x) => x.fieldKey.startsWith('ircc_parent_1_'))).toBe(false);
    expect(notes(q, '/family-info-parents')).toMatch(/full date of death/);
  });
});

// ── 4. phone extension ──────────────────────────────────────────────────────
describe('4. the extension goes to #telExt_telNumContactInfo', () => {
  const EXT = '#telExt_telNumContactInfo';
  const tel = (p: Record<string, unknown>) => on(p, '/contact-info-tel');

  it('the main row: "ext 45" kept apart from the number', () => {
    const p = { phone_number: '+92 61 4512345 ext 45', phone_type: 'home' };
    expect(tel(p).find((x) => x.fieldKey === 'ircc_phone_extension')?.mappedValue).toBe('45');
    expect(tel(p).find((x) => x.targetField === '#telNumber_telNumContactInfo' && x.fieldKey.startsWith('ircc_phone_number'))?.mappedValue).toBe('614512345');
  });

  it('an extra row writes its own extension, after its number', () => {
    const p = { other_phone_numbers: [{ number: '+92 61 4599999 x 7', type: 'work' }] };
    const second = tel(p).filter((x) => x.fieldKey.startsWith('ircc_phone_2_'));
    expect(second.find((x) => x.targetField === EXT)?.mappedValue).toBe('7');
    const ix = (t: string) => second.findIndex((x) => x.targetField === t);
    expect(ix(EXT)).toBeGreaterThan(ix('#telNumber_telNumContactInfo'));
    expect(tel(p).filter((x) => x.fieldKey.startsWith('ircc_phone_') && !x.fieldKey.startsWith('ircc_phone_2_') && x.targetField === EXT)).toEqual([]);
    expect(notes(p, '/contact-info-tel')).not.toMatch(/extension/i);
  });

  it('no extension: nothing written to the box', () => {
    expect(tel({}).some((x) => x.targetField === EXT)).toBe(false);
  });

  it('the representative and inviter phones are untouched', () => {
    expect(all({ phone_extension: '9' }).filter((x) => x.targetField === EXT)).toHaveLength(1);
  });
});

// ── 5. school in Canada / U.S. / Mexico ─────────────────────────────────────
describe('5. a North American school through the manual-entry form', () => {
  const ACT = '/activities';
  const SCHOOL = {
    school: 'Riverside Institute',
    from: '1992-09',
    to: '1996-06',
    level: "Bachelor's",
    field_of_study: 'Business',
    street_number: '120',
    street_name: 'King Street West',
    city: 'Toronto',
    province: 'ON',
    country: 'Canada',
  };
  const edu = (school: Record<string, unknown>) => ({
    has_post_secondary_education: 'yes',
    education_history: [school],
  });
  const row = (p: Record<string, unknown>) =>
    on(p, ACT).filter((x) => x.fieldKey.startsWith('ircc_school_1_'));
  const v = (p: Record<string, unknown>, t: string) =>
    row(p).find((x) => x.targetField === t)?.mappedValue;

  it('Canada: manual box, number, street, apartment, city, province; no street line, no postal code', () => {
    const p = edu({ ...SCHOOL, apartment: '4B', postal_code: 'M5H 1J9' });
    expect(row(p).map((x) => x.targetField)).toEqual(
      expect.arrayContaining([
        '#country_addressEducation',
        '#manualEntryaddress_addressEducation-input',
        '#streetNum_addressEducation',
        '#street_addressEducation',
        '#apartmentNumber_addressEducation',
        '#city_addressEducation',
        '#province_addressEducation',
      ]),
    );
    expect(v(p, '#streetNum_addressEducation')).toBe('120');
    expect(v(p, '#street_addressEducation')).toBe('King Street West');
    expect(v(p, '#apartmentNumber_addressEducation')).toBe('4B');
    expect(v(p, '#province_addressEducation')).toBe('Ontario');
    expect(row(p).some((x) => /streetAddress_|postalcode|state_|mexicoState/.test(x.targetField))).toBe(false);
    // The box is ticked before the parts it reveals.
    const ix = (t: string) => row(p).findIndex((x) => x.targetField === t);
    expect(ix('#manualEntryaddress_addressEducation-input')).toBeLessThan(ix('#streetNum_addressEducation'));
  });

  it('U.S.: the state list, no province', () => {
    const p = edu({ ...SCHOOL, city: 'Boston', province: undefined, state: 'MA', country: 'United States' });
    expect(v(p, '#state_addressEducation')).toBe('Massachusetts');
    expect(row(p).some((x) => /province_|mexicoState|zipcode/.test(x.targetField))).toBe(false);
  });

  it('Mexico: the typed state', () => {
    const p = edu({ ...SCHOOL, city: 'Monterrey', province: undefined, state: 'Nuevo León', country: 'Mexico' });
    expect(v(p, '#mexicoState_addressEducation')).toBe('Nuevo León');
    expect(row(p).some((x) => /province_|state_addressEducation/.test(x.targetField))).toBe(false);
  });

  it('one street line is never split: no row, the note asks for the parts', () => {
    const p = edu({ ...SCHOOL, street_number: undefined, street_name: undefined, street_address: '120 King Street West' });
    expect(row(p)).toEqual([]);
    expect(notes(p, ACT)).toMatch(/street number and street name, each on its own/);
  });

  it('without the province: no row, noted', () => {
    const p = edu({ ...SCHOOL, province: undefined });
    expect(row(p)).toEqual([]);
    expect(notes(p, ACT)).toMatch(/the province/);
  });

  it('any other country keeps the single street line', () => {
    const p = edu({ ...SCHOOL, street_address: '1 Campus Road', city: 'Lahore', country: 'Pakistan', province: undefined });
    expect(v(p, '#streetAddress_addressEducation')).toBe('1 Campus Road');
    expect(row(p).some((x) => /manualEntry|streetNum_|street_addressEducation/.test(x.targetField))).toBe(false);
  });
});
