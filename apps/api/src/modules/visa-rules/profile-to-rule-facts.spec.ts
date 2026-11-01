import { profileToRuleFacts } from './profile-to-rule-facts';
import { evaluateRule } from './rule-evaluator';
import type { RuleNode } from './rule.types';

const NOW = new Date('2026-10-14T00:00:00Z');

/**
 * Dry run 2026-10-14: a Pakistani applicant visiting their son in Canada, with
 * a prior refusal, got a 3-item TRV checklist. Intake wrote free-form keys
 * (purpose_of_visit: "family visit", previous_visa_refused: true, ...) and the
 * rules read the closed vocabulary in rule.types.ts (purpose,
 * has_prior_refusal, ...), so every conditional row evaluated `unknown`.
 */
describe('profileToRuleFacts', () => {
  const dryRunProfile = {
    purpose_of_visit: 'family visit',
    previous_visa_refused: true,
    relationship_to_family_in_destination: 'son',
    applicant_citizenship: 'Pakistan',
    duration_of_stay_days: 60,
    date_of_birth: '1961-03-02',
  };

  it('keeps every original key untouched', () => {
    const facts = profileToRuleFacts(dryRunProfile, NOW);
    for (const [k, v] of Object.entries(dryRunProfile)) {
      expect(facts[k]).toEqual(v);
    }
  });

  it('maps the dry-run profile onto the rule vocabulary', () => {
    const facts = profileToRuleFacts(dryRunProfile, NOW);
    expect(facts.purpose).toBe('visit_family');
    expect(facts.has_prior_refusal).toBe(true);
    expect(facts.nationality).toBe('PK');
    expect(facts.stay_duration_days).toBe(60);
    expect(facts.age).toBe(65);
    expect(facts.is_minor).toBe(false);
  });

  it('makes the Canada TRV invitation-letter rule true for a family visit', () => {
    const rule: RuleNode = {
      fact: 'purpose',
      op: 'in',
      value: ['family', 'visit_family', 'visit_friends'],
    };
    expect(evaluateRule(rule, profileToRuleFacts(dryRunProfile, NOW))).toBe(
      'true',
    );
  });

  it.each([
    ['visiting my son', 'visit_family'],
    ['To see my daughter and grandchildren', 'visit_family'],
    ['visit parents', 'visit_family'],
    ['Family', 'visit_family'],
    ['visiting friends', 'visit_friends'],
    ['Tourism / sightseeing', 'tourism'],
    ['holiday', 'tourism'],
    ['business meetings', 'business'],
    ['attend a conference', 'business'],
    ['study at university', 'study'],
    ['medical treatment', 'medical'],
    ['transit', 'transit'],
  ])('normalises purpose %p -> %p', (text, expected) => {
    expect(profileToRuleFacts({ purpose_of_visit: text }, NOW).purpose).toBe(
      expected,
    );
  });

  it('leaves an unrecognised purpose as the applicant wrote it', () => {
    expect(
      profileToRuleFacts({ purpose_of_visit: 'pilgrimage' }, NOW).purpose,
    ).toBe('pilgrimage');
  });

  it('normalises an explicit purpose key too', () => {
    expect(profileToRuleFacts({ purpose: 'family visit' }, NOW).purpose).toBe(
      'visit_family',
    );
  });

  it('reads yes/no strings as booleans for refusal facts', () => {
    expect(
      profileToRuleFacts({ prior_visa_refusal: 'Yes' }, NOW).has_prior_refusal,
    ).toBe(true);
    expect(
      profileToRuleFacts({ previous_visa_refused: 'no' }, NOW)
        .has_prior_refusal,
    ).toBe(false);
  });

  it('never overrides a rule fact the profile already states', () => {
    const facts = profileToRuleFacts(
      { has_prior_refusal: false, previous_visa_refused: true },
      NOW,
    );
    expect(facts.has_prior_refusal).toBe(false);
  });

  it('marks a minor from date of birth', () => {
    const facts = profileToRuleFacts({ date_of_birth: '2015-01-01' }, NOW);
    expect(facts.age).toBe(11);
    expect(facts.is_minor).toBe(true);
  });

  it('handles country codes and demonyms for nationality', () => {
    expect(profileToRuleFacts({ citizenship: 'pk' }, NOW).nationality).toBe(
      'PK',
    );
    expect(
      profileToRuleFacts({ nationality: 'Pakistani' }, NOW).nationality,
    ).toBe('PK');
    expect(
      profileToRuleFacts({ country_of_residence: 'India' }, NOW)
        .residence_country,
    ).toBe('IN');
  });

  describe('has_dependants', () => {
    it('is true when the applicant has children', () => {
      expect(
        profileToRuleFacts({ number_of_children: 2 }, NOW).has_dependants,
      ).toBe(true);
      expect(
        profileToRuleFacts({ has_children: true }, NOW).has_dependants,
      ).toBe(true);
      expect(
        profileToRuleFacts({ dependants: ['Ali'] }, NOW).has_dependants,
      ).toBe(true);
    });

    it('is NOT inferred from the relative being visited', () => {
      // "son" is who they are visiting, not a dependant on the application.
      expect(
        profileToRuleFacts(
          { relationship_to_family_in_destination: 'son' },
          NOW,
        ).has_dependants,
      ).toBeUndefined();
    });

    it('is NOT inferred from marital status alone', () => {
      expect(
        profileToRuleFacts({ marital_status: 'married' }, NOW).has_dependants,
      ).toBeUndefined();
    });

    it('is false only on an explicit no', () => {
      expect(
        profileToRuleFacts({ has_dependents: false }, NOW).has_dependants,
      ).toBe(false);
    });
  });

  it('reads a longer marital answer as the registry value', () => {
    const m = (v: string) => profileToRuleFacts({ marital_status: v }, NOW).marital_status;
    expect(m('Common-law partner')).toBe('common_law');
    expect(m('legally married')).toBe('married');
    expect(m('Never married')).toBe('single');
    expect(m('unmarried')).toBe('single');
    expect(m('De facto')).toBe('de_facto');
    expect(m('Widowed')).toBe('widowed');
  });

  it('normalises marital status spelling', () => {
    expect(
      profileToRuleFacts({ marital_status: 'Common-law' }, NOW).marital_status,
    ).toBe('common_law');
  });

  it('derives stay_duration_days from the dates, not a stale stored count (#20)', () => {
    const facts = profileToRuleFacts(
      {
        duration_of_stay_days: 56,
        planned_entry_date: '2027-03-01',
        planned_departure_date: '2027-04-30',
      },
      NOW,
    );
    expect(facts.stay_duration_days).toBe(61);
    // The original key is kept as the applicant stated it.
    expect(facts.duration_of_stay_days).toBe(56);
  });

  it('maps a representative answer so IMM 5476 resolves (#50)', () => {
    const rule: RuleNode = {
      fact: 'uses_representative',
      op: 'eq',
      value: true,
    };
    expect(
      evaluateRule(
        rule,
        profileToRuleFacts({ has_representative: 'yes' }, NOW),
      ),
    ).toBe('true');
    expect(
      evaluateRule(
        rule,
        profileToRuleFacts({ uses_representative: false }, NOW),
      ),
    ).toBe('false');
    expect(evaluateRule(rule, profileToRuleFacts({}, NOW))).toBe('unknown');
  });

  it('maps passport type and prior travel to Canada', () => {
    const facts = profileToRuleFacts(
      {
        passport_type: 'Diplomatic passport',
        previously_visited_canada: 'yes',
      },
      NOW,
    );
    expect(facts.passport_type).toBe('diplomatic');
    expect(facts.has_prior_travel).toBe(true);
  });

  it('copes with an empty or null profile', () => {
    expect(profileToRuleFacts({}, NOW)).toEqual({});
    expect(profileToRuleFacts(null, NOW)).toEqual({});
  });
});

