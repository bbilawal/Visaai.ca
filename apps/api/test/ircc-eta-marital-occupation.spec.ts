/**
 * The eTA form's marital-status and occupation questions, recorded live on
 * 2026-10-18: both required, both <select>s chosen by option text. The
 * occupation group opens the job title (working groups only; its list loads
 * 1–5 s later) and employer/school name, country, city and since-year
 * (working groups and Student). Anything the answers do not name
 * unambiguously is left blank for the applicant, with a note saying why.
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import '../src/modules/automation/portal-fills/canada-ircc-eta'; // registers 'ircc-eta'
import '../src/modules/automation/portal-fills/canada-ircc-super-visa'; // registers the super visa variant
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
import {
  ETA_MARITAL_OPTIONS,
  ETA_OCCUPATION_OPTIONS,
  ETA_TITLES,
  etaWorkFor,
} from '../src/modules/automation/portal-fills/eta-occupations';
import { irccOccupationFor } from '../src/modules/automation/portal-fills/ircc-occupations';

const mapping = () => resolvePortalFill('ircc-eta')!;
const id = (suffix: string) => `[id="applicationDetails.${suffix}"]`;

const F = {
  marital: id('personalDetails_maritalStatus'),
  occupation: id('employmentDetails_occupation'),
  title: id('employmentDetails_title'),
  employer: id('employmentDetails_companyEmployerSchoolFacilityName'),
  country: id('employmentDetails_country'),
  city: id('employmentDetails_city'),
  year: id('employmentDetails_fromDateYear'),
};
const EMPLOYMENT = [
  F.occupation,
  F.employer,
  F.country,
  F.city,
  F.year,
  F.title,
];

const writes = (p: Record<string, unknown>) =>
  buildMappingInputs(mapping(), p).map(
    (i) => [i.targetField, i.mappedValue] as [string, string],
  );
const at = (p: Record<string, unknown>, sel: string) =>
  writes(p).find(([f]) => f === sel)?.[1];
const employmentWrites = (p: Record<string, unknown>) =>
  writes(p).filter(([f]) => EMPLOYMENT.includes(f));
const left = (p: Record<string, unknown>) =>
  portalFillCoverage(mapping(), p).pages.flatMap((pg) => pg.left);

/** Explicit job facts of a working applicant. */
const JOB = {
  employer_name: 'Acme Software Ltd',
  employment_country: 'Pakistan',
  employment_city: 'Lahore',
  employment_since_year: '2018',
};

describe('eTA marital status', () => {
  it.each([
    ['married', 'Married'],
    ['Married', 'Married'],
    ['single', 'Never Married/Single'],
    ['never married', 'Never Married/Single'],
    ['Unmarried', 'Never Married/Single'],
    ['common-law', 'Common-Law'],
    ['Common law partner', 'Common-Law'],
    ['divorced', 'Divorced'],
    ['widowed', 'Widowed'],
    ['Widow', 'Widowed'],
    ['separated', 'Legally Separated'],
    ['legally separated', 'Legally Separated'],
    ['annulled', 'Annulled Marriage'],
    ['Annulled Marriage', 'Annulled Marriage'],
    ['Never Married/Single', 'Never Married/Single'],
  ])('%p → %p', (said, option) => {
    expect(at({ marital_status: said }, F.marital)).toBe(option);
    expect(ETA_MARITAL_OPTIONS).toContain(option);
  });

  it('reads the interview alias civil_status', () => {
    expect(at({ civil_status: 'divorced' }, F.marital)).toBe('Divorced');
  });

  it.each(['engaged', "it's complicated", 'in a relationship', 'yes'])(
    'an answer that names no option (%p) is left blank, with a note',
    (said) => {
      expect(at({ marital_status: said }, F.marital)).toBeUndefined();
      expect(left({ marital_status: said })).toContainEqual(
        expect.objectContaining({
          label: 'Marital status',
          reason: 'fill_yourself',
        }),
      );
    },
  );

  it('no answer → not written and listed as not in the VisaAI data, once', () => {
    expect(at({}, F.marital)).toBeUndefined();
    const notes = left({}).filter((n) => n.label === 'Marital status');
    expect(notes).toEqual([
      { label: 'Marital status', reason: 'not_in_profile' },
    ]);
  });

  it('a chosen status is not in the left list and goes to the identity review', () => {
    expect(
      left({ marital_status: 'married' }).some(
        (n) => n.label === 'Marital status',
      ),
    ).toBe(false);
    const input = buildMappingInputs(mapping(), {
      marital_status: 'married',
    }).find((i) => i.targetField === F.marital);
    expect(input?.category).toBe('passport');
  });
});

