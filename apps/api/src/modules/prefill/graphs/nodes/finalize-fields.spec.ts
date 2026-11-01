import type { PrefilledFormField } from '@visaai/types';
import { finalizeFields, type FinalizeContext } from './finalize-fields';

/**
 * Anonymized replay of the 2026-10-14 prod prefill: a RETIRED applicant
 * visiting his son, with the son's employment letter and the other son's bank
 * evidence uploaded as sponsor documents. Names and numbers are changed; the
 * SHAPE of every value is what prod produced.
 */
function f(
  key: string,
  value: string,
  source: PrefilledFormField['source'] = 'profile',
  group = 'Personal',
): PrefilledFormField {
  return { key, label: key, value, source, group };
}

function ctx(over: Partial<FinalizeContext> = {}): FinalizeContext {
  return {
    applicantName: 'KARIM HADDAD',
    profile: {
      retired: true,
      employed: false,
      planned_entry_date: '2026-12-01',
      planned_departure_date: '2027-01-31',
      duration_of_stay_days: 56,
      travel_history_countries: [],
    },
    documentFields: {
      full_name: 'KARIM HADDAD',
      passport_number: 'AB1234567',
    },
    documentFieldsByType: {
      passport_copy: {
        full_name: 'KARIM HADDAD',
        passport_number: 'AB1234567',
      },
    },
    otherPartyDocuments: [
      {
        documentType: 'employment_letter',
        subject: 'unattributed',
        holderName: null,
        fields: {
          job_title: 'HR Data Quality Coordinator',
          monthly_income: 88123,
          employment_start_date: 'December 2, 2024.',
        },
      },
    ],
    accountProfile: { full_name: 'Omar Haddad', email: 'host@example.com' },
    ...over,
  };
}

const byKey = (fields: PrefilledFormField[], key: string) =>
  fields.find((x) => x.key === key);

describe('finalizeFields — sponsor documents never fill applicant employment', () => {
  const out = finalizeFields(
    [
      f('current_occupation', 'Retired', 'profile', 'Employment'),
      f(
        'previous_job_title',
        'HR Data Quality Coordinator',
        'document',
        'Employment',
      ),
      f('employment_start_date', '2024-12-02', 'profile', 'Employment'),
      f('monthly_income', '88123', 'document', 'Financial'),
      f('employer_name', '', 'profile', 'Employment'),
    ],
    ctx(),
  );

  it("blanks the HR signatory title lifted from the son's letter", () => {
    expect(byKey(out, 'previous_job_title')?.value).toBe('');
    expect(byKey(out, 'previous_job_title')?.needsReview).toBe(true);
  });

  it("blanks the other son's salary posing as applicant monthly income", () => {
    expect(byKey(out, 'monthly_income')?.value).toBe('');
  });

  it("blanks the son's start date for a retired applicant", () => {
    expect(byKey(out, 'employment_start_date')?.value).toBe('');
  });

  it('keeps "Retired" as the occupation', () => {
    expect(byKey(out, 'current_occupation')?.value).toBe('Retired');
  });

  it('an employed applicant keeps their OWN job title', () => {
    const mine = finalizeFields(
      [f('job_title', 'Civil Engineer', 'profile', 'Employment')],
      ctx({ profile: { employed: true } }),
    );
    expect(byKey(mine, 'job_title')?.value).toBe('Civil Engineer');
  });
});

describe('finalizeFields — duration derives from the dates', () => {
  it('replaces a stated 56 with the 62 days the dates cover, and says so', () => {
    const out = finalizeFields(
      [
        f('planned_entry_date', '2026-12-01', 'profile', 'Travel'),
        f('planned_departure_date', '2027-01-31', 'profile', 'Travel'),
        f('duration_of_stay_days', '56', 'profile', 'Travel'),
      ],
      ctx(),
    );
    const d = byKey(out, 'duration_of_stay_days')!;
    expect(d.value).toBe('62');
    expect(d.source).toBe('inferred');
    expect(d.note).toMatch(/56/);
    expect(d.needsReview).toBe(true);
  });

  it('leaves a consistent duration alone', () => {
    const out = finalizeFields(
      [f('duration_of_stay_days', '62', 'profile', 'Travel')],
      ctx(),
    );
    expect(byKey(out, 'duration_of_stay_days')).toMatchObject({
      value: '62',
      source: 'profile',
    });
  });

  it('adds duration_of_stay_days from the dates when the draft left it out', () => {
    const out = finalizeFields(
      [
        f('planned_entry_date', '2026-12-01', 'profile', 'Travel'),
        f('planned_departure_date', '2027-01-31', 'profile', 'Travel'),
      ],
      ctx(),
    );
    expect(byKey(out, 'duration_of_stay_days')).toMatchObject({
      value: '62',
      source: 'inferred',
      group: 'Travel',
    });
  });

  it('does nothing without both dates', () => {
    const out = finalizeFields(
      [f('duration_of_stay_days', '56', 'profile', 'Travel')],
      ctx({ profile: { planned_entry_date: '2026-12-01' } }),
    );
    expect(byKey(out, 'duration_of_stay_days')?.value).toBe('56');
  });
});