// Review 2026-10-16: ICU names retired ISO codes too (DD "Germany", VD
// "Vietnam", UK "United Kingdom"…). A name must map to the CURRENT code.
describe('profileToRuleFacts — country names map to current ISO codes', () => {
  it.each([
    ['Germany', 'DE'],
    ['Vietnam', 'VN'],
    ['Yemen', 'YE'],
    ['Zimbabwe', 'ZW'],
    ['Serbia', 'RS'],
    ['Russia', 'RU'],
    ['Benin', 'BJ'],
    ['Burkina Faso', 'BF'],
    ['Vanuatu', 'VU'],
    ['France', 'FR'],
    ['United Kingdom', 'GB'],
    ['Pakistan', 'PK'],
  ])('%s -> %s', (name, code) => {
    expect(profileToRuleFacts({ nationality: name }, NOW).nationality).toBe(code);
  });
});

// Study permit (2026-10-20): IRCC requires a medical exam for a stay of more
// than 6 months from a listed country, and a student states the stay as the
// program's dates, not trip dates.
describe('profileToRuleFacts — study permit facts', () => {
  it('reads the planned stay from the study dates', () => {
    const facts = profileToRuleFacts(
      { study_start_date: '2027-01-11', study_end_date: '2028-12-15' },
      NOW,
    );
    expect(facts.stay_duration_days).toBe(705);
  });

  it('reads month-only study dates as whole months', () => {
    expect(
      profileToRuleFacts(
        { program_start_date: '2027-01', program_end_date: '2027-06' },
        NOW,
      ).stay_duration_days,
    ).toBe(181);
  });

  it('prefers trip dates and an explicit count over the study dates', () => {
    expect(
      profileToRuleFacts(
        {
          planned_entry_date: '2027-01-01',
          planned_departure_date: '2027-01-31',
          study_start_date: '2027-01-11',
          study_end_date: '2028-12-15',
        },
        NOW,
      ).stay_duration_days,
    ).toBe(31);
    expect(
      profileToRuleFacts(
        {
          duration_of_stay_days: 40,
          study_start_date: '2027-01-11',
          study_end_date: '2028-12-15',
        },
        NOW,
      ).stay_duration_days,
    ).toBe(40);
  });

  it('ignores study dates it cannot read', () => {
    const facts = profileToRuleFacts(
      { study_start_date: 'January', study_end_date: '2028-12-15' },
      NOW,
    );
    expect('stay_duration_days' in facts).toBe(false);
  });
});

