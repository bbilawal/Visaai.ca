/**
 * IRCC tr-rt questions the assistant does not fill, from the radio audit
 * (bundle 2026-10-19): an applicant under 18 gets the custodian / guardian
 * pages, a child aged 5 or under gets 2-year tuberculosis questions under
 * other names, and a passport that is not regular leaves the travel document
 * questions to the applicant. Each gets a "fill this yourself" note.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';

const trv = () => resolvePortalFill('ircc')!;
const BASE: Record<string, unknown> = {
  given_name: 'Muzaffar',
  family_name: 'Ahmad',
  date_of_birth: '1958-03-09',
  nationality: 'PAK',
  passport_number: 'AB1234567',
  purpose_of_visit: 'family visit',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2027-04-30',
};
const values = (p: Record<string, unknown>) =>
  applyPrefillOverrides(trv(), { ...BASE, ...p }, []);
const targets = (p: Record<string, unknown>) =>
  buildMappingInputs(trv(), values(p)).map((x) => x.targetField);
const notes = (p: Record<string, unknown>, page: string) =>
  (
    portalFillCoverage(trv(), values(p)).pages.find((x) => x.page === page)
      ?.left ?? []
  ).map((n) => n.label);

const CHILD_TB = 'Close contact with a person with tuberculosis';
const FIVE_YEARS =
  'Close contact with a person with tuberculosis in the last 5 years';

const yearsAgo = (n: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

describe('applicant under 18', () => {
  it('a 17-year-old is told about the custodian and guardian questions', () => {
    expect(notes({ date_of_birth: yearsAgo(17) }, '/bio-data')).toContain(
      'Applicant under 18',
    );
  });
  it('a 16-year-old gets /minors-guardian instead (wave 3c)', () => {
    expect(notes({ date_of_birth: yearsAgo(16) }, '/bio-data')).not.toContain(
      'Applicant under 18',
    );
  });
  it('an adult is not', () => {
    expect(notes({}, '/bio-data')).not.toContain('Applicant under 18');
  });
});

describe('tuberculosis: child aged 5 or under', () => {
  const contact = { tuberculosis_contact: false };
  it('the 5-year contact question is not written; the 2-year one is asked (wave 3c)', () => {
    const p = { ...contact, date_of_birth: yearsAgo(4) };
    expect(targets(p).some((t) => t.startsWith('#contactFiveYears'))).toBe(
      false,
    );
    expect(notes(p, '/medical-tuberculosis')).toContain(
      'Close contact with a person with tuberculosis in the last 2 years',
    );
  });
  it('an older applicant is written as before', () => {
    expect(targets(contact)).toContain(
      '#contactFiveYears_radio-button-02-input',
    );
    expect(notes(contact, '/medical-tuberculosis')).not.toContain(CHILD_TB);
  });
});

describe('passport that is not regular', () => {
  it('a diplomatic passport leaves the travel document to the applicant', () => {
    const p = { passport_type: 'Diplomatic' };
    expect(targets(p).some((t) => t.startsWith('#passportType'))).toBe(false);
    expect(notes(p, '/bio-data-travel-docs')).toContain('Travel document');
  });
  it('a regular passport gets no note', () => {
    expect(
      notes({ passport_type: 'Regular' }, '/bio-data-travel-docs'),
    ).not.toContain('Travel document');
  });
});

describe('review of #259', () => {
  // Born n years ago, shifted by `days` (positive = later birthday).
  const born = (n: number, days: number) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - n);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  it('a child: no 5-year row; near the 6th birthday only the explanation', () => {
    const rows = notes({ date_of_birth: yearsAgo(4) }, '/medical-tuberculosis');
    expect(rows).not.toContain(FIVE_YEARS);
    expect(rows).not.toContain(CHILD_TB);
    const near = notes({ date_of_birth: born(6, 0) }, '/medical-tuberculosis');
    expect(near).not.toContain(FIVE_YEARS);
    expect(near).toContain(CHILD_TB);
  });

  it('an older applicant who has not answered still gets the 5-year row', () => {
    const rows = notes({}, '/medical-tuberculosis');
    expect(rows).toContain(FIVE_YEARS);
    expect(rows).not.toContain(CHILD_TB);
  });

  it.each([
    [5, -2, false], // turned 5 two days ago: child
    [6, 3, false], // turns 6 in three days: child
    [6, -2, true], // turned 6 two days ago: older
    [6, 0, false], // 6th birthday today: within a day, not written
  ])(
    'age %i (birthday %i days off): 5-year question written = %s',
    (n, days, written) => {
      const p = { date_of_birth: born(n, days), tuberculosis_contact: false };
      expect(targets(p).some((t) => t.startsWith('#contactFiveYears'))).toBe(
        written,
      );
    },
  );

  it.each([
    [17, true],
    [18, false],
  ])('age %i: under-18 note = %s', (n, shown) => {
    expect(
      notes({ date_of_birth: born(n, -2) }, '/bio-data').includes(
        'Applicant under 18',
      ),
    ).toBe(shown);
  });

  it('no date of birth: treated as an older applicant', () => {
    expect(
      targets({ date_of_birth: undefined, tuberculosis_contact: false }),
    ).toContain('#contactFiveYears_radio-button-02-input');
  });

  it("a Forms-page answer cannot get past the child's gate", () => {
    const q = applyPrefillOverrides(
      trv(),
      { ...BASE, date_of_birth: yearsAgo(4) },
      [
        {
          key: 'tuberculosis_contact',
          label: 'TB contact',
          value: 'Yes',
          source: 'applicant',
        },
      ],
    );
    expect(
      buildMappingInputs(trv(), q).some((x) =>
        x.targetField.startsWith('#contactFiveYears'),
      ),
    ).toBe(false);
  });
});

describe('consultant exclusion', () => {
  const coverageExcluding = (p: Record<string, unknown>) =>
    (
      portalFillCoverage(
        trv(),
        values(p),
        new Set(['tuberculosis_contact']),
      ).pages.find((x) => x.page === '/medical-tuberculosis')?.left ?? []
    ).map((n) => n.label);

  it('an excluded TB contact question lists nothing, adult or child', () => {
    expect(coverageExcluding({})).not.toContain(FIVE_YEARS);
    expect(coverageExcluding({ date_of_birth: yearsAgo(4) })).not.toContain(
      CHILD_TB,
    );
  });
});