describe('eTA occupation: non-working groups', () => {
  it.each([
    [{ occupation: 'Retired' }, 'Retired'],
    [{ occupation: 'retired' }, 'Retired'],
    [{ employment_status: 'Retired pensioner' }, 'Retired'],
    [{ employed: 'retired' }, 'Retired'],
    [{ is_retired: true }, 'Retired'],
    [{ occupation: 'Homemaker' }, 'Homemaker'],
    [{ occupation: 'housewife' }, 'Homemaker'],
    [{ employment_status: 'stay-at-home mum' }, 'Homemaker'],
    [{ occupation: 'Unemployed' }, 'Unemployed'],
    [{ employment_status: 'not working' }, 'Unemployed'],
  ])('%j → %p, and nothing else of the section', (profile, group) => {
    expect(employmentWrites({ ...profile, ...JOB })).toEqual([
      [F.occupation, group],
    ]);
  });

  it('a retired applicant with a former job title is Retired', () => {
    expect(
      employmentWrites({ occupation: 'Retired', job_title: 'Teacher' }),
    ).toEqual([[F.occupation, 'Retired']]);
  });

  it.each([
    { occupation: 'Student' },
    { occupation: 'full-time university student' },
    { employment_status: 'Student at University of Leeds' },
    { is_student: true },
  ])('%j → Student with the school details, never a title', (profile) => {
    const p = {
      ...profile,
      employer_name: 'University of Leeds',
      employment_country: 'Leeds, England',
      employment_city: 'Leeds',
      employment_since_year: 2023,
    };
    expect(employmentWrites(p)).toEqual([
      [F.occupation, 'Student'],
      [F.employer, 'University of Leeds'],
      [F.country, 'England'],
      [F.city, 'Leeds'],
      [F.year, '2023'],
    ]);
  });

  it('school_name answers the employer-or-school question', () => {
    expect(at({ occupation: 'Student', school_name: 'LUMS' }, F.employer)).toBe(
      'LUMS',
    );
  });
});

describe('eTA occupation: working groups', () => {
  it('a software engineer: group, details, then the title last', () => {
    expect(
      employmentWrites({ job_title: 'Senior Software Engineer', ...JOB }),
    ).toEqual([
      [F.occupation, 'Natural and applied sciences and related occupations'],
      [F.employer, 'Acme Software Ltd'],
      [F.country, 'Pakistan'],
      [F.city, 'Lahore'],
      [F.year, '2018'],
      [F.title, 'Computer and information systems professionals'],
    ]);
  });

  it('the job title is the LAST write of the section (its list loads late)', () => {
    const order = mapping()
      .map((m) => m.selector)
      .filter((s) => EMPLOYMENT.includes(s));
    expect(order[order.length - 1]).toBe(F.title);
    expect(order[0]).toBe(F.occupation);
  });

  it.each([
    [
      'Accountant',
      'Business, finance and administration occupations',
      'Auditors, accountants and investment professionals',
    ],
    [
      'School teacher',
      'Education, law and social, community and government services occupations',
      'Secondary and elementary school teachers and educational counsellors',
    ],
    [
      'Registered Nurse',
      'Health occupations',
      'Professional occupations in nursing',
    ],
    [
      'Taxi driver',
      'Trades, transport and equipment operators and related occupations',
      'Motor vehicle and transit drivers',
    ],
    ['Chef', 'Sales and service occupations', 'Chefs and cooks'],
    [
      'Bank manager',
      'Management occupations',
      'Managers in financial and business services',
    ],
    [
      'Journalist',
      'Art, culture, recreation and sport occupations',
      'Writing, translating and related communications professionals',
    ],
  ])('%p → %p / %p', (job, group, title) => {
    const p = { job_title: job, occupation: 'employed', ...JOB };
    expect(at(p, F.occupation)).toBe(group);
    expect(at(p, F.title)).toBe(title);
  });

  it('a free-text occupation answer is read when there is no job title', () => {
    expect(at({ occupation: 'Pharmacist' }, F.title)).toBe(
      'Pharmacists, dieticians and nutritionists',
    );
  });

  it("the consultant's correction to an option text wins", () => {
    const p = {
      occupation: 'Sales and service occupations',
      job_title: 'Retail salespersons',
    };
    expect(at(p, F.occupation)).toBe('Sales and service occupations');
    expect(at(p, F.title)).toBe('Retail salespersons');
  });

  it('a group with no confident title: group written, title left with a note', () => {
    const p = {
      occupation: 'Sales and service occupations',
      job_title: 'Barista',
    };
    expect(at(p, F.occupation)).toBe('Sales and service occupations');
    expect(at(p, F.title)).toBeUndefined();
    expect(left(p)).toContainEqual(
      expect.objectContaining({ label: 'Job title', reason: 'fill_yourself' }),
    );
  });

  it("a title from another group's list is never written", () => {
    const p = {
      occupation: 'Health occupations',
      job_title: 'Software engineer',
    };
    expect(at(p, F.occupation)).toBe('Health occupations');
    expect(at(p, F.title)).toBeUndefined();
  });

  it('military: the group only, never a title; details still written', () => {
    const p = { job_title: 'Army officer', ...JOB };
    expect(at(p, F.occupation)).toBe('Military/armed forces');
    expect(at(p, F.title)).toBeUndefined();
    expect(at(p, F.employer)).toBe('Acme Software Ltd');
    const note = left(p).find((n) => n.label === 'Job title');
    expect(note?.note).toMatch(/Armed Forces/);
    // Even the form's own option text, given back by a consultant.
    expect(
      at(
        { occupation: 'Military/armed forces', job_title: 'Infantry Officer' },
        F.title,
      ),
    ).toBeUndefined();
  });

  it('every title the rules can produce is on the recorded list of its group', () => {
    for (const job of [
      'software developer',
      'it technician',
      'civil engineer',
      'architect',
      'engineer',
      'data analyst',
      'professor',
      'college instructor',
      'teacher',
      'lawyer',
      'police officer',
      'social worker',
      'doctor',
      'nurse',
      'pharmacist',
      'lab technician',
      'physiotherapist',
      'accountant',
      'finance manager',
      'hr manager',
      'bank teller',
      'secretary',
      'clerk',
      'journalist',
      'designer',
      'photographer',
      'shopkeeper',
      'sales executive',
      'cashier',
      'cook',
      'waiter',
      'security guard',
      'cleaner',
      'farmer',
      'farm worker',
      'electrician',
      'plumber',
      'carpenter',
      'car mechanic',
      'mechanic',
      'driver',
      'labourer',
    ]) {
      const tr = irccOccupationFor(job)!;
      expect(tr).toBeDefined();
      const w = etaWorkFor(job)!;
      expect(ETA_OCCUPATION_OPTIONS).toContain(w.category);
      expect(w.title).toBe(tr.title);
      expect(ETA_TITLES[w.category]).toContain(w.title);
    }
  });
});

