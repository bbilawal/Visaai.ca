/**
 * /contact-info will not save until the residence rows cover the past 5
 * years, or since birth for a young child (live 2026-10-31). The fill names
 * the uncovered months; the intake asks the earlier countries. Also: the
 * child note filter keeps education notes, and /minors-guardian is not
 * skipped on the 17th birthday. Names are invented.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import { missingIntakeFacts } from '@visaai/types';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import {
  residenceCoverage,
  sixteenOrUnder,
} from '../src/modules/automation/portal-fills/canada-ircc';

const trv = () => resolvePortalFill('ircc')!;
const TRV = { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' };
const DAY = 24 * 60 * 60 * 1000;

const BASE: Record<string, unknown> = {
  given_name: 'Farid',
  family_name: 'Ghauri',
  date_of_birth: '1984-07-21',
  nationality: 'PAK',
  passport_number: 'TR5566778',
  purpose_of_visit: 'tourism',
  planned_entry_date: '2027-05-02',
  planned_departure_date: '2027-05-25',
  residential_address: '9 Ferozepur Road, Lahore, Pakistan',
};

const values = (p: Record<string, unknown>) =>
  applyPrefillOverrides(trv(), { ...BASE, ...p }, []);
const left = (p: Record<string, unknown>, page: string) =>
  portalFillCoverage(trv(), values(p)).pages.find((x) => x.page === page)?.left ?? [];
const coverageNote = (p: Record<string, unknown>) =>
  left(p, '/contact-info').find((l) => l.label === 'Residence — past 5 years')?.note;

/** YYYY-MM `months` before this month. */
const monthsAgo = (months: number) => {
  const d = new Date();
  const n = d.getUTCFullYear() * 12 + d.getUTCMonth() - months;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
};
const dayIn = (ym: string, day = '01') => `${ym}-${day}`;

describe('residence rows must cover the past 5 years', () => {
  it('a citizen since birth is covered: no note', () => {
    const p = { residence_since: 'since birth' };
    expect(residenceCoverage({ ...BASE, ...p })).toEqual([]);
    expect(coverageNote(p)).toBeUndefined();
  });

  it('a current row starting 2 years ago with no earlier row names the gap', () => {
    const p = { residence_since: dayIn(monthsAgo(24)) };
    expect(residenceCoverage({ ...BASE, ...p })).toEqual([
      `${monthsAgo(60)} to ${monthsAgo(25)}`,
    ]);
    const n = coverageNote(p);
    expect(n).toContain(`from ${monthsAgo(60)} to ${monthsAgo(25)}`);
    expect(n).toMatch(/past 5 years/);
    expect(n).toMatch(/won't save/);
  });

  it('an earlier row the fill writes closes the gap', () => {
    const p = {
      residence_since: dayIn(monthsAgo(24)),
      lived_elsewhere_last_5_years: true,
      previous_countries_of_residence: [
        {
          country: 'Saudi Arabia',
          status: 'Worker',
          from: dayIn(monthsAgo(80)),
          to: dayIn(monthsAgo(25), '28'),
        },
      ],
    };
    expect(residenceCoverage({ ...BASE, ...p })).toEqual([]);
    expect(coverageNote(p)).toBeUndefined();
  });

  it('a gap between two rows is named exactly', () => {
    const p = {
      residence_since: dayIn(monthsAgo(12)),
      previous_countries_of_residence: [
        {
          country: 'Oman',
          status: 'Worker',
          from: dayIn(monthsAgo(70)),
          to: dayIn(monthsAgo(30), '15'),
        },
      ],
    };
    expect(residenceCoverage({ ...BASE, ...p })).toEqual([
      `${monthsAgo(29)} to ${monthsAgo(13)}`,
    ]);
  });

  it('a young child: the window is since birth', () => {
    const born = dayIn(monthsAgo(40), '10');
    const covered = { date_of_birth: born, residence_since: 'since birth' };
    expect(residenceCoverage({ ...BASE, ...covered })).toEqual([]);
    const late = { date_of_birth: born, residence_since: dayIn(monthsAgo(20)) };
    expect(residenceCoverage({ ...BASE, ...late })).toEqual([
      `${monthsAgo(40)} to ${monthsAgo(21)}`,
    ]);
    expect(coverageNote(late)).toMatch(/since birth/);
  });

  it('no row written: only the row note, no coverage note', () => {
    expect(residenceCoverage({ ...BASE })).toEqual([]);
    expect(coverageNote({})).toBeUndefined();
  });
});

describe('intake asks the earlier countries when the current residence is recent', () => {
  const missing = (p: Record<string, unknown>) =>
    missingIntakeFacts({ ...BASE, ...p }, TRV).map((s) => s.key);

  it('lived_elsewhere_last_5_years is asked, and Yes asks the list', () => {
    expect(missing({ residence_since: dayIn(monthsAgo(24)) })).toContain(
      'lived_elsewhere_last_5_years',
    );
    expect(
      missing({ residence_since: dayIn(monthsAgo(24)), lived_elsewhere_last_5_years: 'yes' }),
    ).toContain('previous_countries_of_residence');
  });
});

describe('review nits', () => {
  it('a child under 14 keeps the Education details note', () => {
    const p = {
      date_of_birth: dayIn(monthsAgo(12 * 10)),
      has_post_secondary_education: 'yes',
    };
    const labels = left(p, '/activities').map((l) => l.label);
    expect(labels).toContain('Education details');
    expect(labels.some((l) => /job|work|Unemployed/i.test(l))).toBe(false);
  });

  it('/minors-guardian is not skipped on the 17th birthday (browser may be a day behind)', () => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - 17);
    const today17 = d.toISOString().slice(0, 10);
    expect(sixteenOrUnder({ date_of_birth: today17 })).toBe(true);
    const past = new Date(d.getTime() - 3 * DAY).toISOString().slice(0, 10);
    expect(sixteenOrUnder({ date_of_birth: past })).toBe(false);
    expect(
      buildMappingInputs(
        trv(),
        values({ date_of_birth: today17, minor_travelling_with_guardian: 'yes' }),
      ).some((x) => x.targetField === '#isTravelingGuardian_radio-button-01-input'),
    ).toBe(true);
    expect(
      missingIntakeFacts({ ...BASE, date_of_birth: today17 }, TRV).map((s) => s.key),
    ).toContain('minor_travelling_with_guardian');
  });
});