describe('finalizeFields — identity facts from identity documents', () => {
  it('fills sex, passport type and national ID from extracted fields', () => {
    const out = finalizeFields(
      [
        f('sex', ''),
        f('passport_type', '', 'profile', 'Passport'),
        f('national_id_number', ''),
      ],
      ctx({
        documentFields: { sex: 'M', passport_type: 'P' },
        documentFieldsByType: {
          passport_copy: { sex: 'M', passport_type: 'P' },
          national_id: {
            full_name: 'KARIM HADDAD',
            DocumentNumber: '12345-1234567-1',
          },
        },
      }),
    );
    expect(byKey(out, 'sex')).toMatchObject({
      value: 'Male',
      source: 'document',
    });
    expect(byKey(out, 'passport_type')).toMatchObject({
      value: 'Regular',
      source: 'document',
    });
    expect(byKey(out, 'national_id_number')).toMatchObject({
      value: '12345-1234567-1',
      source: 'document',
    });
  });

  it('reads sex and passport type from a passport MRZ', () => {
    const out = finalizeFields(
      [f('sex', ''), f('passport_type', '')],
      ctx({
        documentFieldsByType: {
          passport: {
            mrz: 'P<PAKHADDAD<<KARIM<<<<<<<<<<<<<<<<<<<<<<<<<<\nAB12345674PAK6106150M3308064<<<<<<<<<<<<<<02',
          },
        },
      }),
    );
    expect(byKey(out, 'sex')?.value).toBe('Male');
    expect(byKey(out, 'passport_type')?.value).toBe('Regular');
  });

  it('finds a CNIC-shaped number anywhere in an applicant ID document', () => {
    const out = finalizeFields(
      [f('national_id_number', '')],
      ctx({
        documentFieldsByType: {
          document: {
            full_name: 'Karim Haddad',
            identity_number: '12345 1234567 1',
          },
        },
      }),
    );
    expect(byKey(out, 'national_id_number')?.value).toBe('12345-1234567-1');
  });

  it('adds the field when the generator left it out', () => {
    const out = finalizeFields([], ctx({ documentFields: { sex: 'F' } }));
    expect(byKey(out, 'sex')?.value).toBe('Female');
  });

  it('never overwrites a value the generator already filled', () => {
    const out = finalizeFields(
      [f('sex', 'Female', 'profile')],
      ctx({ documentFields: { sex: 'M' } }),
    );
    expect(byKey(out, 'sex')?.value).toBe('Female');
  });
});

describe('finalizeFields — travel history and contact ownership', () => {
  it('renders "None" when the profile records no travel', () => {
    const out = finalizeFields(
      [f('travel_history_countries', '', 'profile', 'Travel history')],
      ctx(),
    );
    expect(byKey(out, 'travel_history_countries')?.value).toBe('None');
  });

  it('flags an email that belongs to the account holder, not the applicant', () => {
    const out = finalizeFields(
      [f('email', 'host@example.com', 'profile', 'Contact')],
      ctx(),
    );
    const e = byKey(out, 'email')!;
    expect(e.value).toBe('host@example.com');
    expect(e.needsReview).toBe(true);
    expect(e.note).toMatch(/Omar Haddad/);
  });

  it("does not flag the applicant's own account email", () => {
    const out = finalizeFields(
      [f('email', 'me@example.com', 'profile', 'Contact')],
      ctx({
        accountProfile: { full_name: 'Karim Haddad', email: 'me@example.com' },
      }),
    );
    expect(byKey(out, 'email')?.needsReview).toBeUndefined();
  });
});