describe('eTA occupation: unknown or conflicting answers are left blank', () => {
  it.each([
    [{ occupation: 'employed' }],
    [{ occupation: 'self-employed' }],
    [{ employed: true }],
    [{ job_title: 'Business owner' }],
    [{ job_title: 'Manager' }],
    [{ occupation: 'none' }],
    [{ job_title: 'Student counsellor' }],
    [{ job_title: 'Retirement planner' }],
    // Two statuses: which one IRCC wants is the applicant's call.
    [{ employment_status: 'retired', is_student: true }],
    // Studies and works.
    [{ is_student: true, job_title: 'Cashier' }],
    // Said they do not work: a job title is a former one.
    [{ employed: false, job_title: 'Accountant' }],
  ])('%j → nothing in the section, the group listed for the applicant', (p) => {
    expect(employmentWrites({ ...p, ...JOB })).toEqual([]);
    expect(left({ ...p, ...JOB })).toContainEqual(
      expect.objectContaining({ label: 'Occupation', reason: 'fill_yourself' }),
    );
  });

  it('no employment answer at all → listed as not in the VisaAI data', () => {
    const note = left({}).find((n) => n.label === 'Occupation');
    expect(note).toMatchObject({ reason: 'not_in_profile' });
    expect(note?.note).toMatch(/job title/);
  });

  it('employer details alone never open the section', () => {
    expect(employmentWrites(JOB)).toEqual([]);
  });
});

