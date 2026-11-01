/**
 * eTA yes/no audit, 2026-10-19: every answer the interview accepts is one the
 * mapping can write, and every field a "Yes" reveals is either written or
 * named for the applicant.
 *
 *  1. A refusal or criminality "No" kept under a narrower alias is not the
 *     answer: the interview asks the whole question.
 *  2. Listed conditions "Yes" → which condition.
 *  3. Travel date known "Yes" → arrival hour and minute; time zone noted.
 *  4. Occupation group asked when the answers do not name one.
 *  5. UCI "I don't know" → a note, not a bare blank.
 *  6. Representative free text; additional citizenship; refusal details
 *     under any "Yes"; a visa number as the previous-application answer.
 *  7. Eligibility reads the visitor-visa interview's 10-year visa key.
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import '../src/modules/automation/portal-fills/canada-ircc-eta'; // registers 'ircc-eta'
import {
  CA_ETA_VISAAI_ID,
  ETA_OCCUPATION_GROUPS,
  missingIntakeFacts,
  intakeFactGap,
  IRCC_ETA_FACTS,
} from '@visaai/types';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import { arrivalTime } from '../src/modules/automation/portal-fills/canada-ircc-eta';
import { refusalDetails } from '../src/modules/automation/portal-fills/canada-ircc';
import { ETA_OCCUPATION_OPTIONS } from '../src/modules/automation/portal-fills/eta-occupations';
import { assessEtaEligibility } from '../src/strategies/visa-program/eta.strategy';

const mapping = () => resolvePortalFill('ircc-eta')!;
const id = (suffix: string) => `[id="applicationDetails.${suffix}"]`;
const writes = (p: Record<string, unknown>) =>
  buildMappingInputs(mapping(), p).map(
    (i) => [i.targetField, i.mappedValue] as [string, string],
  );
const at = (p: Record<string, unknown>, sel: string) =>
  writes(p).find(([f]) => f === sel)?.[1];
const left = (p: Record<string, unknown>) =>
  portalFillCoverage(mapping(), p).pages.flatMap((pg) => pg.left);
const leftLabels = (p: Record<string, unknown>) => left(p).map((n) => n.label);
const ETA = { country: 'CA', visaaiId: CA_ETA_VISAAI_ID };
const TRV = { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' };
const asks = (p: Record<string, unknown>, ctx = ETA) =>
  missingIntakeFacts(p, ctx).map((s) => s.key);
const spec = (key: string) => IRCC_ETA_FACTS.find((f) => f.key === key)!;

const BG = {
  refused: id('backgroundQuestions_refusedVisaOrPermitOrDeniedEntryToCanada'),
  refusedDetails: id(
    'backgroundQuestions_refusedVisaOrPermitOrDeniedEntryToCanadaDetails',
  ),
  criminal: id(
    'backgroundQuestions_committedOrArrestedOrChargedOrConvictedOfCriminalOffenceAnywhere',
  ),
  conditions: id('backgroundQuestions_doYouHaveOneOfTheseConditions'),
};
const HOUR = id('travelDetails_travelDateTimeHour');
const MINUTE = id('travelDetails_travelDateTimeMinute');
const OCCUPATION = id('employmentDetails_occupation');
const EMPLOYER = id('employmentDetails_companyEmployerSchoolFacilityName');
const UCI = id('personalDetails_uci');
const APPLIED = id('personalDetails_hasPreviouslyAppliedToCanada');
const REP = '[id="welcome_isRepresentative"]';

describe('1. refusal and criminality: an alias "no" is not the whole answer', () => {
  it.each([
    'previous_visa_refused',
    'has_prior_refusal',
    'prior_visa_refusal',
    'visa_refused',
    'refused_visa',
  ])('refusal alias %s = No → asked; the mapping leaves it blank', (alias) => {
    const p = { [alias]: false };
    expect(asks(p)).toContain('refused_visa_or_denied_entry');
    expect(intakeFactGap(p, spec('refused_visa_or_denied_entry'))).toMatch(
      /whole question/,
    );
    expect(at(p, BG.refused)).toBeUndefined();
  });

  it.each([
    'criminal_record',
    'committed_crime',
    'criminal_charges_or_convictions',
    'has_criminal_record',
  ])('criminal alias %s = No → asked; the mapping leaves it blank', (alias) => {
    const p = { [alias]: false };
    expect(asks(p)).toContain('criminal_offence');
    expect(at(p, BG.criminal)).toBeUndefined();
  });

  it('an alias "yes" answers it, and the mapping writes Yes', () => {
    const p = { visa_refused: true, criminal_record: 'yes' };
    expect(asks(p)).not.toContain('refused_visa_or_denied_entry');
    expect(asks(p)).not.toContain('criminal_offence');
    expect(at(p, BG.refused)).toBe('Yes');
    expect(at(p, BG.criminal)).toBe('Yes');
  });

  it('the canonical "no" answers it, and the mapping writes No', () => {
    const p = {
      previous_visa_refused: false,
      refused_visa_or_denied_entry: false,
      criminal_record: false,
      criminal_offence: false,
    };
    expect(asks(p)).not.toContain('refused_visa_or_denied_entry');
    expect(asks(p)).not.toContain('criminal_offence');
    expect(at(p, BG.refused)).toBe('No');
    expect(at(p, BG.criminal)).toBe('No');
  });

  it('every answer the interview accepts is one the mapping writes', () => {
    for (const [key, sel] of [
      ['refused_visa_or_denied_entry', BG.refused],
      ['criminal_offence', BG.criminal],
    ] as const) {
      const s = spec(key);
      for (const k of [s.key, ...(s.aliases ?? [])])
        for (const v of [true, false]) {
          const p = { [k]: v };
          if (!asks(p).includes(key)) expect(at(p, sel)).toBeDefined();
        }
    }
  });
});

describe('2. listed conditions: which one', () => {
  it('a "yes" asks which condition; a "no" does not', () => {
    expect(asks({ eta_medical_conditions: true })).toContain(
      'eta_medical_condition',
    );
    expect(asks({ eta_medical_conditions: false })).not.toContain(
      'eta_medical_condition',
    );
  });

  it.each([
    ['Untreated syphilis', 'Untreated syphilis'],
    ['syphilis', 'Untreated syphilis'],
    ['untreated drug or alcohol addiction.', 'Untreated drug or alcohol addiction'],
    ['Drug or alcohol addiction', 'Untreated drug or alcohol addiction'],
    [
      'an untreated mental health condition with psychosis',
      'Untreated mental health condition with psychosis',
    ],
  ])('Yes + %p → %p', (which, option) => {
    expect(
      at({ eta_medical_conditions: true, eta_medical_condition: which }, BG.conditions),
    ).toBe(option);
  });

  it.each(['alcohol addiction', 'syphilis and addiction', 'yes', ''])(
    'Yes + %p → blank, and named for the applicant',
    (which) => {
      const p = { eta_medical_conditions: true, eta_medical_condition: which };
      expect(at(p, BG.conditions)).toBeUndefined();
      expect(leftLabels(p)).toContain('Which listed health condition');
    },
  );

  it('No → None of the above, no note; the follow-up never overrides a no', () => {
    const p = { eta_medical_conditions: false, eta_medical_condition: 'syphilis' };
    expect(at(p, BG.conditions)).toBe('None of the above');
    expect(leftLabels(p)).not.toContain('Which listed health condition');
  });
});

describe('3. travel date known: arrival hour and minute', () => {
  const known = { travel_date_known: true, planned_entry_date: '2026-12-01' };

  it('Yes asks the arrival time; No does not', () => {
    expect(asks({ travel_date_known: true })).toContain('planned_entry_time');
    expect(asks({ travel_date_known: false })).not.toContain('planned_entry_time');
  });

  it.each([
    ['14:30', '14', '30'],
    ['9:05', '09', '05'],
    ['2:30 pm', '14', '30'],
    ['12:15 AM', '00', '15'],
    ['14h30', '14', '30'],
  ])('Yes + %p → hour %p, minute %p; the time zone is noted', (t, h, m) => {
    const p = { ...known, planned_entry_time: t };
    expect(at(p, HOUR)).toBe(h);
    expect(at(p, MINUTE)).toBe(m);
    const labels = leftLabels(p);
    expect(labels).toContain('Time zone of your flight');
    expect(labels).not.toContain('Time and time zone of your flight');
  });

  it('a time on the stored entry date is used', () => {
    expect(arrivalTime({ planned_entry_date: '2026-12-01T07:45' })).toEqual({
      hour: '07',
      minute: '45',
    });
  });

  it.each(["I don't know", '25:00', '13:00 pm', 'evening'])(
    'Yes + %p → no time written; time and zone noted',
    (t) => {
      const p = { ...known, planned_entry_time: t };
      expect(at(p, HOUR)).toBeUndefined();
      expect(at(p, MINUTE)).toBeUndefined();
      expect(leftLabels(p)).toContain('Time and time zone of your flight');
    },
  );

  it('No → no time written and no time note', () => {
    const p = { travel_date_known: false, planned_entry_time: '14:30' };
    expect(at(p, HOUR)).toBeUndefined();
    expect(leftLabels(p).some((l) => /time zone/i.test(l))).toBe(false);
  });
});

describe('4. occupation group', () => {
  it('the interview lists exactly the mapping options', () => {
    expect([...ETA_OCCUPATION_GROUPS]).toEqual([...ETA_OCCUPATION_OPTIONS]);
  });

  it('a worker is asked the group; retired, homemaker, unemployed or a student are not', () => {
    expect(asks({ occupation: 'employed', job_title: 'Barista' })).toContain(
      'eta_occupation_group',
    );
    for (const p of [
      { occupation: 'Retired' },
      { occupation: 'homemaker' },
      { occupation: 'unemployed' },
      { occupation: 'Student' },
      { occupation: 'Sales and service occupations' },
    ])
      expect(asks(p)).not.toContain('eta_occupation_group');
  });

  it('an undetermined occupation + the group answer → group and follow-ups written', () => {
    const p = {
      occupation: 'former teacher, now consulting',
      eta_occupation_group: 'Business, finance and administration occupations',
      employer_name: 'Acme Ltd',
    };
    expect(at(p, OCCUPATION)).toBe(
      'Business, finance and administration occupations',
    );
    expect(at(p, EMPLOYER)).toBe('Acme Ltd');
  });

  it('the group without "occupations" still names it', () => {
    expect(at({ eta_occupation_group: 'Health' }, OCCUPATION)).toBe(
      'Health occupations',
    );
  });

  it('no group answer and an undetermined occupation → blank, follow-ups blank, noted', () => {
    const p = { occupation: 'former teacher', employer_name: 'Acme Ltd' };
    expect(at(p, OCCUPATION)).toBeUndefined();
    expect(at(p, EMPLOYER)).toBeUndefined();
    expect(leftLabels(p)).toContain('Occupation');
  });

  it('a group answer that is not on the list → blank', () => {
    expect(at({ eta_occupation_group: 'Engineering' }, OCCUPATION)).toBeUndefined();
  });
});

describe('5. UCI', () => {
  it('Yes + "I don\'t know" → left blank with a gentle optional note (live 2026-10-19: optional)', () => {
    const p = { previous_canada_application: true, uci: "I don't know" };
    expect(at(p, UCI)).toBeUndefined();
    const n = left(p).find((x) => x.label === 'Unique client identifier (UCI)');
    expect(n?.reason).toBe('fill_yourself');
    expect(n?.note).toMatch(/^Optional/);
    expect(n?.note).toMatch(/leave it empty/);
    expect(n?.note).not.toMatch(/when IRCC allows/);
  });

  it('Yes + a number → written, no note', () => {
    const p = { previous_canada_application: true, uci: '1234-5678' };
    expect(at(p, UCI)).toBe('1234-5678');
    expect(leftLabels(p)).not.toContain('Unique client identifier (UCI)');
  });

  it('No → no UCI and no note', () => {
    const p = { previous_canada_application: false, uci: "I don't know" };
    expect(at(p, UCI)).toBeUndefined();
    expect(leftLabels(p)).not.toContain('Unique client identifier (UCI)');
  });
});

describe('6. P1 gaps', () => {
  it.each([
    ['myself', 'No'],
    ['just me', 'No'],
    ['for me only', 'No'],
    ["I'm applying for myself", 'No'],
    ['On behalf of my son', 'Yes'],
    ['for my daughter', 'Yes'],
    ['for someone else', 'Yes'],
  ])('representative: %p → %p', (said, yn) => {
    expect(at({ applying_on_behalf: said }, REP)).toBe(yn);
  });

  it.each(['for me and my son', 'not sure'])(
    'representative: %p → blank',
    (said) => {
      expect(at({ applying_on_behalf: said }, REP)).toBeUndefined();
    },
  );

  describe('additional citizenship', () => {
    it('is asked, and a "no other citizenship" answers it', () => {
      expect(asks({})).toContain('other_citizenships');
      expect(asks({ other_citizenships: [] })).not.toContain('other_citizenships');
      expect(asks({ multiple_citizenship: false })).not.toContain(
        'other_citizenships',
      );
    });

    const ADDITIONAL = id('personalDetails_additionalCitizenship');

    it('none → nothing written, no note (the field is optional)', () => {
      const p = { nationality: 'GBR', other_citizenships: [] };
      expect(at(p, ADDITIONAL)).toBeUndefined();
      expect(leftLabels(p)).not.toContain('Additional citizenship');
    });

    it('one → chosen from the nationality list (live 2026-10-19), no note', () => {
      const p = { nationality: 'GBR', other_citizenships: ['Ireland'] };
      expect(at(p, ADDITIONAL)).toBe('Ireland');
      expect(leftLabels(p)).not.toContain('Additional citizenship');
    });

    it('the passport nationality is not on the list: the other one is chosen', () => {
      const p = { nationality: 'GBR', other_citizenships: ['United Kingdom', 'Pakistan'] };
      expect(at(p, ADDITIONAL)).toBe('Pakistan');
      expect(leftLabels(p)).not.toContain('Additional citizenship');
    });

    it('two → the first is chosen, the second noted as not fitting', () => {
      const p = {
        nationality: 'GBR',
        other_citizenships: [{ country: 'Ireland' }, { country: 'Pakistan' }],
      };
      expect(at(p, ADDITIONAL)).toBe('Ireland');
      const n = left(p).find((x) => x.label === 'Additional citizenship');
      expect(n?.note).toMatch(/only one additional citizenship/);
      expect(n?.note).toMatch(/Pakistan/);
    });

    it('not answered → a gentle optional note', () => {
      const n = left({}).find((x) => x.label === 'Additional citizenship');
      expect(n?.note).toMatch(/^Optional/);
    });
  });

  describe('refusal details under any "Yes"', () => {
    const record = {
      previous_visa_refusal_country: 'United States',
      previous_visa_refusal_date: '2019-05-01',
      previous_visa_refusal_reason: 'insufficient ties',
    };

    it.each([
      ['denied_entry', true],
      ['refused_by_canada', true],
      ['ordered_to_leave', true],
      ['refused_visa', true],
    ])('Yes via %s → the record is written', (key, v) => {
      const p = { ...record, [key]: v };
      expect(at(p, BG.refused)).toBe('Yes');
      expect(at(p, BG.refusedDetails)).toMatch(/United States/);
    });

    it('tr-rt: Yes via denied entry → the record is used', () => {
      expect(refusalDetails({ ...record, denied_entry: true })).toMatch(
        /United States/,
      );
    });

    it('No → no details', () => {
      const p = { ...record, refused_visa_or_denied_entry: false };
      expect(at(p, BG.refusedDetails)).toBeUndefined();
      expect(refusalDetails({ ...record, denied_entry: false })).toBeUndefined();
    });
  });

  describe('previous_canadian_visa holding a number', () => {
    it('is a "Yes", and the number fills the UCI', () => {
      const p = { previous_canadian_visa: '1234-5678' };
      expect(at(p, APPLIED)).toBe('Yes');
      expect(at(p, UCI)).toBe('1234-5678');
      expect(asks(p)).not.toContain('previous_canada_application');
    });

    it('a description that is not a number is asked again', () => {
      const p = { previous_canadian_visa: 'visitor visa in 2019' };
      expect(at(p, APPLIED)).toBeUndefined();
      expect(asks(p)).toContain('previous_canada_application');
    });

    it('No is No', () => {
      const p = { previous_canadian_visa: false };
      expect(at(p, APPLIED)).toBe('No');
      expect(asks(p)).not.toContain('previous_canada_application');
    });
  });
});

describe('7. eligibility reads the visitor-visa interview\'s 10-year visa key', () => {
  const MX = { nationality: 'Mexico', travel_by_air: true };

  it.each(['held_canadian_visa_10_years', 'held_canadian_visitor_visa'])(
    '%s = Yes → eligible with the Canadian-visa reason',
    (key) => {
      const r = assessEtaEligibility({ ...MX, [key]: true });
      expect(r.status).toBe('eligible');
      expect(r.reason).toMatch(/held a Canadian visitor visa/);
    },
  );

  it('held_canadian_visa_10_years = No and no U.S. visa → ineligible', () => {
    const r = assessEtaEligibility({
      ...MX,
      held_canadian_visa_10_years: false,
      valid_us_nonimmigrant_visa: false,
    });
    expect(r.status).toBe('ineligible');
  });
});

describe('scope: none of these questions reach the visitor visa', () => {
  it.each([
    'eta_occupation_group',
    'eta_medical_condition',
    'planned_entry_time',
    'other_citizenships',
  ])('%s is not asked on the TRV route', (key) => {
    expect(
      asks(
        {
          travel_date_known: true,
          eta_medical_conditions: true,
          occupation: 'employed',
        },
        TRV,
      ),
    ).not.toContain(key);
  });
});
