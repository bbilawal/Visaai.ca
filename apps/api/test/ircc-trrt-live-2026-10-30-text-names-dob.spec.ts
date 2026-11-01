/**
 * Live tr-rt fill 2026-10-30, three more findings:
 *  1. /validity-status: "Only characters from the Roman script/alphabet can be
 *     entered on this field" — the refusal details held "B1/B2"; "/" is
 *     refused, ": ( ) . - ," and digits are accepted.
 *  2. /other-names wrote "Previous name — Ali / Chaudhary Zeeshan", the
 *     applicant's own current name.
 *  3. /family-info-parents: a parent born "1960" had the year written, then
 *     the "Unknown" month stopped the run with value_mismatch.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-business-visitor';
import {
  applyFillTransform,
  irccRomanText,
} from '../src/modules/automation/fill-transforms';
import {
  applyPrefillOverrides,
  buildMappingInputs,
} from '../src/modules/automation/fill-instructions';
import {
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';

const ircc = () => resolvePortalFill('ircc')!;
const BASE: Record<string, unknown> = {
  given_name: 'Chaudhary Zeeshan',
  family_name: 'Ali',
  date_of_birth: '1985-01-02',
  nationality: 'PAK',
  passport_number: 'AB1234567',
  purpose_of_visit: 'Tourism',
  planned_entry_date: '2027-06-01',
  planned_departure_date: '2027-06-08',
  family_in_destination: 'No',
};
const mapped = (p: Record<string, unknown>, m = ircc()) =>
  buildMappingInputs(m, applyPrefillOverrides(m, { ...BASE, ...p }, []));
const at = (p: Record<string, unknown>, selector: string, m = ircc()) =>
  mapped(p, m).filter((x) => x.targetField === selector);

describe('1. free text IRCC accepts (Roman script, no "/")', () => {
  it.each([
    ['B1/B2', 'B1 or B2'],
    ['refused 10/2023', 'refused 10-2023'],
    ['US B1 / B2 visa refused on 12/05/2019', 'US B1 or B2 visa refused on 12-05-2019'],
    ['Refused: section 214(b), Jan. 2020 - USA', 'Refused: section 214(b), Jan. 2020 - USA'],
    ['Visa “refused” – 2019', 'Visa "refused" - 2019'],
    ['Café owner', 'Café owner'],
    ['Łódź trip', 'Lódz trip'],
    ['Kraków / Gdańsk', 'Kraków or Gdansk'],
    ['Back\\slash and | pipe', 'Back slash and pipe'],
  ])('"%s" → "%s"', (raw, want) => {
    expect(irccRomanText(raw)).toBe(want);
    expect(applyFillTransform('ircc_text', raw)).toBe(want);
  });

  it('nothing left writes nothing', () => {
    expect(applyFillTransform('ircc_text', '///')).toBeNull();
  });

  const REFUSED = {
    previous_visa_refused: 'Yes',
    refusal_details: 'USA B1/B2 visa refused 10/2023',
  };
  const REFUSAL_BOX = '#refusedVisaInOtherCountryDetails_txtArea';

  it('the refusal details box gets the sanitized text', () => {
    const w = at(REFUSED, REFUSAL_BOX);
    expect(w).toHaveLength(1);
    expect(w[0].mappedValue).toBe('USA B1 or B2 visa refused 10-2023');
  });

  it('the business-visitor variant sanitizes the same box', () => {
    const bv = resolvePortalFillFor('ircc', 'ca-business-visitors')!;
    expect(at(REFUSED, REFUSAL_BOX, bv)[0]?.mappedValue).toBe(
      'USA B1 or B2 visa refused 10-2023',
    );
  });

  it('every tr-rt textarea and free-text box carries the sanitizer', () => {
    const free = ircc().filter(
      (f) =>
        f.action === 'fill' &&
        !f.op &&
        (/_txtArea$/.test(f.selector) ||
          /^#(nameEmployerActivity|nameSchoolEdu|locationStationed|parentOccupation|nameOfOrgInviter(Two)?|cityBirth)_input$/.test(
            f.selector,
          )),
    );
    expect(free.length).toBeGreaterThan(10);
    for (const f of free)
      expect([f.selector, f.transform]).toEqual([
        f.selector,
        f.selector === '#responsibilityActivity_input' ? 'plain_words' : 'ircc_text',
      ]);
  });

  it('the purpose box is sanitized', () => {
    const w = at(
      { purpose_of_visit: 'Tourism/sightseeing 06/2027' },
      '#visitDetails_txtArea',
    );
    expect(w[0]?.mappedValue).toMatch(/^Tourism or sightseeing 06-2027\b/);
  });

  it('names and emails are not touched', () => {
    expect(at({}, '#lastName_input')[0]?.mappedValue).toBe('Ali');
    expect(ircc().find((f) => f.selector === '#emailContactInfo_input')?.transform).toBeUndefined();
  });
});

describe('2. an "other name" that is the current name is never written', () => {
  const rows = (p: Record<string, unknown>) =>
    mapped(p).filter((x) => /^ircc_other_name_\d+_family_name$/.test(x.fieldKey));
  const hasOther = (p: Record<string, unknown>) =>
    mapped(p).find((x) => x.fieldKey === 'has_other_names')?.mappedValue;

  it.each([
    [{ family_name: 'ALI', given_name: 'CHAUDHARY ZEESHAN', type: 'previous name' }],
    [{ family_name: 'Ali', given_name: 'Chaudhary  Zeeshan.', type: 'previous name' }],
    [{ name: 'Chaudhary Zeeshan Ali', type: 'previous name' }],
    [{ name: 'Ali Chaudhary Zeeshan', type: 'previous name' }],
  ])('%j is dropped, and hasOtherNames is not Yes', (row) => {
    const p = { other_names: [row] };
    expect(rows(p)).toHaveLength(0);
    expect(hasOther(p)).not.toBe('Yes');
  });

  it('a real other name next to it is still written', () => {
    const p = {
      other_names: [
        { family_name: 'Ali', given_name: 'Chaudhary Zeeshan', type: 'previous name' },
        { family_name: 'Example', given_name: 'Zeeshan', type: 'alias' },
      ],
    };
    expect(rows(p).map((r) => r.mappedValue)).toEqual(['Example']);
    expect(hasOther(p)).toBe('Yes');
  });

  it('a name sharing only the family name is still written', () => {
    const p = {
      other_names: [{ family_name: 'Ali', given_name: 'Zeeshan', type: 'previous name' }],
    };
    expect(rows(p)).toHaveLength(1);
  });
});

describe('3. a family date of birth known to the year (or month)', () => {
  const parent = (dob: unknown) => ({
    parents: [
      {
        name: 'Omar Example',
        relationship: 'father',
        date_of_birth: dob,
        country_of_birth: 'Pakistan',
        deceased: 'Yes',
        date_of_death: '2001-02-03',
      },
    ],
  });
  const dob = (p: Record<string, unknown>) =>
    mapped(p).filter((x) => x.fieldKey === 'ircc_parent_1_date_of_birth');

  it('year only: "Unknown" month and day, chosen by option text', () => {
    const w = dob(parent('1960'));
    expect(w.map((x) => [x.targetField, x.mappedValue, x.op])).toEqual([
      ['#dateOfBirthYear_sltDateYear', '1960', undefined],
      ['#dateOfBirthMonth_sltDateMonth', 'Unknown', 'select_text'],
      ['#dateOfBirthDay_sltDateDay', 'Unknown', 'select_text'],
    ]);
  });

  it('year and month: the month by value, "Unknown" day by text', () => {
    const w = dob(parent('1960-05'));
    expect(w.map((x) => [x.targetField, x.mappedValue, x.op])).toEqual([
      ['#dateOfBirthYear_sltDateYear', '1960', undefined],
      ['#dateOfBirthMonth_sltDateMonth', '05', undefined],
      ['#dateOfBirthDay_sltDateDay', 'Unknown', 'select_text'],
    ]);
    const row = mapped(parent('1960-05')).find((x) => x.fieldKey === 'ircc_parent_1_row');
    expect(row?.mappedValue).toMatch(/born 1960-05-\*\*/);
  });

  it('a full date is unchanged', () => {
    expect(dob(parent('1960-05-07')).map((x) => [x.mappedValue, x.op])).toEqual([
      ['1960', undefined],
      ['05', undefined],
      ['7', undefined],
    ]);
  });

  it('a child born in a known year still gets "Unknown" by option text', () => {
    const p = {
      children: [
        {
          name: 'Sami Example',
          relationship: 'son',
          birth_year: 2010,
          country_of_birth: 'Pakistan',
          same_address: true,
          coming_to_canada: false,
        },
      ],
    };
    const w = mapped(p).filter(
      (x) => x.targetField === '#dateOfBirthChildMonth_sltDateMonth',
    );
    expect(w.map((x) => [x.mappedValue, x.op])).toEqual([['Unknown', 'select_text']]);
  });

  it('an eTA date select never gets "Unknown"', () => {
    expect(applyFillTransform('date_month_name', '1960-Unknown-Unknown')).toBeNull();
    expect(applyFillTransform('date_day_padded', '1960-05-Unknown')).toBeNull();
  });
});
