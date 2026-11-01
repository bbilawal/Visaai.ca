/**
 * Live E2E 2026-10-19 (TRV / business visitor / super visa):
 *  1. /national-id-doc was blank — the interview never asked it, and a CNIC
 *     typed into the correction box was dropped ("No change": no key).
 *  2. /activities only ever got the current-job row; the earlier periods the
 *     interview records as `work_history` were never written, so IRCC's
 *     "10 years with no gaps" could not be met.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import { intakeFactSpecs, missingIntakeFacts, type PrefilledFormField } from '@visaai/types';
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
import { documentSubject } from '../src/modules/documents/graphs/nodes/document-subject';

const ircc = () => resolvePortalFill('ircc')!;
const ROUTES = [
  { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' },
  { country: 'CA', visaaiId: 'ca-business-visitors' },
  { country: 'CA', visaaiId: 'ca-super-visa' },
];
const TRV = ROUTES[0];

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

const mapped = (p: Record<string, unknown>) =>
  buildMappingInputs(ircc(), applyPrefillOverrides(ircc(), { ...BASE, ...p }, []));
const val = (p: Record<string, unknown>, key: string) =>
  mapped(p).filter((m) => m.fieldKey === key);
const left = (p: Record<string, unknown>, page: string) =>
  portalFillCoverage(ircc(), { ...BASE, ...p }).pages.find((x) => x.page === page)
    ?.left ?? [];

// ── 1. national identity document ──────────────────────────────────────────
describe('interview asks the national identity document', () => {
  const missing = (p: Record<string, unknown>, route = TRV) =>
    missingIntakeFacts(p, route).map((f) => f.key);

  it.each(ROUTES)('$visaaiId has the keys the portal reads', (route) => {
    const keys = intakeFactSpecs(route).map((s) => s.key);
    for (const k of [
      'has_national_id',
      'national_id_number',
      'national_id_issue_date',
      'national_id_country',
    ])
      expect(keys).toContain(k);
  });

  it('the eTA route is unchanged', () => {
    const keys = intakeFactSpecs({ country: 'CA', visaaiId: 'ca-eta' }).map((s) => s.key);
    expect(keys).not.toContain('has_national_id');
  });

  it('asks yes/no first, then the number, date and country after a yes', () => {
    expect(missing({})).toContain('has_national_id');
    expect(missing({})).not.toContain('national_id_number');
    expect(missing({})).not.toContain('national_id_issue_date');
    const yes = missing({ has_national_id: true });
    expect(yes).toEqual(
      expect.arrayContaining(['national_id_number', 'national_id_issue_date', 'national_id_country']),
    );
    const no = missing({ has_national_id: false });
    for (const k of ['national_id_number', 'national_id_issue_date', 'national_id_country'])
      expect(no).not.toContain(k);
  });

  it('a number already on file (ID card scan) answers the yes/no, not the date or country', () => {
    const m = missing({ national_id_number: '34101-9231766-1' });
    expect(m).not.toContain('has_national_id');
    expect(m).not.toContain('national_id_number');
    expect(m).toEqual(expect.arrayContaining(['national_id_issue_date', 'national_id_country']));
    expect(missing({ cnic: '34101-9231766-1' })).not.toContain('has_national_id');
  });

  it('a full answer is complete', () => {
    const m = missing({
      has_national_id: true,
      national_id_number: '34101-9231766-1',
      national_id_issue_date: '2023-04-14',
      national_id_country: 'Pakistan',
    });
    expect(m.filter((k) => k.startsWith('national_id') || k === 'has_national_id')).toEqual([]);
  });
});

describe('/national-id-doc is filled from the interview answers', () => {
  // "My national identity card (CNIC) number is 34101-9231766-1, issued by
  // Pakistan on 14 April 2023" — as the extractor is told to record it.
  const TYPED = {
    has_national_id: true,
    national_id_number: '34101-9231766-1',
    national_id_issue_date: '2023-04-14',
    national_id_country: 'Pakistan',
  };

  it('answers Yes and writes the number without dashes, twice', () => {
    expect(val(TYPED, 'has_national_id')[0]?.targetField).toBe(
      '#hasNationality_radio-button-01-input',
    );
    const nums = val(TYPED, 'national_id_number');
    expect(nums.map((m) => m.targetField).sort()).toEqual([
      '#docNumberConfirmationNationalities_input',
      '#docNumberNationalities_input',
    ]);
    for (const m of nums) expect(m.mappedValue).toBe('3410192317661');
  });

  it('writes the issue date and the country of issue', () => {
    const date = val(TYPED, 'national_id_issue_date');
    expect(date.map((m) => m.targetField)).toEqual(
      expect.arrayContaining([
        '#dateIssueNationalitiesYear_sltDateYear',
        '#dateIssueNationalitiesMonth_sltDateMonth',
        '#dateIssueNationalitiesDay_sltDateDay',
      ]),
    );
    expect(date.find((m) => /Year/.test(String(m.targetField)))?.mappedValue).toBe('2023');
    const c = val(TYPED, 'national_id_country')[0];
    expect(c?.targetField).toBe('#countryNationalities_select');
    expect(c?.mappedValue).toBe('209'); // Pakistan
    // the answer is read, not just the nationality fallback
    expect(
      val({ ...TYPED, national_id_country: 'India' }, 'national_id_country')[0]?.mappedValue,
    ).not.toBe('209');
  });

  it('No is written as No, with no number', () => {
    expect(val({ has_national_id: false }, 'has_national_id')[0]?.targetField).toBe(
      '#hasNationality_radio-button-02-input',
    );
    expect(val({ has_national_id: false }, 'national_id_number')).toEqual([]);
  });

  it('prefill carries the answers onto the Forms page', () => {
    const ctx: FinalizeContext = {
      applicantName: 'MUZAFFAR AHMAD',
      profile: { ...BASE, ...TYPED },
      documentFields: {},
      documentFieldsByType: {},
      otherPartyDocuments: [],
      accountProfile: {},
      route: TRV,
    };
    const out: PrefilledFormField[] = finalizeFields([], ctx);
    const by = (k: string) => out.find((f) => f.key === k);
    expect(by('national_id_number')?.value).toBe('34101-9231766-1');
    expect(by('national_id_issue_date')?.value).toBeTruthy();
    expect(by('national_id_country')?.value).toMatch(/Pakistan/);
  });

  it("a typed CNIC still matches the applicant's own ID card", () => {
    const d = documentSubject({
      profile: { ...BASE, national_id_number: '34101-9231766-1' },
      extracted: { national_id_number: '3410192317661', full_name: 'SOMEONE ELSE' } as never,
      documentType: 'national_id',
      slot: null,
    });
    expect(d).toMatchObject({ subject: 'applicant', ownIdentity: true });
  });
});

// ── 2. earlier work / activity rows ────────────────────────────────────────
describe('/activities: earlier work_history periods become rows', () => {
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
  const EMPLOYED = {
    employed: true,
    job_title: 'Bank manager',
    employer_name: 'Meezan Bank',
    job_duties: 'Branch operations',
    employment_start_date: '2020-01',
    employer_address: '1 Jail Road, Lahore, Pakistan',
  };

  const v = (p: Record<string, unknown>, k: string) => val(p, k)[0]?.mappedValue;

  it('a job row: dates, occupation, title, employer, duties, address', () => {
    const p = { ...EMPLOYED, work_history: [CLERK] };
    expect(val(p, 'ircc_work_1_row')[0]?.targetField).toBe('#empHistoryTable_add_button');
    expect(
      val(p, 'ircc_work_1_from').map((m) => [m.targetField, m.mappedValue]),
    ).toEqual(
      expect.arrayContaining([
        ['#fromWorkYear_sltDateYear', '2012'],
      ]),
    );
    expect(val(p, 'ircc_work_1_to').map((m) => m.targetField)).toEqual(
      expect.arrayContaining(['#toWorkYear_sltDateYear', '#toWorkMonth_sltDateMonth']),
    );
    expect(v(p, 'ircc_work_1_activity')).toBe('Management occupations');
    expect(v(p, 'ircc_work_1_title')).toBe('Managers in financial and business services');
    expect(v(p, 'ircc_work_1_employer')).toBe('HBL');
    expect(v(p, 'ircc_work_1_duties')).toBe('Ran the branch approved loans');
    expect(val(p, 'ircc_work_1_address_country')[0]?.targetField).toBe(
      '#country_workHistoryAddress',
    );
    expect(v(p, 'ircc_work_1_address_city')).toBe('Lahore');
    expect(val(p, 'ircc_work_1_row_saved')).toHaveLength(1);
    // the current job is still its own row
    expect(v(p, 'ircc_work_current_employer')).toBe('Meezan Bank');
  });

  it.each([
    ['Unemployed', 'Unemployed'],
    ['not working', 'Unemployed'],
    ['Retired', 'Retired'],
    ['Homemaker', 'Homemaker'],
  ])('"%s" is the %s activity, with no job title or employer', (activity, option) => {
    const p = { ...EMPLOYED, work_history: [{ ...JOBLESS, activity }] };
    expect(v(p, 'ircc_work_1_activity')).toBe(option);
    expect(val(p, 'ircc_work_1_title')).toEqual([]);
    expect(val(p, 'ircc_work_1_employer')).toEqual([]);
    expect(val(p, 'ircc_work_1_duties')).toEqual([]);
    expect(v(p, 'ircc_work_1_address_city')).toBe('Lahore');
    expect(left(p, '/activities').filter((n) => /Earlier work/.test(n.label))).toEqual([]);
  });

  it('a period missing a required piece is listed, never written', () => {
    const p = {
      ...EMPLOYED,
      work_history: [
        { from: '2012-01', to: '2018-06', activity: 'Clerk', city: 'Lahore', country: 'Pakistan' },
        { ...JOBLESS, address: undefined },
      ],
    };
    expect(val(p, 'ircc_work_1_row')).toEqual([]);
    expect(val(p, 'ircc_work_2_row')).toEqual([]);
    const notes = left(p, '/activities').filter((n) => /Earlier work/.test(n.label));
    expect(notes).toHaveLength(2);
    expect(notes[0].note).toMatch(/employer name/);
    expect(notes[0].note).toMatch(/duties/);
    expect(notes[1].note).toMatch(/full address/);
    expect(notes[1].note).not.toMatch(/employer/);
  });

  it('the current job in work_history is not added twice', () => {
    const p = {
      ...EMPLOYED,
      work_history: [
        CLERK,
        { from: '2020-01', to: 'present', activity: 'Bank manager', employer: 'Meezan Bank', city: 'Lahore', country: 'Pakistan' },
      ],
    };
    expect(val(p, 'ircc_work_1_row')).toHaveLength(1);
    expect(val(p, 'ircc_work_2_row')).toEqual([]);
    // same employer and start month, even with an end month recorded
    const q = {
      ...EMPLOYED,
      work_history: [CLERK, { ...CLERK, from: '2020-01', to: '2026-10', employer: 'Meezan Bank' }],
    };
    expect(val(q, 'ircc_work_2_row')).toEqual([]);
    expect(left(q, '/activities').filter((n) => /Earlier work/.test(n.label))).toEqual([]);
  });

  it('an open-ended latest period is the current one; an open earlier one is a gap', () => {
    const p = { work_history: [{ ...CLERK, to: undefined }, { ...JOBLESS, to: undefined }] };
    expect(val(p, 'ircc_work_1_row')).toEqual([]);
    const notes = left(p, '/activities').filter((n) => /Earlier work/.test(n.label));
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toMatch(/ended/);
  });

  it('rows past the cap are listed for the applicant', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...JOBLESS,
      from: `20${10 + i}-01`,
      to: `20${10 + i}-12`,
    }));
    const p = { work_history: many };
    expect(val(p, 'ircc_work_6_row')).toHaveLength(1);
    expect(val(p, 'ircc_work_7_row')).toEqual([]);
    const notes = left(p, '/activities').filter((n) => /Earlier work/.test(n.label));
    expect(notes.map((n) => n.label)).toEqual([
      'Earlier work period 7',
      'Earlier work period 8',
    ]);
  });

  it('the current job is matched by a normalized employer name and overlapping dates', () => {
    for (const employer of ['MEEZAN BANK LTD.', 'Meezan Bank Limited', 'meezan-bank (Pvt) Ltd', 'The Meezan Bank Co']) {
      const p = {
        ...EMPLOYED,
        work_history: [CLERK, { ...CLERK, from: '2019-11', to: '2026-09', employer }],
      };
      expect(val(p, 'ircc_work_2_row')).toEqual([]);
    }
    // an earlier stint at the same employer, ended before the current job, stays
    const earlier = {
      ...EMPLOYED,
      work_history: [{ ...CLERK, employer: 'Meezan Bank Ltd', from: '2012-01', to: '2018-06' }],
    };
    expect(val(earlier, 'ircc_work_1_row')).toHaveLength(1);
    // a different employer is a different job
    const other = {
      ...EMPLOYED,
      work_history: [{ ...CLERK, employer: 'Meezan Foods Ltd', from: '2012-01', to: '2018-06' }],
    };
    expect(val(other, 'ircc_work_1_row')).toHaveLength(1);
  });

  it('a retired applicant: the retirement period in work_history is the retired row', () => {
    const RETIRED = { retired: true, retirement_date: '2018-03-31' };
    const p = {
      ...RETIRED,
      work_history: [
        CLERK,
        { ...JOBLESS, activity: 'Retired', from: '2018-04', to: '2026-10' },
      ],
    };
    expect(val(p, 'ircc_work_1_row')).toHaveLength(1);
    expect(val(p, 'ircc_work_2_row')).toEqual([]);
    expect(left(p, '/activities').filter((n) => /Earlier work/.test(n.label))).toEqual([]);
    // ending this month is the current row even with no retirement date
    const month = new Date().toISOString().slice(0, 7);
    const q = {
      retired: true,
      work_history: [CLERK, { ...JOBLESS, activity: 'Retired', from: '2018-04', to: month }],
    };
    expect(val(q, 'ircc_work_2_row')).toEqual([]);
  });

  it('a homemaker: the homemaker period overlapping homemaker_since is not duplicated', () => {
    const p = {
      occupation: 'Homemaker',
      homemaker_since: '2015-01',
      work_history: [
        CLERK,
        { ...JOBLESS, activity: 'Homemaker', from: '2015-01', to: '2025-12' },
      ],
    };
    expect(val(p, 'ircc_work_2_row')).toEqual([]);
    // an older homemaker period, before homemaker_since, is its own row
    const q = {
      occupation: 'Homemaker',
      homemaker_since: '2020-01',
      work_history: [{ ...JOBLESS, activity: 'Homemaker', from: '2012-01', to: '2015-12' }, CLERK],
    };
    expect(val(q, 'ircc_work_1_row')).toHaveLength(1);
  });

  it('a study period is left for post-secondary education, not written as an activity', () => {
    const p = {
      ...EMPLOYED,
      work_history: [{ from: '2014-09', to: '2018-06', activity: 'Student', employer: 'University of the Punjab', city: 'Lahore', country: 'Pakistan' }],
    };
    expect(val(p, 'ircc_work_1_row')).toEqual([]);
    const notes = left(p, '/activities').filter((n) => /Earlier work/.test(n.label));
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toMatch(/post-secondary education/);
    expect(notes[0].note).not.toMatch(/missing/);
  });
});

describe('an earlier period piece recorded as "unknown" (review 2026-10-19)', () => {
  it('is never typed into IRCC: the row is left for the applicant', () => {
    const p = {
      employed: true,
      job_title: 'Trader',
      employer_name: 'Example Traders',
      employment_start_date: '2025-06',
      work_history: [
        { from: '2016-06', to: '2025-05', activity: 'unemployed', address: 'unknown', city: 'Gujrat', country: 'Pakistan' },
      ],
    };
    expect(val(p, 'ircc_work_1_row')).toEqual([]);
    expect(
      mapped(p).some((m) => typeof m.mappedValue === 'string' && /^unknown$/i.test(m.mappedValue)),
    ).toBe(false);
  });

  it('an "unknown" part inside an address object is not typed either', () => {
    const p = {
      employed: true,
      job_title: 'Trader',
      employer_name: 'Example Traders',
      employment_start_date: '2025-06',
      work_history: [
        { from: '2016-06', to: '2025-05', activity: 'unemployed', address: { street: 'unknown', city: 'Gujrat', country: 'Pakistan' } },
      ],
    };
    expect(
      mapped(p).some((m) => typeof m.mappedValue === 'string' && /^unknown$/i.test(m.mappedValue)),
    ).toBe(false);
  });

  it("a street line with commas keeps the period's own city (live 2026-10-19)", () => {
    const p = {
      employed: true,
      job_title: 'Trader',
      employer_name: 'Example Traders',
      employment_start_date: '2025-06',
      work_history: [
        { from: '2016-06', to: '2025-05', activity: 'unemployed', address: 'House 12, Street 4, Rehman Road', city: 'Gujrat', country: 'Pakistan' },
      ],
    };
    const by = (re: RegExp) => mapped(p).find((m) => /ircc_work_1/.test(m.fieldKey) && re.test(m.targetField))?.mappedValue;
    expect(by(/street/i)).toBe('House 12, Street 4, Rehman Road');
    expect(by(/city/i)).toBe('Gujrat');
  });

  it('a full line that agrees with the city is split; Canadian lines keep province and postal code', () => {
    const row = (e: Record<string, unknown>) => ({
      employed: true,
      job_title: 'Trader',
      employer_name: 'Example Traders',
      employment_start_date: '2025-06',
      work_history: [{ from: '2016-06', to: '2025-05', activity: 'unemployed', ...e }],
    });
    const by = (p: Record<string, unknown>, re: RegExp) =>
      mapped(p).find((m) => /ircc_work_1/.test(m.fieldKey) && re.test(m.targetField))?.mappedValue;
    const pk = row({ address: '12 Mall Road, Gujrat, Pakistan', city: 'Gujrat' });
    expect(by(pk, /street/i)).toBe('12 Mall Road');
    expect(by(pk, /city/i)).toBe('Gujrat');
    expect(by(pk, /country/i)).toBeTruthy();
    const ca = row({ address: '123 Main St, Toronto, ON M5V 2T6', city: 'Toronto', country: 'Canada' });
    expect(val(ca, 'ircc_work_1_row')).not.toEqual([]);
    expect(mapped(ca).some((m) => /ircc_work_1/.test(m.fieldKey) && m.mappedValue === 'M5V 2T6')).toBe(true);
  });
});
