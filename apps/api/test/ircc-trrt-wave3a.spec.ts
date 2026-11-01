/**
 * tr-rt wave 3a, from the live probe of 2026-10-31 (a real tr-rt draft,
 * nothing submitted). Only ids recorded live are written; a missing selector
 * halts the whole fill:
 *  1. US Green Card: "Yes" reveals no number or expiry field and routes to
 *     "you don't need to apply for anything" — Yes is never written, the
 *     applicant is told they need no visa or eTA (fill note + Forms note);
 *  2. residence rows for every status (Worker + ongoing + To SAVED; past
 *     Other + details + From/To SAVED), earlier residences as past rows;
 *  3. workMedicalJobs on the medical page, shown for some residence rows;
 *  4. a non-passport travel document: 250 + its kind + who issued it;
 *  5. the tourist (470) flow has no /inviter-info page: no note sends a
 *     tourist there.
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
import { workMedicalJobsShown } from '../src/modules/automation/portal-fills/canada-ircc';
import { IRCC_PORTAL_ANSWERS } from './fixtures/ircc-portal-answers';

const trv = () => resolvePortalFill('ircc')!;
const TRV = { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' };
const TR_RT_ROUTES = [
  TRV,
  { country: 'CA', visaaiId: 'ca-super-visa' },
  { country: 'CA', visaaiId: 'ca-business-visitors' },
];

const BASE: Record<string, unknown> = {
  given_name: 'Nadia',
  family_name: 'Rehmani',
  date_of_birth: '1987-03-14',
  nationality: 'PAK',
  passport_number: 'KL3344556',
  purpose_of_visit: 'tourism',
  planned_entry_date: '2027-05-02',
  planned_departure_date: '2027-05-25',
  residence_since: 'since birth',
  residential_address: '12 Mall Road, Lahore, Pakistan',
};

const values = (p: Record<string, unknown>) =>
  applyPrefillOverrides(trv(), { ...BASE, ...p }, []);
const mapped = (p: Record<string, unknown>) =>
  buildMappingInputs(trv(), values(p));
const targets = (p: Record<string, unknown>, page?: string) =>
  mapped(p)
    .filter((x) => !page || x.page === page)
    .map((x) => x.targetField);
const at = (p: Record<string, unknown>, target: string, page?: string) =>
  mapped(p).find((x) => x.targetField === target && (!page || x.page === page))
    ?.mappedValue;
const left = (p: Record<string, unknown>, page: string) =>
  portalFillCoverage(trv(), values(p)).pages.find((x) => x.page === page)
    ?.left ?? [];
const noteOf = (p: Record<string, unknown>, page: string, label: string) =>
  left(p, page).find((l) => l.label === label);

const answers = (p: Record<string, unknown>) => ({
  purpose_of_visit: 'tourism',
  employed: false,
  planned_entry_date: '2027-05-02',
  planned_departure_date: '2027-05-25',
  passport_type: 'Regular',
  us_permanent_resident: false,
  has_valid_us_visa: false,
  previously_visited_canada: 'No',
  uses_representative: false,
  nationality: 'Pakistan',
  ...IRCC_PORTAL_ANSWERS,
  ...p,
});
const missing = (p: Record<string, unknown>, route = TRV) =>
  missingIntakeFacts(answers(p), route).map((s) => s.key);

function ctx(profile: Record<string, unknown>, route = TRV): FinalizeContext {
  return {
    applicantName: 'NADIA REHMANI',
    profile,
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route,
  };
}
const GENERATED: PrefilledFormField[] = [
  { key: 'family_name', label: 'family_name', value: 'REHMANI', group: 'Personal', source: 'profile' },
];
const form = (p: Record<string, unknown>, route = TRV) =>
  finalizeFields(GENERATED, ctx(p, route));

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

// ── 1. US Green Card ────────────────────────────────────────────────────────
describe('US Green Card: no visa needed (live 2026-10-31)', () => {
  const GC = {
    us_permanent_resident: true,
    us_green_card_number: '987654321',
    us_green_card_expiry_date: '2032-08-01',
  };

  it('Yes is never written, nor any number or expiry control', () => {
    const t = targets(GC, '/bio-data-travel-docs');
    expect(t.some((s) => s.startsWith('#hasGreenCard'))).toBe(false);
    expect(t.some((s) => /greenCardNum|dateExpiryGreenCard/.test(s))).toBe(false);
  });

  it('the travel-document note tells them they need no visa or eTA', () => {
    const l = noteOf(GC, '/bio-data-travel-docs', 'Green Card');
    expect(l?.reason).toBe('fill_yourself');
    expect(l?.note).toMatch(/needs no visitor visa and no eTA/);
  });

  it.each(TR_RT_ROUTES)('intake never asks the card number or expiry on tr-rt (%o)', (route) => {
    const m = missing({ us_permanent_resident: true }, route);
    expect(m).not.toContain('us_green_card_number');
    expect(m).not.toContain('us_green_card_expiry_date');
  });

  it('No is still written', () => {
    expect(at({ us_permanent_resident: false }, '#hasGreenCard_radio-button-02-input')).toBeDefined();
    expect(noteOf({ us_permanent_resident: false }, '/bio-data-travel-docs', 'Green Card')).toBeUndefined();
  });

  it('Forms page: a Yes carries the no-visa note; a No none', () => {
    const yes = form({ us_permanent_resident: true }).find((f) => f.key === 'us_permanent_resident');
    expect(yes?.note).toMatch(/needs no visitor visa and no eTA/);
    expect(yes?.needsReview).toBe(true);
    const no = form({ us_permanent_resident: false }).find((f) => f.key === 'us_permanent_resident');
    expect(no?.note ?? '').not.toMatch(/visitor visa/);
  });
});

// ── 2. residence rows ───────────────────────────────────────────────────────
describe('residence rows for every status, earlier ones as past rows', () => {
  const RIYADH = {
    residential_address: 'Building 4, King Fahd Road, Riyadh, Saudi Arabia',
    residence_since: '2019-03-01',
  };

  // Live 2026-10-31: To stays visible with "ongoing" ticked, and a Worker
  // row ongoing without To did not save. Only Citizen / PR rows (saved live
  // before) go without To; every other status needs its valid-until date.
  it.each([
    ['Refugee claimant', 'Refugee Claimant'],
    ['Protected person', 'Protected Person'],
    ['Foreign national', 'Foreign National'],
  ])('"%s" without a valid-until date: no row; the note asks for it', (said) => {
    const p = { ...RIYADH, residence_status: said };
    expect(at(p, '#otherCountriesResidences_add_button')).toBeUndefined();
    expect(noteOf(p, '/contact-info', 'Countries of residence')?.note).toMatch(
      /valid until \(the date your status ends\)/,
    );
  });

  it.each([
    ['Refugee claimant', 'Refugee Claimant'],
    ['Protected person', 'Protected Person'],
    ['Foreign national', 'Foreign National'],
  ])('"%s" with its valid-until date: ongoing and To', (said, option) => {
    const p = { ...RIYADH, residence_status: said, residence_status_valid_until: '2028-06-30' };
    expect(at(p, '#statusResidence_select')).toBe(option);
    expect(targets(p).filter((s) => s === '#ongoing_chk-input')).toHaveLength(1);
    expect(at(p, '#datesToResidenceYear_sltDateYear')).toBe('2028');
    expect(noteOf(p, '/contact-info', 'Countries of residence')).toBeUndefined();
  });

  it('"Other": details and To only with the valid-until date', () => {
    const other = { ...RIYADH, residence_status: 'Other', residence_status_details: 'Dependent visa' };
    expect(at(other, '#otherCountriesResidences_add_button')).toBeUndefined();
    expect(noteOf(other, '/contact-info', 'Countries of residence')?.note).toMatch(
      /status Other \(Dependent visa\), since 2019-03-01, valid until \(the date your status ends\)/,
    );
    const dated = { ...other, residence_status_valid_until: '2027-04-30' };
    expect(at(dated, '#statusResidence_select')).toBe('Other');
    expect(at(dated, '#statusResidenceDetail_input')).toBe('Dependent visa');
    expect(at(dated, '#ongoing_chk-input')).toBeDefined();
    expect(at(dated, '#datesToResidenceYear_sltDateYear')).toBe('2027');
  });

  it('Citizen / PR: ongoing, no To (unchanged)', () => {
    const pr = { ...RIYADH, residence_status: 'Permanent resident', residence_status_valid_until: '2030-01-01' };
    expect(at(pr, '#statusResidence_select')).toBe('Permanent resident');
    expect(at(pr, '#datesToResidenceYear_sltDateYear')).toBeUndefined();
  });

  it.each(['Refugee claimant', 'Foreign national', 'Other', 'Protected person', 'Worker'])(
    'intake asks the valid-until date for "%s"',
    (status) => {
      const p = { ...RIYADH, residence_status: status, residence_status_details: 'x' };
      expect(missing(p)).toContain('residence_status_valid_until');
      expect(missing({ ...p, residence_status_valid_until: '2028-01-01' })).not.toContain(
        'residence_status_valid_until',
      );
    },
  );

  it.each(['Citizen', 'Permanent resident'])('intake does not ask it for "%s"', (status) => {
    expect(missing({ ...RIYADH, residence_status: status })).not.toContain('residence_status_valid_until');
  });

  it('a visitor whose end date is not after the start date: no row', () => {
    const p = { ...RIYADH, residence_status: 'Visitor', residence_status_valid_until: '2018-01-01' };
    expect(at(p, '#otherCountriesResidences_add_button')).toBeUndefined();
  });

  it('a past "Other" row (live SAVED shape): details, From and To, not ongoing', () => {
    const p = {
      lived_elsewhere_last_5_years: true,
      previous_countries_of_residence: [
        { country: 'Saudi Arabia', status: 'Dependent visa', from: '2015-01-01', to: '2018-12-31' },
      ],
    };
    const row = mapped(p).filter((x) => x.fieldKey.startsWith('ircc_earlier_residence_1_'));
    const v = (t: string) => row.find((x) => x.targetField === t)?.mappedValue;
    expect(v('#statusResidence_select')).toBe('Other');
    expect(v('#statusResidenceDetail_input')).toBe('Dependent visa');
    expect(v('#datesFromResidenceYear_sltDateYear')).toBe('2015');
    expect(v('#datesToResidenceYear_sltDateYear')).toBe('2018');
    expect(row.some((x) => x.targetField === '#ongoing_chk-input')).toBe(false);
    expect(row.some((x) => x.targetField === '#countryOfResidence_save_button')).toBe(true);
  });

  it('a row with a month-only date or literally "Other" without details is a note, not a row', () => {
    const p = {
      lived_elsewhere_last_5_years: true,
      previous_countries_of_residence: [
        { country: 'Oman', status: 'Worker', from: '2016-04', to: '2018-09' },
        { country: 'Qatar', status: 'Other', from: '2014-01-01', to: '2015-06-30' },
      ],
    };
    expect(mapped(p).some((x) => x.fieldKey.startsWith('ircc_earlier_residence_'))).toBe(false);
    const note = noteOf(p, '/contact-info', 'Earlier countries of residence')?.note;
    expect(note).toContain('Oman');
    expect(note).toContain('Qatar');
  });

  it('at most 4 earlier rows; the 5th goes to the note', () => {
    const rows = ['Oman', 'Qatar', 'Kuwait', 'Bahrain', 'Jordan'].map((country, i) => ({
      country,
      status: 'Worker',
      from: `${2010 + i * 2}-01-01`,
      to: `${2011 + i * 2}-06-30`,
    }));
    const p = { lived_elsewhere_last_5_years: true, previous_countries_of_residence: rows };
    expect(mapped(p).some((x) => x.fieldKey.startsWith('ircc_earlier_residence_4_'))).toBe(true);
    expect(mapped(p).some((x) => x.fieldKey.startsWith('ircc_earlier_residence_5_'))).toBe(false);
    expect(noteOf(p, '/contact-info', 'Earlier countries of residence')?.note).toContain('Jordan');
  });
});

// ── 3. workMedicalJobs ──────────────────────────────────────────────────────
describe('workMedicalJobs (/medical-background-questions)', () => {
  const RADIO = '#workMedicalJobs_radio-button-01-input';
  const DUBAI_WORKER = {
    residential_address: 'Villa 8, Street 3, Al Quoz, Dubai, United Arab Emirates',
    residence_since: '2019-03-01',
    residence_status: 'Worker',
    residence_status_valid_until: iso(NOW + 400 * DAY),
    medical_exam_last_12_months: false,
  };
  const label = 'Work in a job where public health must be protected';

  it('a UAE worker with no recent exam: shown; the explicit Yes is written', () => {
    expect(workMedicalJobsShown({ ...BASE, ...DUBAI_WORKER })).toBe('shown');
    expect(at({ ...DUBAI_WORKER, work_in_public_health_job: true }, RADIO)).toBeDefined();
    expect(
      at({ ...DUBAI_WORKER, public_health_occupation: false }, '#workMedicalJobs_radio-button-02-input'),
    ).toBeDefined();
  });

  it('shown without an answer: nothing written, the applicant is asked', () => {
    expect(targets(DUBAI_WORKER).some((t) => t.startsWith('#workMedicalJobs'))).toBe(false);
    const l = noteOf(DUBAI_WORKER, '/medical-background-questions', label);
    expect(l?.reason).toBe('needs_your_answer');
  });

  it('never written when IRCC does not show it', () => {
    const cases: Record<string, unknown>[] = [
      // A citizen at home: the row has no To date.
      { medical_exam_last_12_months: false, work_in_public_health_job: true },
      // A recent exam: the question follows "No" only.
      { ...DUBAI_WORKER, medical_exam_last_12_months: true, work_in_public_health_job: true },
      // A worker in Malaysia, a Medical_Required_Countries country.
      {
        ...DUBAI_WORKER,
        residential_address: '3 Jalan Ampang, Kuala Lumpur, Malaysia',
        work_in_public_health_job: true,
      },
      // An earlier row that ended more than a year ago.
      {
        medical_exam_last_12_months: false,
        work_in_public_health_job: true,
        lived_elsewhere_last_5_years: true,
        previous_countries_of_residence: [
          { country: 'Oman', status: 'Worker', from: iso(NOW - 900 * DAY), to: iso(NOW - 500 * DAY) },
        ],
      },
    ];
    for (const p of cases) {
      expect(targets(p).some((t) => t.startsWith('#workMedicalJobs'))).toBe(false);
      expect(noteOf(p, '/medical-background-questions', label)).toBeUndefined();
    }
  });

  it('an earlier row ending within the year, 180+ days long, triggers it', () => {
    const p = {
      medical_exam_last_12_months: false,
      work_in_public_health_job: false,
      lived_elsewhere_last_5_years: true,
      previous_countries_of_residence: [
        { country: 'Oman', status: 'Worker', from: iso(NOW - 500 * DAY), to: iso(NOW - 60 * DAY) },
      ],
    };
    expect(at(p, '#workMedicalJobs_radio-button-02-input')).toBeDefined();
  });

  it('near the one-year limit: not written, an "If IRCC asks" note', () => {
    const p = {
      medical_exam_last_12_months: false,
      work_in_public_health_job: true,
      lived_elsewhere_last_5_years: true,
      previous_countries_of_residence: [
        { country: 'Oman', status: 'Worker', from: iso(NOW - 800 * DAY), to: iso(NOW - 365 * DAY) },
      ],
    };
    expect(targets(p).some((t) => t.startsWith('#workMedicalJobs'))).toBe(false);
    expect(noteOf(p, '/medical-background-questions', label)?.note).toMatch(/^If IRCC asks/);
  });

  it.each(TR_RT_ROUTES)('intake asks it only when such a row is written (%o)', (route) => {
    expect(missing(DUBAI_WORKER, route)).toContain('work_in_public_health_job');
    expect(missing({ ...DUBAI_WORKER, medical_exam_last_12_months: true }, route)).not.toContain(
      'work_in_public_health_job',
    );
    expect(missing({ medical_exam_last_12_months: false }, route)).not.toContain(
      'work_in_public_health_job',
    );
  });

  it('Forms page: asked only then', () => {
    expect(form({ ...DUBAI_WORKER, nationality: 'Pakistan' }).some((f) => f.key === 'work_in_public_health_job')).toBe(true);
    expect(form({ medical_exam_last_12_months: false }).some((f) => f.key === 'work_in_public_health_job')).toBe(false);
  });
});

// ── 4. other travel document ────────────────────────────────────────────────
describe('travel document "Other" (250): kind and issuer (live 2026-10-31)', () => {
  const DOC = {
    passport_number: 'RT5566778',
    passport_issue_date: '2024-05-01',
    passport_expiry_date: '2029-04-30',
  };
  const page = '/bio-data-travel-docs';

  it.each([
    ['Refugee travel document', '07'],
    ['Convention travel document (1951)', '07'],
    ['Certificate of identity', '06'],
    ['Red Cross travel document', '08'],
    ['UN laissez-passer', '09'],
    ['OAS travel document', '13'],
  ])('"%s" → 250 and %s', (kind, code) => {
    const p = { ...DOC, passport_type: kind };
    expect(at(p, '#travelDocument_radio-button-250-input', page)).toBeDefined();
    expect(at(p, `#otherDocumentType_radio-button-${code}-input`, page)).toBeDefined();
    expect(targets(p, page)).not.toContain('#travelDocument_radio-button-249-input');
    expect(targets(p, page)).not.toContain('#otherDocumentType_radio-button-097-input');
  });

  it('the issuer is written only from its own answer, never the nationality', () => {
    const p = { ...DOC, passport_type: 'Refugee travel document' };
    expect(at(p, '#travelDocumentIssuedBy_select', page)).toBeUndefined();
    for (const k of ['passport_issuing_country', 'issuing_country', 'passport_country'])
      expect(at({ ...p, [k]: 'Germany' }, '#travelDocumentIssuedBy_select', page)).toBeUndefined();
    expect(
      at({ ...p, travel_document_issuing_country: 'Germany' }, '#travelDocumentIssuedBy_select', page),
    ).toBe('024');
    expect(at({ ...p, travel_document_issuing_country: 'Germany' }, '#travelDocumentIssuedBy_select', page)).toBe('024');
    expect(noteOf({ ...p, travel_document_issuing_country: 'Germany' }, page, 'Travel document')?.note).toContain(
      'issued by Germany',
    );
  });

  it.each(['Travel document for stateless persons', 'Laissez-passer', 'Other travel document'])(
    '"%s" is not clear: nothing on the page, the note as before',
    (kind) => {
      const p = { ...DOC, passport_type: kind };
      expect(targets(p, page).some((t) => /travelDocument_radio|otherDocumentType/.test(t))).toBe(false);
      expect(noteOf(p, page, 'Travel document')?.note).toMatch(/choose "Other" as the type of travel document yourself/);
    },
  );
});

// ── 5. tourist: no /inviter-info ────────────────────────────────────────────
describe('tourist (470): no note about an invitation page', () => {
  it('a tourist with no host gets no /inviter-info note', () => {
    expect(
      noteOf({ accommodation_provider_name: 'Lakeview Inn' }, '/inviter-info', 'Who you will visit or where you will stay'),
    ).toBeUndefined();
  });
  it('a non-tourist with no host still does', () => {
    expect(
      noteOf({ purpose_of_visit: 'medical treatment' }, '/inviter-info', 'Who you will visit or where you will stay'),
    ).toBeDefined();
  });
});
