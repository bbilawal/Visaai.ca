/**
 * tr-rt coverage audit, wave 1a (2026-10-31): an applicant currently without
 * work (matrix B A15), an ongoing retired / homemaker period known only from
 * the work history, and a working spouse's occupation (matrix C row 8).
 * Names are invented.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';

const trv = () => resolvePortalFill('ircc')!;

const BASE: Record<string, unknown> = {
  given_name: 'Tariq',
  family_name: 'Noorani',
  date_of_birth: '1980-04-12',
  nationality: 'PAK',
  country_of_residence: 'Pakistan',
  residential_address: {
    street: 'House 7, Lane 3',
    city: 'Sialkot',
    country: 'Pakistan',
  },
  passport_number: 'XY7654321',
  purpose_of_visit: 'tourism',
  planned_entry_date: '2027-05-01',
  planned_departure_date: '2027-05-30',
};

const on = (p: Record<string, unknown>, page = '/activities') =>
  buildMappingInputs(trv(), { ...BASE, ...p }).filter((x) => x.page === page);
const keyed = (p: Record<string, unknown>, prefix: string) =>
  on(p).filter((x) => x.fieldKey.startsWith(prefix));
const left = (p: Record<string, unknown>, page = '/activities') =>
  portalFillCoverage(trv(), { ...BASE, ...p }).pages.find((x) => x.page === page)
    ?.left ?? [];

const tenYearsAgo = () => {
  const d = new Date();
  return `${d.getUTCFullYear() - 11}-01`;
};

describe('A15: currently unemployed', () => {
  const EARLIER = {
    from: tenYearsAgo(),
    to: '2024-02',
    activity: 'Accountant',
    employer: 'Rafiq Textiles',
    duties: 'kept the accounts',
    address: '12 Mall Road',
    city: 'Sialkot',
    country: 'Pakistan',
  };

  it('an ongoing Unemployed period in work_history becomes an ongoing Unemployed row', () => {
    const p = {
      occupation: 'Unemployed',
      employed: false,
      work_history: [
        EARLIER,
        { from: '2024-03', to: 'present', activity: 'Unemployed' },
      ],
    };
    const row = keyed(p, 'ircc_work_unemployed');
    const by = (k: string) => row.filter((x) => x.fieldKey === k);
    expect(by('ircc_work_unemployed_row')[0]?.mappedValue).toBe(
      'Unemployed since 2024-03',
    );
    expect(by('ircc_work_unemployed_activity')[0]?.mappedValue).toBe('Unemployed');
    expect(by('ircc_work_unemployed_activity')[0]?.targetField).toBe(
      '#activtyOccupation_select',
    );
    expect(by('ircc_work_unemployed_ongoing')[0]?.targetField).toBe(
      '#isCurrentEmployer_chk-input',
    );
    expect(by('ircc_work_unemployed_from').map((x) => x.mappedValue)).toEqual([
      '2024',
      '03',
    ]);
    // Where the applicant lives now: street, city and country.
    const addr = row
      .filter((x) => x.fieldKey.startsWith('ircc_work_unemployed_address'))
      .map((x) => x.mappedValue);
    expect(addr).toEqual(
      expect.arrayContaining(['House 7, Lane 3', 'Sialkot']),
    );
    // Never written twice, and the earlier job is still its own row.
    const earlier = keyed(p, 'ircc_work_1_row');
    expect(earlier[0]?.mappedValue).toMatch(/Rafiq Textiles/);
    expect(keyed(p, 'ircc_work_2_row')).toEqual([]);
    // The 10 years are covered: no gap note.
    expect(left(p).map((l) => l.label)).not.toContain(
      'Work history (past 10 years, no gaps)',
    );
  });

  it('not_employed_since alone makes the row', () => {
    const p = {
      employment_status: 'unemployed',
      not_employed_since: '2023-09',
    };
    expect(keyed(p, 'ircc_work_unemployed_row')[0]?.mappedValue).toBe(
      'Unemployed since 2023-09',
    );
  });

  it('without a start month: no row, and a note', () => {
    const p = { occupation: 'Unemployed' };
    expect(keyed(p, 'ircc_work_unemployed')).toEqual([]);
    expect(left(p).map((l) => l.label)).toContain('Period without work');
  });

  it('without a home address: the ongoing period is written from its own address, never invented', () => {
    const p = {
      occupation: 'Unemployed',
      residential_address: undefined,
      work_history: [
        {
          from: '2024-03',
          to: 'present',
          activity: 'Unemployed',
          address: '4 Canal View',
          city: 'Sialkot',
          country: 'Pakistan',
        },
      ],
    };
    expect(keyed(p, 'ircc_work_unemployed')).toEqual([]);
    const row = keyed(p, 'ircc_work_1');
    expect(row.find((x) => x.fieldKey === 'ircc_work_1_activity')?.mappedValue).toBe(
      'Unemployed',
    );
    expect(row.find((x) => x.fieldKey === 'ircc_work_1_ongoing')?.mappedValue).toBe('Yes');
  });

  const JOB = {
    employer_name: 'City Grammar School',
    job_duties: 'teach mathematics',
    employment_start_date: '2015-01',
    employer_address: '3 College Road, Sialkot, Pakistan',
  };

  it('review blocker 1: a current job under position + a stale ongoing Unemployed period → only the job row', () => {
    const p = {
      ...JOB,
      position: 'Teacher',
      work_history: [{ from: '2024-03', to: 'present', activity: 'Unemployed' }],
    };
    expect(keyed(p, 'ircc_work_current_row')[0]?.mappedValue).toBe(
      'City Grammar School since 2015-01',
    );
    expect(keyed(p, 'ircc_work_unemployed')).toEqual([]);
    // Nor as an earlier ongoing row: "Unemployed" contradicts the current job.
    expect(on(p).some((x) => x.mappedValue === 'Unemployed')).toBe(false);
    expect(left(p).map((l) => l.note).join(' ')).not.toMatch(/unemployed/i);
    expect(left(p).map((l) => l.label)).not.toContain('Period without work');
  });

  it('review blocker 2: employment_status Unemployed + a profession → the Unemployed row, no current job', () => {
    const p = {
      ...JOB,
      employment_status: 'Unemployed',
      occupation: 'Accountant',
      not_employed_since: '2024-05',
    };
    expect(keyed(p, 'ircc_work_unemployed_row')[0]?.mappedValue).toBe(
      'Unemployed since 2024-05',
    );
    expect(keyed(p, 'ircc_work_current')).toEqual([]);
    expect(left(p).map((l) => l.label)).not.toContain('Current job');
  });

  it('employed: false + a job title + not_employed_since → the Unemployed row', () => {
    const p = {
      employed: false,
      job_title: 'Accountant',
      not_employed_since: '2024-05',
    };
    expect(keyed(p, 'ircc_work_unemployed_row')[0]?.mappedValue).toBe(
      'Unemployed since 2024-05',
    );
    expect(keyed(p, 'ircc_work_current')).toEqual([]);
  });

  it('a job applicant is never given an Unemployed row', () => {
    const p = {
      job_title: 'School teacher',
      employer_name: 'City Grammar School',
      job_duties: 'teach mathematics',
      employment_start_date: '2015-01',
      employer_address: '3 College Road, Sialkot, Pakistan',
    };
    expect(keyed(p, 'ircc_work_unemployed')).toEqual([]);
  });
});

describe('retired / homemaker known only from an ongoing work_history period', () => {
  it('retired: the ongoing period gives the retirement month', () => {
    const p = {
      occupation: 'Retired',
      work_history: [{ from: '2015-06', to: 'present', activity: 'Retired' }],
    };
    expect(keyed(p, 'ircc_work_retired_row')[0]?.mappedValue).toBe(
      'Retired since 2015-06',
    );
    expect(keyed(p, 'ircc_work_1')).toEqual([]);
  });

  it('homemaker: the ongoing period gives the start month', () => {
    const p = {
      occupation: 'Homemaker',
      work_history: [{ from: '2010-02', to: 'present', activity: 'Homemaker' }],
    };
    expect(keyed(p, 'ircc_work_homemaker_row')[0]?.mappedValue).toBe(
      'Homemaker since 2010-02',
    );
    expect(keyed(p, 'ircc_work_1')).toEqual([]);
  });
});

describe('matrix C 8: a working spouse', () => {
  const spouseOcc = (occ: string) =>
    on(
      {
        marital_status: 'Married',
        spouse_given_name: 'Rubina',
        spouse_family_name: 'Noorani',
        spouse_occupation: occ,
      },
      '/family-info',
    ).find((x) => x.targetField === '#partnerOccupation_select')?.mappedValue;

  it('a job title the rules place: its IRCC group (same list as the work history)', () => {
    expect(spouseOcc('School teacher')).toBe(
      'Education, law and social, community and government services occupations',
    );
  });
  it('homemaker, retired and unemployed', () => {
    expect(spouseOcc('Housewife')).toBe('Homemaker');
    expect(spouseOcc('Retired')).toBe('Retired');
    expect(spouseOcc('Unemployed')).toBe('Unemployed');
  });
  it('"unemployed" or "retired" anywhere in the text wins over the profession', () => {
    expect(spouseOcc('teacher (unemployed)')).toBe('Unemployed');
    expect(spouseOcc('retired teacher')).toBe('Retired');
  });
  it('a title the rules cannot place is left blank', () => {
    expect(spouseOcc('Freelancer')).toBeUndefined();
  });
});
