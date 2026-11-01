import { composePurposeOfVisit } from './purpose-description';

/**
 * #51 (dry run 2026-10-14): the purpose text locked for auto-fill was the
 * intake's short phrase — "family visit" — but IRCC's purpose box expects a
 * description with the dates. It is composed deterministically from the
 * profile: no model call, so the consultant locks exactly what gets written.
 */
describe('composePurposeOfVisit', () => {
  const profile = {
    purpose_of_visit: 'family visit',
    planned_entry_date: '2027-03-01',
    planned_departure_date: '2027-04-30',
    relationship_to_family_in_destination: 'son',
    family_member_name: 'Ahmed Khan',
    destination_city: 'Toronto',
  };

  it('writes a full description with entry, departure and the derived duration', () => {
    expect(composePurposeOfVisit(profile)).toBe(
      'Family visit from March 1, 2027 to April 30, 2027 (61 days): visiting my son Ahmed Khan in Toronto. I will return home on April 30, 2027.',
    );
  });

  it('derives the duration from the dates, ignoring a stale stored count (#20)', () => {
    expect(
      composePurposeOfVisit({ ...profile, duration_of_stay_days: 56 }),
    ).toContain('(61 days)');
  });

  it('reads alias date keys the interview may have used', () => {
    const out = composePurposeOfVisit({
      purpose: 'tourism',
      intended_arrival_date: '2027-06-10',
      intended_departure_date: '2027-06-24',
    });
    expect(out).toBe(
      'Tourism from June 10, 2027 to June 24, 2027 (15 days). I will return home on June 24, 2027.',
    );
  });

  it('uses an explicit detail sentence when the applicant gave one', () => {
    expect(
      composePurposeOfVisit({
        ...profile,
        purpose_details: 'attending my granddaughter’s graduation',
      }),
    ).toContain('(61 days): attending my granddaughter’s graduation.');
  });

  it('leaves a description that already carries the dates alone', () => {
    const written =
      'Visiting my son from March 1, 2027 to April 30, 2027 for his wedding.';
    expect(
      composePurposeOfVisit({ ...profile, purpose_of_visit: written }),
    ).toBe(written);
    const iso = 'Family visit 2027-03-01 to 2027-04-30';
    expect(composePurposeOfVisit({ ...profile, purpose_of_visit: iso })).toBe(
      iso,
    );
  });

  it('cannot compose without both dates and returns the phrase unchanged', () => {
    expect(composePurposeOfVisit({ purpose_of_visit: 'family visit' })).toBe(
      'family visit',
    );
  });

  it('returns null when there is no purpose at all', () => {
    expect(
      composePurposeOfVisit({ planned_entry_date: '2027-03-01' }),
    ).toBeNull();
  });

  it('a phrase can be supplied explicitly (a reviewed form value wins over the profile)', () => {
    expect(composePurposeOfVisit(profile, 'Visit to my son')).toMatch(
      /^Visit to my son from March 1, 2027/,
    );
  });

  it('states a year-long super visa stay in months, not as a 365-day visit', () => {
    expect(
      composePurposeOfVisit({
        purpose_of_visit: 'family visit',
        planned_entry_date: '2027-03-01',
        planned_departure_date: '2028-02-28',
      }),
    ).toBe(
      'Family visit from March 1, 2027 to February 28, 2028 (12 months). I will return home on February 28, 2028.',
    );
  });
});

describe('composePurposeOfVisit — no repeated detail (live E2E 2026-10-18)', () => {
  it('drops a detail that only repeats the phrase', () => {
    const out = composePurposeOfVisit(
      {
        planned_entry_date: '2027-03-10',
        planned_departure_date: '2027-03-17',
        purpose_of_visit_details:
          'Business; meeting suppliers and negotiating purchase contracts',
      },
      'Business visit to TEST Metals Recycling Inc. for meeting suppliers and negotiating purchase contracts',
    );
    expect(out).toBe(
      'Business visit to TEST Metals Recycling Inc. for meeting suppliers and negotiating purchase contracts from March 10, 2027 to March 17, 2027 (8 days). I will return home on March 17, 2027.',
    );
  });

  it('keeps a short or partial-word detail', () => {
    const out = composePurposeOfVisit(
      {
        planned_entry_date: '2027-03-10',
        planned_departure_date: '2027-03-17',
        purpose_of_visit_details: 'Wedding: Ahmed',
      },
      'Visit my son Ahmed',
    );
    expect(out).toMatch(/: Wedding: Ahmed\./);
  });
});