describe('finalizeFields — purpose of visit (#51)', () => {
  it('turns a short purpose phrase into a description with the dates and derived duration', () => {
    const out = finalizeFields(
      [f('purpose_of_visit', 'Family visit', 'profile', 'Travel')],
      ctx({
        profile: {
          planned_entry_date: '2027-03-01',
          planned_departure_date: '2027-04-30',
          duration_of_stay_days: 56,
          relationship_to_family_in_destination: 'son',
        },
      }),
    );
    expect(out[0].value).toBe(
      'Family visit from March 1, 2027 to April 30, 2027 (61 days): visiting my son. I will return home on April 30, 2027.',
    );
    expect(out[0].source).toBe('inferred');
    expect(out[0].note).toMatch(/dates/i);
  });

  it('prefers the dates on the form over the profile', () => {
    const out = finalizeFields(
      [
        f('purpose_of_travel', 'Tourism', 'profile', 'Travel'),
        f('intended_arrival_date', '2027-06-10', 'profile', 'Travel'),
        f('intended_departure_date', '2027-06-24', 'profile', 'Travel'),
      ],
      ctx({ profile: {} }),
    );
    expect(out[0].value).toBe(
      'Tourism from June 10, 2027 to June 24, 2027 (15 days). I will return home on June 24, 2027.',
    );
  });

  it('leaves an already-dated description alone', () => {
    const v = 'Visiting my son from March 1, 2027 to April 30, 2027.';
    const out = finalizeFields(
      [f('purpose_of_visit', v, 'profile', 'Travel')],
      ctx({
        profile: {
          planned_entry_date: '2027-03-01',
          planned_departure_date: '2027-04-30',
        },
      }),
    );
    expect(out[0].value).toBe(v);
  });
});

describe('finalizeFields — family members matched by name (#35)', () => {
  const profile = {
    children: [
      { name: 'Ahmed Khan', relationship: 'son', occupation: 'Engineer' },
      { name: 'Bilal Khan', relationship: 'son', occupation: 'Doctor' },
    ],
  };

  it('corrects occupations the generator swapped between two sons', () => {
    const out = finalizeFields(
      [
        f('child_1_name', 'Ahmed Khan', 'profile', 'Family'),
        f('child_1_occupation', 'Doctor', 'profile', 'Family'),
        f('child_2_name', 'Bilal Khan', 'profile', 'Family'),
        f('child_2_occupation', 'Engineer', 'profile', 'Family'),
      ],
      ctx({ profile }),
    );
    const v = (k: string) => out.find((x) => x.key === k)!;
    expect(v('child_1_occupation').value).toBe('Engineer');
    expect(v('child_2_occupation').value).toBe('Doctor');
    expect(v('child_1_occupation').needsReview).toBe(true);
    expect(v('child_1_occupation').note).toMatch(/Ahmed Khan/);
  });

  it('leaves correct rows untouched and ignores names not in the profile', () => {
    const out = finalizeFields(
      [
        f('son_1_full_name', 'BILAL KHAN', 'profile', 'Family'),
        f('son_1_occupation', 'Doctor', 'profile', 'Family'),
        f('child_3_name', 'Someone Else', 'profile', 'Family'),
        f('child_3_occupation', 'Pilot', 'profile', 'Family'),
      ],
      ctx({ profile }),
    );
    expect(
      out.find((x) => x.key === 'son_1_occupation')!.needsReview,
    ).toBeUndefined();
    expect(out.find((x) => x.key === 'child_3_occupation')!.value).toBe(
      'Pilot',
    );
  });
});

describe('finalizeFields — IMM 5257 answers reach the form (#50)', () => {
  const route = {
    country: 'CA',
    visaaiId: 'ca-visitor-visa-temporary-resident-visa',
  };
  const answers = {
    passport_type: 'Regular',
    us_permanent_resident: false,
    has_valid_us_visa: true,
    previously_visited_canada: 'No',
    uses_representative: true,
    representative_name: 'Jane Doe',
    representative_paid: 'unpaid',
    representative_email: 'jane@example.com',
    representative_address: '1 Main St, Toronto ON',
  };

  it('adds a field for each answered route question the generator left out', () => {
    const out = finalizeFields([], ctx({ profile: answers, route }));
    const byKey = Object.fromEntries(out.map((x) => [x.key, x]));
    expect(byKey.us_permanent_resident.value).toBe('No');
    expect(byKey.has_valid_us_visa.value).toBe('Yes');
    expect(byKey.previously_visited_canada.value).toBe('No');
    expect(byKey.uses_representative.value).toBe('Yes');
    expect(byKey.representative_name.value).toBe('Jane Doe');
    expect(byKey.representative_paid.value).toBe('unpaid');
    expect(byKey.representative_contact.value).toBe('jane@example.com');
    expect(byKey.representative_address).toMatchObject({
      value: '1 Main St, Toronto ON',
      group: 'Representative',
      source: 'profile',
    });
  });

  it('never duplicates a field the generator already produced', () => {
    const out = finalizeFields(
      [f('passport_type', 'Regular', 'document', 'Passport')],
      ctx({ profile: answers, route }),
    );
    expect(out.filter((x) => x.key === 'passport_type')).toHaveLength(1);
  });

  it('other countries get nothing added', () => {
    const out = finalizeFields(
      [],
      ctx({
        profile: answers,
        route: { country: 'GB', visaaiId: 'gb-standard-visitor' },
      }),
    );
    expect(out.find((x) => x.key === 'representative_name')).toBeUndefined();
  });

  it('no representative → no representative details', () => {
    const out = finalizeFields(
      [],
      ctx({ profile: { ...answers, uses_representative: false }, route }),
    );
    expect(out.find((x) => x.key === 'representative_name')).toBeUndefined();
    expect(out.find((x) => x.key === 'uses_representative')?.value).toBe('No');
  });
});

