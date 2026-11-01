/**
 * Live 2026-10-19 (TRV, /submission): the Submit page still said "Work
 * history (past 10 years, no gaps) — add earlier jobs, studies and other
 * periods yourself" while the assistant had written all three rows (current
 * job + two earlier periods). The note now follows the rows actually written:
 * gone when they cover the 10 years, otherwise naming the uncovered months.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-super-visa';
import { portalFillCoverage } from '../src/modules/automation/fill-instructions';
import {
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';

type M = ReturnType<typeof resolvePortalFill> & object;
const trv = () => resolvePortalFill('ircc')!;
const sv = () => resolvePortalFillFor('ircc', 'ca-super-visa')!;

const LABEL = 'Work history (past 10 years, no gaps)';
const BASE: Record<string, unknown> = {
  given_name: 'Muzaffar',
  family_name: 'Ahmad',
  date_of_birth: '1968-03-09',
  nationality: 'PAK',
  purpose_of_visit: 'family visit',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2027-04-30',
  residential_address: '12 Mall Road, Lahore, Punjab 54000, Pakistan',
};
const workNote = (p: Record<string, unknown>, m: M = trv()) =>
  portalFillCoverage(m, { ...BASE, ...p })
    .pages.find((x) => x.page === '/activities')
    ?.left.find((l) => l.label === LABEL);

// The 10-year window moves with the clock while the fixtures name fixed
// months: pin the clock so the expectations do not rot.
const NOW = new Date('2026-10-15T12:00:00Z');
const thisMonth = '2026-10';
const tenYearsAgo = '2016-10';
beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval'] });
  jest.setSystemTime(NOW);
});
afterAll(() => jest.useRealTimers());

const EMPLOYED = {
  employed: true,
  job_title: 'Bank manager',
  employer_name: 'Meezan Bank',
  job_duties: 'Branch operations',
  employment_start_date: '2020-01',
  employer_address: '1 Jail Road, Lahore, Pakistan',
};
const CLERK = {
  from: '2012-01',
  to: '2018-06',
  activity: 'Bank manager',
  employer: 'HBL',
  duties: 'Ran the branch, approved loans',
  address: '5 Mall Road',
  city: 'Lahore',
  country: 'Pakistan',
};
const JOBLESS = {
  from: '2018-07',
  to: '2019-12',
  activity: 'Unemployed',
  address: '12 Mall Road',
  city: 'Lahore',
  country: 'Pakistan',
};

describe('Submit page: 10-year work history note', () => {
  it('the live case: current job + two complete earlier periods cover 10 years → no note', () => {
    expect(workNote({ ...EMPLOYED, work_history: [CLERK, JOBLESS] })).toBeUndefined();
    expect(
      workNote({ ...EMPLOYED, work_history: [CLERK, JOBLESS] }, sv()),
    ).toBeUndefined();
  });

  it('nothing recorded: the whole 10 years are listed', () => {
    const n = workNote({});
    expect(n?.note).toMatch(/The assistant has no complete period to add\./);
    expect(n?.note).toContain(`Not yet covered: ${tenYearsAgo} to ${thisMonth}.`);
  });

  it('a gap between written periods is named by month', () => {
    const n = workNote({
      ...EMPLOYED,
      work_history: [CLERK, { ...JOBLESS, to: '2019-06' }],
    });
    expect(n?.note).toMatch(/adds your current job and 2 earlier periods/);
    expect(n?.note).toContain('Not yet covered: 2019-07 to 2019-12.');
  });

  it('a period missing its street address leaves its months uncovered, and its own note says why', () => {
    const p = {
      ...EMPLOYED,
      work_history: [{ ...CLERK, address: undefined, city: undefined }, JOBLESS],
    };
    const n = workNote(p);
    expect(n?.note).toContain(`Not yet covered: ${tenYearsAgo} to 2018-06.`);
    expect(n?.note).toMatch(/1 earlier period\b/);
    const own = portalFillCoverage(trv(), { ...BASE, ...p })
      .pages.find((x) => x.page === '/activities')
      ?.left.find((l) => l.label === 'Earlier work period 1');
    expect(own?.note).toMatch(/full address/);
  });

  it('a job title with no IRCC occupation is not counted as written', () => {
    const n = workNote({
      ...EMPLOYED,
      work_history: [{ ...CLERK, activity: 'Zxqv specialist' }, JOBLESS],
    });
    expect(n?.note).toContain(`${tenYearsAgo} to 2018-06`);
  });

  it('a period of studies is not a work row: its months stay listed, pointing to education', () => {
    const n = workNote({
      ...EMPLOYED,
      work_history: [
        { from: '2012-01', to: '2018-06', activity: 'Student', city: 'Lahore', country: 'Pakistan' },
        JOBLESS,
      ],
    });
    expect(n?.note).toContain(`${tenYearsAgo} to 2018-06`);
    expect(n?.note).toMatch(/post-secondary education/);
  });

  it('the current job alone, without its start month, is not counted', () => {
    const n = workNote({
      ...EMPLOYED,
      employment_start_date: undefined,
      work_history: [CLERK, JOBLESS],
    });
    expect(n?.note).toContain(`Not yet covered: 2020-01 to ${thisMonth}.`);
    expect(n?.note).not.toMatch(/current job/);
  });

  it('retired more than 10 years ago → no note; recently retired → the earlier months', () => {
    expect(workNote({ occupation: 'Retired', occupation_since: '2010-05' })).toBeUndefined();
    const n = workNote({ occupation: 'Retired', occupation_since: '2020-01' });
    expect(n?.note).toMatch(/adds your retirement\./);
    expect(n?.note).toContain(`Not yet covered: ${tenYearsAgo} to 2019-12.`);
    // …and the earlier periods close the gap.
    expect(
      workNote({
        occupation: 'Retired',
        occupation_since: '2020-01',
        work_history: [CLERK, JOBLESS],
      }),
    ).toBeUndefined();
  });

  it('a note never ends in an empty "Not yet covered"', () => {
    // The live case is covered, so no item; and no item text is ever blank-listed.
    const left =
      portalFillCoverage(trv(), { ...BASE, ...EMPLOYED, work_history: [CLERK, JOBLESS] })
        .pages.find((x) => x.page === '/activities')?.left ?? [];
    expect(left.some((l) => /Not yet covered: \./.test(l.note ?? ''))).toBe(false);
  });

  it('periods past the 6 the assistant writes are named as such', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...JOBLESS,
      from: `20${10 + i}-01`,
      to: `20${10 + i}-12`,
    }));
    const left =
      portalFillCoverage(trv(), { ...BASE, work_history: many })
        .pages.find((x) => x.page === '/activities')?.left ?? [];
    const seventh = left.find((l) => l.label === 'Earlier work period 7');
    expect(seventh?.note).toBe(
      'The assistant adds up to 6 earlier periods; add this one to your work history yourself.',
    );
  });
});
