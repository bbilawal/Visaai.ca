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