describe('eTA employment details: explicit answers only', () => {
  const base = { occupation: 'Student' };

  it('a country the place list cannot name is listed, not guessed', () => {
    const p = { ...base, employment_country: 'United Kingdom' };
    expect(at(p, F.country)).toBeUndefined();
    expect(left(p)).toContainEqual({
      label: 'Country of employer or school',
      reason: 'not_in_profile',
    });
  });

  it('a city alias that is a country is not a city', () => {
    expect(at({ ...base, employer_city: 'Pakistan' }, F.city)).toBeUndefined();
    expect(at({ ...base, work_city: 'Lahore' }, F.city)).toBe('Lahore');
  });

  it.each([
    ['2019', '2019'],
    [2019, '2019'],
    ['2019-03-01', '2019'],
    ['employment_start_date:2015-09', '2015'],
  ])('since %p → %p', (said, year) => {
    const p =
      typeof said === 'string' && said.startsWith('employment_start_date:')
        ? { ...base, employment_start_date: said.split(':')[1] }
        : { ...base, employment_since_year: said };
    expect(at(p, F.year)).toBe(year);
  });

  it.each(['about five years', '1850', '2999', 'since 2019'])(
    'since %p → nothing',
    (said) => {
      expect(
        at({ ...base, employment_since_year: said }, F.year),
      ).toBeUndefined();
    },
  );

  it('every employment write goes to the Employment review', () => {
    const inputs = buildMappingInputs(mapping(), {
      job_title: 'Software engineer',
      ...JOB,
    }).filter((i) => EMPLOYMENT.includes(i.targetField));
    expect(inputs).toHaveLength(6);
    for (const i of inputs) expect(i.category).toBe('employment');
  });

  it('missing details of a chosen group are listed for the applicant', () => {
    const labels = left({ occupation: 'Student' }).map((n) => n.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Name of employer or school',
        'Country of employer or school',
        'City / town of employer or school',
        'Since what year',
      ]),
    );
    // Retired opens no follow-up: none is listed.
    const retired = left({ occupation: 'Retired' }).map((n) => n.label);
    expect(retired).not.toContain('Name of employer or school');
    expect(retired).not.toContain('Occupation');
  });
});

describe('eTA occupation: a status beside a former job (review of #177)', () => {
  // Each answer once as the occupation answer, once as the job title.
  it.each([
    ['Retired school teacher', 'Retired'],
    ['retired, used to be a nurse', 'Retired'],
    ['Pensioner (retired doctor)', 'Retired'],
    ['retired army officer', 'Retired'],
    ['Retired, not working', 'Retired'],
    ['unemployed (former engineer)', 'Unemployed'],
    ['Not working, previously accountant', 'Unemployed'],
    ['Housewife, former teacher', 'Homemaker'],
    ['Student, not working', 'Student'],
  ])('%p → %p only, never the former job', (said, group) => {
    for (const key of ['occupation', 'job_title', 'employment_status']) {
      const w = employmentWrites({ [key]: said });
      expect(w[0]).toEqual([F.occupation, group]);
      expect(w.find(([f]) => f === F.title)).toBeUndefined();
    }
  });

  it.each([
    'former teacher',
    'ex-police officer',
    'Previously an accountant',
    'used to be a nurse',
    'Student, part-time cashier',
    'student and part time waiter',
    'semi-retired consultant',
    'Semi-retired accountant',
  ])('%p → blank, the applicant chooses', (said) => {
    for (const key of ['occupation', 'job_title']) {
      expect(employmentWrites({ [key]: said, ...JOB })).toEqual([]);
      expect(left({ [key]: said })).toContainEqual(
        expect.objectContaining({
          label: 'Occupation',
          reason: 'fill_yourself',
        }),
      );
    }
  });

  it('a former job with a current one is still read only from explicit status', () => {
    // The current status answer names a former job: blank, even with a title.
    expect(
      employmentWrites({
        employment_status: 'formerly a teacher',
        job_title: 'Accountant',
      }),
    ).toEqual([]);
  });

  it('job titles that contain a status word are jobs, not statuses', () => {
    // No status is read from them; no confident group either → blank.
    for (const job of [
      'Retirement planner',
      'Student counsellor',
      'Student services officer',
    ]) {
      expect(at({ job_title: job }, F.occupation)).toBeUndefined();
    }
    // With an explicit status elsewhere, that status still answers.
    expect(
      at(
        { employment_status: 'retired', job_title: 'Retirement planner' },
        F.occupation,
      ),
    ).toBe('Retired');
  });
});

describe('eTA occupation: military needs more than a bare "army" / "navy"', () => {
  it.each([
    ['Navy officer', 'Military/armed forces'],
    ['Army captain', 'Military/armed forces'],
    ['Officer in the army', 'Military/armed forces'],
    ['Air Force pilot', 'Military/armed forces'],
    ['Soldier', 'Military/armed forces'],
  ])('%p → %p', (job, group) => {
    expect(at({ job_title: job }, F.occupation)).toBe(group);
    expect(at({ job_title: job }, F.title)).toBeUndefined();
  });

  it.each([
    [
      'Navy blue fashion designer',
      'Art, culture, recreation and sport occupations',
    ],
    ['Salvation Army officer', undefined],
    ['Army surplus store owner', 'Management occupations'],
    ['Navy', undefined],
  ])('%p is not military (→ %p)', (job, group) => {
    expect(at({ job_title: job }, F.occupation)).toBe(group);
  });
});

