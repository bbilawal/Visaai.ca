/**
 * Live IRCC tr-rt fill 2026-10-30: /activities refused to save ("Give details
 * of all your employment and activities for the past 10 years…"). Of three
 * work-history periods only the current job was written:
 *  A. "Director" at a concrete block manufacturer placed no IRCC occupation;
 *  B. a second ongoing job (a car wash, alongside the current trading job)
 *     was dropped as if it were the current job;
 *  C. the note did not say the unwritten period leaves a gap IRCC blocks on.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import { irccOccupationFor } from '../src/modules/automation/portal-fills/ircc-occupations';

const ircc = () => resolvePortalFill('ircc')!;
const MANUFACTURING = 'Managers in manufacturing and utilities';
const SERVICES = 'Managers in customer and personal services';

const BASE: Record<string, unknown> = {
  given_name: 'Tariq',
  family_name: 'Example',
  date_of_birth: '1980-03-04',
  nationality: 'PAK',
  passport_number: 'ZX7654321',
  purpose_of_visit: 'Tourism',
  planned_entry_date: '2027-06-01',
  planned_departure_date: '2027-06-08',
  family_in_destination: 'No',
  employment_status: 'Self-employed',
  job_title: 'Managing Partner',
  employer_name: 'Example Trading',
  job_duties: 'Scrap metal trading',
  employment_start_date: '2025-06',
  employer_address: 'Plot 1, Main Road, Gujrat, Pakistan',
};

const DIRECTOR = {
  from: '2016-10',
  to: '2025-05',
  job_title: 'Director',
  employer: 'Example Bloks (Private) Limited',
  duties: 'concrete block manufacturing, managed production and sales',
  address: 'GT Road, Gujranwala, Pakistan',
};
const TRADING = {
  from: '2025-06',
  to: 'present',
  job_title: 'Managing Partner',
  employer: 'Example Trading',
  duties: 'scrap metal trading',
  address: 'Plot 1, Main Road, Gujrat, Pakistan',
};
const CAR_WASH = {
  from: '2025-08',
  to: 'present',
  job_title: 'Proprietor',
  employer: 'Example Care car wash and auto detailing',
  duties: 'run the car wash',
  address: 'Example Chowk, Gujrat-Fatehpur Road, Gujrat, Pakistan',
};

const profile = (work_history: unknown[]) => ({ ...BASE, work_history });
const mapped = (p: Record<string, unknown>) =>
  buildMappingInputs(ircc(), applyPrefillOverrides(ircc(), p, []));
const val = (p: Record<string, unknown>, key: string) =>
  mapped(p).find((m) => m.fieldKey === key)?.mappedValue;
const activitiesLeft = (p: Record<string, unknown>) =>
  (
    portalFillCoverage(ircc(), p).pages.find((x) => x.page === '/activities')
      ?.left ?? []
  ).map((n) => ({ label: n.label, note: n.note ?? '' }));

beforeAll(() => {
  jest.useFakeTimers({ now: new Date('2026-10-30T12:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
});
afterAll(() => jest.useRealTimers());

describe('A. a director of a manufacturing business', () => {
  it.each([
    'Director, concrete block manufacturing',
    'Managing Director of a textile mill',
    'Partner in a brick factory',
    'Managing partner, flour mills',
  ])('"%s" is a manufacturing manager', (t) => {
    expect(irccOccupationFor(t)?.title).toBe(MANUFACTURING);
  });

  it.each([
    'Director',
    'Managing Director',
    'Sales director at a manufacturing company',
    'Marketing director, garment factory',
    'Manager at a garment factory',
  ])('"%s" is not a manufacturing manager', (t) => {
    expect(irccOccupationFor(t)?.title).not.toBe(MANUFACTURING);
  });

  it('a bare Managing Director / CEO stays senior management', () => {
    for (const t of ['Managing Director', 'CEO', 'CEO of a steel mill'])
      expect(irccOccupationFor(t)?.title).toBe(
        'Legislators and senior management, including political officials',
      );
  });

  it('the earlier row takes its occupation from the duties when title and employer name none', () => {
    const p = profile([DIRECTOR, TRADING]);
    expect(val(p, 'ircc_work_1_title')).toBe(MANUFACTURING);
    expect(val(p, 'ircc_work_1_activity')).toBe('Management occupations');
    expect(val(p, 'ircc_work_1_employer')).toBe('Example Bloks (Private) Limited');
  });

  it('duties naming no sector still leave the occupation to the applicant', () => {
    const p = profile([{ ...DIRECTOR, duties: 'managed the company' }, TRADING]);
    expect(val(p, 'ircc_work_1_title')).toBeUndefined();
    expect(activitiesLeft(p).map((n) => n.note).join('\n')).toMatch(
      /IRCC occupation for "Director"/,
    );
  });
});

describe('B. a second ongoing job', () => {
  const p = profile([DIRECTOR, TRADING, CAR_WASH]);

  it('is written as another row, marked ongoing with no end date', () => {
    expect(val(p, 'ircc_work_2_employer')).toBe(
      'Example Care car wash and auto detailing',
    );
    expect(val(p, 'ircc_work_2_title')).toBe(SERVICES);
    expect(val(p, 'ircc_work_2_from')).toBeDefined();
    expect(val(p, 'ircc_work_2_ongoing')).toBe('Yes');
    expect(val(p, 'ircc_work_2_to')).toBeUndefined();
    const toKeys = mapped(p).filter(
      (m) => m.fieldKey === 'ircc_work_2_to' && m.mappedValue !== undefined,
    );
    expect(toKeys).toHaveLength(0);
  });

  it('an ended earlier row is not marked ongoing', () => {
    expect(val(p, 'ircc_work_1_ongoing')).toBeUndefined();
  });

  it('the current job is never written twice', () => {
    const employers = mapped(p)
      .filter((m) => /^ircc_work_\d+_employer$/.test(m.fieldKey) && m.mappedValue)
      .map((m) => m.mappedValue);
    expect(employers).not.toContain('Example Trading');
    expect(val(p, 'ircc_work_current_employer')).toBe('Example Trading');
    expect(val(p, 'ircc_work_3_employer')).toBeUndefined();
  });

  it('the current job recorded as ongoing under another spelling is not duplicated', () => {
    const q = profile([
      DIRECTOR,
      { ...TRADING, employer: 'EXAMPLE TRADING LTD.' },
      CAR_WASH,
    ]);
    expect(val(q, 'ircc_work_2_employer')).toBe(
      'Example Care car wash and auto detailing',
    );
    expect(val(q, 'ircc_work_3_employer')).toBeUndefined();
  });

  it('with all three rows written, the 10 years are covered and nothing is noted', () => {
    expect(activitiesLeft(p).map((n) => n.label)).not.toContain(
      'Work history (past 10 years, no gaps)',
    );
  });
});

describe('C. an unwritten row that leaves a gap', () => {
  const p = profile([{ ...DIRECTOR, duties: undefined }, TRADING, CAR_WASH]);

  it('the work-history note says IRCC will not save the page', () => {
    const note = activitiesLeft(p).find(
      (n) => n.label === 'Work history (past 10 years, no gaps)',
    )?.note;
    expect(note).toMatch(/2016-10 to 2025-05/);
    expect(note).toMatch(/IRCC will not save or continue/i);
  });

  it("the period's own note says it leaves a gap IRCC blocks on", () => {
    const own = activitiesLeft(p).find((n) => n.label === 'Earlier work period 1')?.note;
    expect(own).toMatch(/your duties/);
    expect(own).toMatch(/2016-10 to 2025-05/);
    expect(own).toMatch(/IRCC will not save or continue/i);
  });

  it('an unwritten period whose months are covered by other rows says no such thing', () => {
    const q = profile([
      { ...DIRECTOR, from: '2010-01', to: '2025-05' },
      { ...DIRECTOR, from: '2012-01', to: '2013-01', duties: undefined },
      TRADING,
    ]);
    const own = activitiesLeft(q).find((n) => n.label === 'Earlier work period 2')?.note;
    expect(own).toMatch(/your duties/);
    expect(own).not.toMatch(/IRCC will not save/i);
  });
});