describe('finalizeFields — IMM 5257 family section from documents (2026-10-15)', () => {
  const profile = {
    marital_status: 'Married',
    spouse_name: 'Sumera Ahmad',
    spouse_date_of_birth: '1968-10-09',
    marriage_date: '1988-09-16',
    children: [
      {
        name: 'MIAN MUHAMMAD SAJAWAL',
        date_of_birth: '1989-10-14',
        sex: 'Male',
        relationship: 'son',
        country_of_birth: 'Pakistan',
      },
      {
        name: 'MIAN MUHAMMAD BILAWAL',
        date_of_birth: '1989-10-14',
        sex: 'Male',
        relationship: 'son',
        country_of_birth: 'Pakistan',
      },
    ],
  };

  it('adds the spouse DOB and marriage date the generator left out', () => {
    const out = finalizeFields(
      [f('spouse_name', 'Sumera Ahmad', 'profile', 'Family')],
      ctx({ profile }),
    );
    expect(byKey(out, 'spouse_date_of_birth')?.value).toBe('1968-10-09');
    expect(byKey(out, 'marriage_date')?.value).toBe('1988-09-16');
  });

  it("fills an empty marriage date field under the generator's own key", () => {
    const out = finalizeFields(
      [f('date_of_marriage', '', 'profile', 'Family')],
      ctx({ profile }),
    );
    expect(byKey(out, 'date_of_marriage')?.value).toBe('1988-09-16');
    expect(byKey(out, 'marriage_date')).toBeUndefined();
  });

  it('adds every child the generator missed, with DOB, relationship and country', () => {
    const out = finalizeFields([], ctx({ profile }));
    const v = (k: string) => byKey(out, k)?.value;
    expect(v('child_1_name')).toBe('MIAN MUHAMMAD SAJAWAL');
    expect(v('child_1_date_of_birth')).toBe('1989-10-14');
    expect(v('child_1_relationship')).toBe('son');
    expect(v('child_1_country_of_birth')).toBe('Pakistan');
    expect(v('child_2_name')).toBe('MIAN MUHAMMAD BILAWAL');
    expect(byKey(out, 'child_2_name')?.group).toBe('Family');
  });

  it("completes a child the generator listed without a DOB, keyed to that child's row", () => {
    const out = finalizeFields(
      [
        f('child_1_name', 'Mian Muhammad Bilawal', 'profile', 'Family'),
        f('child_1_occupation', 'Engineer', 'profile', 'Family'),
      ],
      ctx({ profile }),
    );
    expect(byKey(out, 'child_1_date_of_birth')?.value).toBe('1989-10-14');
    // Sajawal was missing entirely: next free number.
    expect(byKey(out, 'child_2_name')?.value).toBe('MIAN MUHAMMAD SAJAWAL');
    expect(
      out.filter((x) => /_name$/.test(x.key) && /BILAWAL/i.test(x.value)),
    ).toHaveLength(1);
  });

  it('marks the marriage date for review when a document flagged it', () => {
    const out = finalizeFields(
      [f('marriage_date', '1999-09-16', 'profile', 'Family')],
      ctx({
        profile: {
          ...profile,
          marriage_date: '1999-09-16',
          document_consistency_flags: [
            {
              code: 'marriage_after_child_birth',
              field: 'marriage_date',
              message:
                "The marriage date (1999-09-16) is after a child's date of birth.",
            },
          ],
        },
      }),
    );
    const m = byKey(out, 'marriage_date')!;
    expect(m.value).toBe('1999-09-16');
    expect(m.needsReview).toBe(true);
    expect(m.note).toMatch(/after a child/);
  });
});