describe('eTA marital status: negations and separation first', () => {
  it.each([
    ['separated, divorce pending', 'Legally Separated'],
    ['Separated (not yet divorced)', undefined],
    ['not married', undefined],
    ['no longer married', undefined],
    ['Not divorced', undefined],
  ])('%p → %p', (said, option) => {
    expect(at({ marital_status: said }, F.marital)).toBe(option);
  });
});

describe('a consultant exclusion of a required question is still listed (review of #177)', () => {
  const coverage = (p: Record<string, unknown>, ex: string[]) =>
    portalFillCoverage(mapping(), p, new Set(ex)).pages.flatMap(
      (pg) => pg.left,
    );
  const WORKER = {
    marital_status: 'married',
    job_title: 'Software engineer',
    ...JOB,
  };

  it('nothing excluded: none of them listed', () => {
    const labels = coverage(WORKER, []).map((n) => n.label);
    for (const l of [
      'Marital status',
      'Occupation',
      'Job title',
      'Name of employer or school',
    ])
      expect(labels).not.toContain(l);
  });

  it.each([
    ['marital_status', 'Marital status'],
    ['occupation', 'Occupation'],
    ['job_title', 'Job title'],
    ['employer_name', 'Name of employer or school'],
    ['employment_country', 'Country of employer or school'],
    ['employment_city', 'City / town of employer or school'],
    ['employment_since_year', 'Since what year'],
  ])('excluding %s lists %p for the applicant', (key, label) => {
    const p = WORKER;
    expect(
      buildMappingInputs(mapping(), p, new Set([key])).some(
        (i) => i.fieldKey === key,
      ),
    ).toBe(false);
    const notes = coverage(p, [key]).filter((n) => n.label === label);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ reason: 'fill_yourself' });
    expect(notes[0].note).toMatch(/requires it/);
  });

  it('excluding the group does not also list its follow-ups one by one', () => {
    const labels = coverage(WORKER, ['occupation']).map((n) => n.label);
    expect(labels).toContain('Occupation');
    expect(labels).not.toContain('Job title');
    expect(labels).not.toContain('Name of employer or school');
  });
});

describe('only the eTA job title waits for its options (awaitOptions)', () => {
  it('the eTA mapping marks the job title and nothing else', () => {
    const marked = mapping().filter((m) => m.awaitOptions);
    expect(marked.map((m) => m.selector)).toEqual([F.title]);
    expect(marked[0].op).toBe('select_text');
    const inputs = buildMappingInputs(mapping(), {
      job_title: 'Software engineer',
      ...JOB,
    });
    expect(
      inputs.filter((i) => i.awaitOptions).map((i) => i.targetField),
    ).toEqual([F.title]);
    expect(
      inputs.find((i) => i.targetField === F.occupation),
    ).not.toHaveProperty('awaitOptions');
  });

  it('TRV and super visa mappings have no select that waits', () => {
    expect(resolvePortalFill('ircc')!.some((m) => m.awaitOptions)).toBe(false);
    expect(
      resolvePortalFillFor('ircc', 'ca-super-visa')!.some(
        (m) => m.awaitOptions,
      ),
    ).toBe(false);
  });
});

describe('eTA employer country for a UK applicant (dry run 2026-10-18)', () => {
  // The eTA place list names the UK by nation; "United Kingdom" is no option.
  const UK = {
    occupation: 'Accountant',
    employment_status: 'Employed',
    employer_name: 'Test Ledger Ltd',
    employment_country: 'United Kingdom',
    employment_since_year: '2012',
    residential_address:
      '10 Test Street, London, Greater London, SW1A 1AA, England, United Kingdom',
  };

  it('works in the city they live in: the nation their address names', () => {
    expect(at({ ...UK, employment_city: 'London' }, F.country)).toBe('England');
    expect(at({ ...UK, employment_city: 'London' }, id('contactDetails_country'))).toBe('England');
  });

  it('works in another city: the nation is unknown, so the applicant chooses', () => {
    const p = { ...UK, employment_city: 'Edinburgh' };
    expect(at(p, F.country)).toBeUndefined();
    expect(left(p).map((l) => l.label)).toContain('Country of employer or school');
  });

  it('an employer country already given as a nation is written as given', () => {
    expect(
      at({ ...UK, employment_country: 'Scotland', employment_city: 'Glasgow' }, F.country),
    ).toBe('Scotland');
  });

  it('a non-UK employer country is untouched by the fallback', () => {
    expect(at({ ...UK, ...JOB }, F.country)).toBe('Pakistan');
  });
});
