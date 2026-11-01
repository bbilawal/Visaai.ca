/**
 * Review of 508e7812 + c5647b34:
 *  A. the duties fallback ran every occupation rule over title + employer +
 *     duties, so a word anywhere in the duties placed an occupation;
 *  B. the current job recorded as ongoing under another employer spelling
 *     was written twice;
 *  D. text with no Roman letters left at all was noted as "not in profile";
 *  E. a real alias with the current name's words in another order was dropped.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import { irccOccupationFromDuties } from '../src/modules/automation/portal-fills/ircc-occupations';

const ircc = () => resolvePortalFill('ircc')!;
const BASE: Record<string, unknown> = {
  given_name: 'Chaudhary Zeeshan',
  family_name: 'Ali',
  date_of_birth: '1980-03-04',
  nationality: 'PAK',
  passport_number: 'ZX7654321',
  purpose_of_visit: 'Tourism',
  planned_entry_date: '2027-06-01',
  planned_departure_date: '2027-06-08',
  family_in_destination: 'No',
};
const mapped = (p: Record<string, unknown>) =>
  buildMappingInputs(ircc(), applyPrefillOverrides(ircc(), { ...BASE, ...p }, []));
const val = (p: Record<string, unknown>, key: string) =>
  mapped(p).find((m) => m.fieldKey === key)?.mappedValue;
const leftOn = (p: Record<string, unknown>, page: string) =>
  portalFillCoverage(ircc(), { ...BASE, ...p }).pages.find((x) => x.page === page)
    ?.left ?? [];

const CURRENT = {
  employment_status: 'Self-employed',
  job_title: 'Managing Partner',
  employer_name: 'Example Trading',
  job_duties: 'Scrap metal trading',
  employment_start_date: '2025-06',
  employer_address: 'Plot 1, Main Road, Gujrat, Pakistan',
};
const earlier = (job_title: string, employer: string, duties: string) => ({
  ...CURRENT,
  work_history: [
    {
      from: '2016-10',
      to: '2025-05',
      job_title,
      employer,
      duties,
      address: 'GT Road, Gujranwala, Pakistan',
    },
  ],
});

describe('A. the duties name a sector only as the business the applicant runs', () => {
  it('the live case still maps to manufacturing', () => {
    const p = earlier(
      'Director',
      'Example Bloks (Private) Limited',
      'concrete block manufacturing, managed production and sales',
    );
    expect(val(p, 'ircc_work_1_title')).toBe('Managers in manufacturing and utilities');
  });

  it.each([
    ['Owner', 'Example Enterprises', 'deliver goods by truck'],
    ['Director', 'XYZ Holdings', 'factory visits and client meetings'],
    ['Director', 'Example Enterprises', 'sells to garment factories'],
    ['Owner', 'Example Services', 'supplying cleaners and security guards to factories'],
    ['Partner', 'Example Law Associates', 'advising mill owners'],
    ['Manager', 'Example Enterprises', 'supervising the cook and waiters'],
    ['Director', 'Example Enterprises', 'sells to manufacturing companies'],
    ['Supervisor', 'Example Enterprises', 'concrete block manufacturing'],
    ['Manager', 'Example Enterprises', 'production of reports for the board'],
    ['Manager', 'Example Enterprises', 'video production of ads'],
    ['Head', 'Example Enterprises', 'manufacturing department liaison'],
    ['Founder', 'Example Apps', 'car wash bookings app development'],
    ['Director', 'Example Enterprises', 'production of cotton yarn'],
    ['Owner', 'Example Enterprises', 'running a brick manufacturing unit'],
    ['Owner', 'Example Enterprises', 'managed manufacturing'],
    ['Department head', 'Example Enterprises', 'concrete block manufacturing'],
    ['Division manager', 'Example Enterprises', 'concrete block manufacturing'],
  ])('"%s" / "%s" / "%s" stays blank', (title, employer, duties) => {
    expect(val(earlier(title, employer, duties), 'ircc_work_1_title')).toBeUndefined();
  });

  it.each([
    ['Director', 'concrete block manufacturing', 'Managers in manufacturing and utilities'],
    ['Owner', 'garment manufacturing', 'Managers in manufacturing and utilities'],
    ['Partner', 'manufacturing of plastic pipes', 'Managers in manufacturing and utilities'],
    ['Managing Director', 'Steel pipe manufacturing; exports', 'Managers in manufacturing and utilities'],
  ])('"%s" / "%s" → %s', (title, duties, want) => {
    expect(irccOccupationFromDuties(title, duties)?.title).toBe(want);
  });

  it.each([
    ['Proprietor', 'scrap metal trading'],
    ['Owner', 'running a car wash'],
    ['Head', 'concrete block manufacturing'],
  ])('"%s" / "%s": no trade or service path from the duties, no "head"', (t, d) => {
    expect(irccOccupationFromDuties(t, d)).toBeUndefined();
  });

  it('a function director (sales, HR) is not the business manager', () => {
    expect(
      irccOccupationFromDuties('Sales director', 'concrete block manufacturing'),
    ).toBeUndefined();
  });
});

describe('B. the current job recorded as ongoing under another spelling', () => {
  const p = (row: Record<string, unknown>) => ({
    ...CURRENT,
    employer_name: 'Ali Traders',
    work_history: [
      {
        from: '2025-06',
        to: 'present',
        job_title: 'Managing Partner',
        employer: 'Ali Traders',
        duties: 'scrap metal trading',
        address: 'Plot 1, Main Road, Gujrat, Pakistan',
        ...row,
      },
    ],
  });

  it('same start month ±1, other spelling: not written again', () => {
    expect(val(p({ employer: 'Ali Trading Co', from: '2025-07', job_title: 'Partner' }), 'ircc_work_1_employer')).toBeUndefined();
  });

  it('same title, other spelling and start: not written again', () => {
    expect(val(p({ employer: 'Ali Trading Co', from: '2025-01' }), 'ircc_work_1_employer')).toBeUndefined();
  });

  it('two "Proprietor" businesses: both written', () => {
    const q = {
      ...CURRENT,
      job_title: 'Proprietor',
      employer_name: 'Example Care car wash',
      employment_start_date: '2020-01',
      job_duties: 'running a car wash',
      work_history: [
        { from: '2016-01', to: '2019-12', job_title: 'Clerk', employer: 'Example Bank', duties: 'filing', address: 'Plot 3, Main Road, Gujrat, Pakistan' },
        { from: '2023-04', to: 'present', job_title: 'Proprietor', employer: 'City Laundry', duties: 'washing clothes', address: 'Plot 2, Main Road, Gujrat, Pakistan' },
      ],
    };
    expect(val(q, 'ircc_work_current_employer')).toBe('Example Care car wash');
    expect(val(q, 'ircc_work_2_employer')).toBe('City Laundry');
  });

  it('another title and a start months apart: a second job, written', () => {
    expect(
      val(
        p({ employer: 'Example Car Wash', from: '2025-08', job_title: 'Proprietor', duties: 'running a car wash' }),
        'ircc_work_1_employer',
      ),
    ).toBe('Example Car Wash');
  });
});

describe('D. text with no Roman letters', () => {
  it('is left for the applicant to type, not "not in profile"', () => {
    const left = leftOn(
      { previous_visa_refused: 'Yes', refusal_details: 'ویزا مسترد' },
      '/validity-status',
    );
    const n = left.find((x) => /refus/i.test(x.label) && x.reason === 'fill_yourself');
    expect(n?.note).toMatch(/Roman/);
    expect(left.some((x) => /refus/i.test(x.label) && x.reason === 'not_in_profile' && !/ever/i.test(x.label))).toBe(false);
  });
});

describe('E. an alias with the same words in another order is kept', () => {
  const rows = (name: string) =>
    mapped({ other_names: [{ name, type: 'alias' }] }).filter((x) =>
      /^ircc_other_name_\d+_family_name$/.test(x.fieldKey),
    );
  it('"Zeeshan Ali Chaudhary" is a real alias', () => {
    expect(rows('Zeeshan Ali Chaudhary')).toHaveLength(1);
  });
  it.each(['Ali Chaudhary Zeeshan', 'Chaudhary Zeeshan Ali', 'ALI, Chaudhary-Zeeshan'])(
    '"%s" is the current name',
    (name) => {
      expect(rows(name)).toHaveLength(0);
    },
  );
});