/**
 * Canada work permit (registry v2, 2026-10-29): the checklist branches on the
 * permit kind the applicant named, through the same @visaai/types classifier
 * the work interview uses, and on the medical-exam triggers.
 */
describe('profileToRuleFacts — work permit facts', () => {
  const facts = (p: Record<string, unknown>) => profileToRuleFacts(p, NOW);

  it.each([
    ['lmia', 'lmia'],
    ['LMIA-exempt', 'lmia_exempt'],
    ['lmia_exempt', 'lmia_exempt'],
    ['Employer-specific with an offer of employment number', 'lmia_exempt'],
    ['open', 'open'],
    ['Spousal open work permit (OWP)', 'open'],
    ['sawp', 'lmia'],
    ['Seasonal Agricultural Worker Program', 'lmia'],
  ])('reads work_permit_type %p as %p', (raw, kind) => {
    expect(facts({ work_permit_type: raw }).work_permit_type).toBe(kind);
  });

  it('removes a permit type it cannot classify, never guessing', () => {
    expect('work_permit_type' in facts({ work_permit_type: 'other' })).toBe(false);
    expect('work_permit_type' in facts({ work_permit_type: 'start-up visa' })).toBe(false);
  });

  it('takes the stay from work dates only on a work permit profile (review 2026-10-29)', () => {
    // A visitor's extracted past job is never a "stay".
    expect(
      facts({ work_start_date: '2018-01-01', work_end_date: '2023-06-30' }).stay_duration_days,
    ).toBeUndefined();
    expect(
      facts({ work_permit_type: 'lmia', work_start_date: '2027-01-11', work_end_date: '2029-01-10' })
        .stay_duration_days,
    ).toBeGreaterThan(700);
  });

  it('counts other_citizenships as a citizen of the residence country', () => {
    const base = { nationality: 'India', country_of_residence: 'United Arab Emirates' };
    expect(facts(base).resident_non_citizen).toBe(true);
    expect(facts({ ...base, other_citizenships: ['United Arab Emirates'] }).resident_non_citizen).toBe(false);
  });

  it('a negated job word is not a public-health job', () => {
    expect(facts({ public_health_occupation: 'I work in construction, not healthcare' }).public_health_occupation).not.toBe(true);
    expect(facts({ public_health_occupation: 'nurse at a hospital' }).public_health_occupation).toBe(true);
  });

  it('reads the permit type from its aliases', () => {
    expect(facts({ type_of_work_permit: 'open_work_permit' }).work_permit_type).toBe('open');
  });

  it('sets works_in_quebec from the province, and leaves it unset with none', () => {
    expect(facts({ work_location_province: 'Québec' }).works_in_quebec).toBe(true);
    expect(facts({ province_of_work: 'QC' }).works_in_quebec).toBe(true);
    expect(facts({ work_location_province: 'Ontario' }).works_in_quebec).toBe(false);
    expect('works_in_quebec' in facts({})).toBe(false);
  });

  it('reads whose family member an open-permit applicant is', () => {
    expect(facts({ principal_relationship: 'spouse of a worker' }).open_permit_principal).toBe('worker');
    expect(facts({ relationship_to_principal: 'common-law partner of a student' }).open_permit_principal).toBe('student');
    expect('open_permit_principal' in facts({ principal_relationship: 'spouse' })).toBe(false);
  });

  it('reads the public-health / agriculture answer as two facts', () => {
    expect(facts({ public_health_occupation: 'Yes' })).toMatchObject({ public_health_occupation: true });
    expect(facts({ public_health_occupation: 'Yes, registered nurse' })).toMatchObject({ public_health_occupation: true });
    expect(facts({ public_health_occupation: 'yes - farm work' })).toMatchObject({
      public_health_occupation: false,
      agricultural_occupation: true,
    });
    expect(facts({ public_health_occupation: 'No' })).toMatchObject({
      public_health_occupation: false,
      agricultural_occupation: false,
    });
    expect(facts({ public_health_occupation: 'not in health care, I am a welder' })).toMatchObject({
      public_health_occupation: false,
    });
    expect(facts({ public_health_occupation: true }).public_health_occupation).toBe(true);
    expect('public_health_occupation' in facts({ public_health_occupation: 'welder' })).toBe(false);
  });

  it('treats a SAWP worker as agricultural', () => {
    expect(facts({ work_permit_type: 'sawp', public_health_occupation: 'No' }).agricultural_occupation).toBe(true);
  });

  it('reads 6+ months in a listed country from a leading yes or no', () => {
    expect(facts({ designated_country_six_months: 'Yes, Pakistan' }).ime_country_six_months).toBe(true);
    expect(facts({ lived_in_designated_country: 'no' }).ime_country_six_months).toBe(false);
    expect('ime_country_six_months' in facts({ designated_country_six_months: 'Pakistan' })).toBe(false);
  });

  it('takes the planned stay from the work dates', () => {
    expect(
      facts({ work_permit_type: 'open', work_start_date: '2027-02-01', work_end_date: '2027-03-15' }).stay_duration_days,
    ).toBe(43);
    expect(
      facts({ work_permit_type: 'lmia', intended_work_start_date: '2027-02', intended_work_end_date: '2028-01' }).stay_duration_days,
    ).toBe(365);
  });

  it('sets resident_non_citizen only when both countries are known', () => {
    expect(
      facts({ applicant_citizenship: 'India', country_of_residence: 'United Arab Emirates' }).resident_non_citizen,
    ).toBe(true);
    expect(
      facts({ applicant_citizenship: 'Pakistan', country_of_residence: 'Pakistan' }).resident_non_citizen,
    ).toBe(false);
    expect(
      facts({
        applicant_citizenship: 'India',
        second_nationality: 'AE',
        country_of_residence: 'United Arab Emirates',
      }).resident_non_citizen,
    ).toBe(false);
    expect('resident_non_citizen' in facts({ applicant_citizenship: 'India' })).toBe(false);
  });

  it('decides the CAQ rule for an LMIA job in Quebec', () => {
    const rule: RuleNode = {
      all: [
        { fact: 'work_permit_type', op: 'eq', value: 'lmia' },
        { fact: 'works_in_quebec', op: 'eq', value: true },
        { fact: 'stay_duration_days', op: 'gt', value: 30 },
      ],
    };
    const base = { work_permit_type: 'LMIA', work_location_province: 'Quebec', work_start_date: '2027-01-01', work_end_date: '2027-12-31' };
    expect(evaluateRule(rule, facts(base))).toBe('true');
    expect(evaluateRule(rule, facts({ ...base, work_permit_type: 'open' }))).toBe('false');
    expect(evaluateRule(rule, facts({ ...base, work_location_province: 'Alberta' }))).toBe('false');
  });
});
