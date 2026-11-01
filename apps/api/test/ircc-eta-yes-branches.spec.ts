/**
 * The "Yes" branches of the IRCC eTA form, recorded live 2026-10-18:
 *
 *  1. CAN+ prerequisites (Mexican persona): U.S. permanent resident → noted
 *     nationality → travelling by air → Canadian visa in 10 years → valid U.S.
 *     non-immigrant visa → its number (twice) and expiry date.
 *  2. Previously applied to Canada → UCI.
 *  3. Refused / denied entry → refusal details.
 *  4. Criminal offence → arrest, charge or conviction details.
 *  5. Tuberculosis → health-care worker → ever diagnosed.
 *  6. Listed conditions: no follow-up.
 *  7. Travel date not known → no date.
 *  8. Representative: left to the applicant.
 *  9. Additional citizenship: left to the applicant.
 *
 * Each child is written only under its parent's answer, and every background
 * answer only from the applicant's explicit answer.
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import '../src/modules/automation/portal-fills/canada-ircc-eta'; // registers 'ircc-eta'
import { IRCC_ETA_FACTS, missingIntakeFacts, CA_ETA_VISAAI_ID } from '@visaai/types';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import { criminalDetails } from '../src/modules/automation/portal-fills/canada-ircc-eta';

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
const ETA = { country: 'CA', visaaiId: CA_ETA_VISAAI_ID };
const asks = (p: Record<string, unknown>) =>
  missingIntakeFacts(p, ETA).map((s) => s.key);

const PRE = {
  code: id('prerequisite_countryOfCitizenship'),
  usPr: id('prerequisite_isPermanentResidentOfUSAndHaveProofOfPermResidence'),
  nationality: id('prerequisite_passportNotedNationality'),
  air: id('prerequisite_isTravellingByAir'),
  caVisa: id('prerequisite.etaExpansion_hasCanadianTemporaryVisa'),
  usVisa: id('prerequisite.etaExpansion_hasNonImmigrantVisa'),
  number: id('prerequisite.etaExpansion_nonImmigrantVisaNumber'),
  numberAgain: id('prerequisite.etaExpansion_nonImmigrantVisaNumberReEnter'),
  year: id('prerequisite.etaExpansion_nonImmigrantVisaNumberExpiryDateYear'),
  month: id('prerequisite.etaExpansion_nonImmigrantVisaNumberExpiryDateMonth'),
  day: id('prerequisite.etaExpansion_nonImmigrantVisaNumberExpiryDateDay'),
};
const CHAIN = [
  PRE.usPr,
  PRE.air,
  PRE.caVisa,
  PRE.usVisa,
  PRE.number,
  PRE.numberAgain,
  PRE.year,
  PRE.month,
  PRE.day,
];

const BG = {
  refused: id('backgroundQuestions_refusedVisaOrPermitOrDeniedEntryToCanada'),
  refusedDetails: id(
    'backgroundQuestions_refusedVisaOrPermitOrDeniedEntryToCanadaDetails',
  ),
  criminal: id(
    'backgroundQuestions_committedOrArrestedOrChargedOrConvictedOfCriminalOffenceAnywhere',
  ),
  criminalDetails: id(
    'backgroundQuestions_committedOrArrestedOrChargedOrConvictedOfCriminalOffenceAnywhereDetails',
  ),
  tb: id(
    'backgroundQuestions_inThePastTwoYearsWereYouDiagnosedOrInCloseContactWithTuberculosis',
  ),
  tbWorker: id(
    'backgroundQuestions_isYourContactWithTuberculosisTheResultOfBeingAHeathCareWorker',
  ),
  tbEver: id('backgroundQuestions_haveYouEverBeenDiagnosedWithTuberculosis'),
  conditions: id('backgroundQuestions_doYouHaveOneOfTheseConditions'),
};

/** A Mexican applicant with a valid U.S. visa (live persona 2026-10-18). */
const MEX: Record<string, unknown> = {
  passport_country: 'MEX',
  nationality: 'Mexico',
  us_permanent_resident: false,
  travel_by_air: true,
  canadian_visa_last_10y: false,
  valid_us_nonimmigrant_visa: true,
  us_nonimmigrant_visa_number: 'A1234567',
  us_nonimmigrant_visa_expiry_date: '2028-06-05',
};

describe('1. CAN+ prerequisites (Mexican persona)', () => {
  it('fills the whole chain, in form order, with nationality "Mexico"', () => {
    const w = writes(MEX).filter(([f]) => f.includes('prerequisite'));
    expect(w).toEqual([
      [PRE.code, 'MEX (Mexico)'],
      [PRE.usPr, 'No'],
      [PRE.nationality, 'Mexico'],
      [PRE.air, 'Yes'],
      [PRE.caVisa, 'No'],
      [PRE.usVisa, 'Yes'],
      [PRE.number, 'A1234567'],
      [PRE.numberAgain, 'A1234567'],
      [PRE.year, '2028'],
      [PRE.month, 'June'],
      [PRE.day, '05'],
    ]);
  });

  it('a GBR passport sees none of the chain; nationality stays "UK - British citizen"', () => {
    const w = writes({
      ...MEX,
      passport_country: 'United Kingdom',
      nationality: 'United Kingdom',
    });
    for (const sel of CHAIN) expect(w.find(([f]) => f === sel)).toBeUndefined();
    expect(at({ nationality: 'United Kingdom' }, PRE.nationality)).toBe(
      'UK - British citizen',
    );
  });

  it('nationality unknown: nothing of the chain is written', () => {
    const { passport_country: _a, nationality: _b, ...rest } = MEX;
    const w = writes(rest);
    for (const sel of CHAIN) expect(w.find(([f]) => f === sel)).toBeUndefined();
  });

  it('U.S. permanent resident "Yes": answered, then nothing else of the chain; the note says no eTA is needed', () => {
    const p = { ...MEX, us_permanent_resident: true };
    expect(at(p, PRE.usPr)).toBe('Yes');
    for (const sel of CHAIN.slice(1)) expect(at(p, sel)).toBeUndefined();
    const note = left(p).find((n) => n.label === 'The rest of the eTA form');
    expect(note?.note).toMatch(/does not need an eTA/);
  });

  it('U.S. permanent resident unanswered: nothing of the chain, and the question is listed', () => {
    const { us_permanent_resident: _x, ...p } = MEX;
    for (const sel of CHAIN) expect(at(p, sel)).toBeUndefined();
    expect(left(p)).toContainEqual({
      label: 'U.S. permanent residence question',
      reason: 'not_in_profile',
    });
  });

  it('a CAN+ national who answered it is not told to fill it themselves', () => {
    expect(
      left(MEX).some((n) => n.label === 'U.S. permanent residence question'),
    ).toBe(false);
  });

  it('not travelling by air: "No" written, the visa questions are not', () => {
    const p = { ...MEX, travel_by_air: false };
    expect(at(p, PRE.air)).toBe('No');
    for (const sel of CHAIN.slice(2)) expect(at(p, sel)).toBeUndefined();
  });

  it('Canadian visa "Yes", U.S. visa "No": no number or expiry date', () => {
    const p = {
      ...MEX,
      canadian_visa_last_10y: 'yes',
      valid_us_nonimmigrant_visa: 'no',
    };
    expect(at(p, PRE.caVisa)).toBe('Yes');
    expect(at(p, PRE.usVisa)).toBe('No');
    for (const sel of CHAIN.slice(4)) expect(at(p, sel)).toBeUndefined();
  });

  it('the U.S. visa question waits for the 10-year answer', () => {
    const { canadian_visa_last_10y: _x, ...p } = MEX;
    expect(at(p, PRE.caVisa)).toBeUndefined();
    expect(at(p, PRE.usVisa)).toBeUndefined();
  });

  it('only explicit yes/no answers the prerequisite questions', () => {
    expect(at({ ...MEX, travel_by_air: 'probably' }, PRE.air)).toBeUndefined();
    expect(
      at({ ...MEX, us_permanent_resident: 'not sure' }, PRE.usPr),
    ).toBeUndefined();
  });

  it('the interview asks the U.S. visa number and expiry only after a U.S. visa "Yes"', () => {
    const base = { nationality: 'Mexico', travel_by_air: true };
    expect(asks({ ...base, valid_us_nonimmigrant_visa: false })).not.toContain(
      'us_nonimmigrant_visa_number',
    );
    const yes = asks({ ...base, valid_us_nonimmigrant_visa: true });
    expect(yes).toContain('us_nonimmigrant_visa_number');
    expect(yes).toContain('us_nonimmigrant_visa_expiry_date');
    expect(asks({ nationality: 'GB' })).not.toContain(
      'us_nonimmigrant_visa_number',
    );
  });
});

describe('2. previously applied to Canada → UCI', () => {
  const uci = id('personalDetails_uci');
  const uciAgain = id('personalDetails_uciReEnter');

  it('Yes with a UCI: both UCI fields written', () => {
    const p = { previous_canada_application: true, uci: '1234-5678' };
    expect(at(p, id('personalDetails_hasPreviouslyAppliedToCanada'))).toBe(
      'Yes',
    );
    expect(at(p, uci)).toBe('1234-5678');
    expect(at(p, uciAgain)).toBe('1234-5678');
  });

  it('No: the UCI is never written, even when one is stored', () => {
    const p = { previous_canada_application: false, uci: '1234-5678' };
    expect(at(p, id('personalDetails_hasPreviouslyAppliedToCanada'))).toBe(
      'No',
    );
    expect(at(p, uci)).toBeUndefined();
    expect(at(p, uciAgain)).toBeUndefined();
  });
});

describe('3. refusal details', () => {
  it('Yes + a list of refusal records: one sentence each, nothing added', () => {
    const p = {
      refused_visa_or_denied_entry: true,
      refusal_details: [
        {
          country: 'United States',
          what_was_refused: 'visitor visa',
          month_year: '2019-04',
          reason: 'ties to home country',
        },
        { country: 'Canada', what_was_refused: 'study permit', month_year: '2021-09' },
      ],
    };
    expect(at(p, BG.refused)).toBe('Yes');
    expect(at(p, BG.refusedDetails)).toBe(
      'Visitor visa refused by United States in 2019-04. Reason given: ties to home country. Study permit refused by Canada in 2021-09.',
    );
  });

  it('Yes + the applicant\'s own text: written as given', () => {
    const p = {
      refused_visa_or_denied_entry: 'yes',
      refusal_details: 'Refused a UK visitor visa in 2018.',
    };
    expect(at(p, BG.refusedDetails)).toBe('Refused a UK visitor visa in 2018.');
  });

  it('Yes without details: the box is left and listed as needing their answer', () => {
    const p = { refused_visa_or_denied_entry: true };
    expect(at(p, BG.refusedDetails)).toBeUndefined();
    expect(left(p)).toContainEqual({
      label: 'Refusal, denied entry or removal — details',
      reason: 'needs_your_answer',
    });
  });

  it('No: details never written, even when stored', () => {
    const p = {
      refused_visa_or_denied_entry: false,
      refusal_details: 'Refused a UK visitor visa in 2018.',
    };
    expect(at(p, BG.refused)).toBe('No');
    expect(at(p, BG.refusedDetails)).toBeUndefined();
    expect(left(p).some((n) => /Refusal/.test(n.label))).toBe(false);
  });

  it('the interview asks for the details only after a "Yes"', () => {
    expect(asks({ refused_visa_or_denied_entry: false })).not.toContain(
      'refusal_details',
    );
    expect(asks({ refused_visa_or_denied_entry: true })).toContain(
      'refusal_details',
    );
  });
});

describe('4. criminality details', () => {
  it('Yes + records: where, when, offence and sentence as given', () => {
    const p = {
      criminal_offence: true,
      criminal_offence_details: [
        {
          city: 'Leeds',
          country: 'England',
          month_year: '2015-03',
          offence: 'shoplifting',
          sentence: 'fine of GBP 200',
        },
      ],
    };
    expect(at(p, BG.criminal)).toBe('Yes');
    expect(at(p, BG.criminalDetails)).toBe(
      'Shoplifting in Leeds, England in 2015-03. Sentence: fine of GBP 200.',
    );
  });

  it('a record without a sentence adds none', () => {
    expect(
      criminalDetails({
        criminal_offence_details: [
          { city: 'Lahore', country: 'Pakistan', month_year: '2010-01', offence: 'traffic offence' },
        ],
      }),
    ).toBe('Traffic offence in Lahore, Pakistan in 2010-01.');
  });

  it("the visitor-visa interview's per-part details are joined, each once", () => {
    expect(
      criminalDetails({
        ever_arrested_details: 'Arrested in Leeds in 2015',
        conviction_details: 'Convicted of shoplifting, fined GBP 200.',
        criminal_conviction_details: 'Convicted of shoplifting, fined GBP 200.',
      }),
    ).toBe('Arrested in Leeds in 2015. Convicted of shoplifting, fined GBP 200.');
  });

  it('Yes without details: left, listed as needing their answer', () => {
    const p = { criminal_offence: true };
    expect(at(p, BG.criminalDetails)).toBeUndefined();
    expect(left(p)).toContainEqual({
      label: 'Arrest, charge or conviction — details',
      reason: 'needs_your_answer',
    });
  });

  it('No: details never written', () => {
    const p = { criminal_offence: false, criminal_offence_details: 'x' };
    expect(at(p, BG.criminal)).toBe('No');
    expect(at(p, BG.criminalDetails)).toBeUndefined();
  });

  it('the interview asks for the details only after a "Yes"', () => {
    expect(asks({ criminal_offence: false })).not.toContain(
      'criminal_offence_details',
    );
    expect(asks({ criminal_offence: true })).toContain(
      'criminal_offence_details',
    );
  });
});

describe('5. tuberculosis chain', () => {
  it('TB Yes → worker Yes → ever diagnosed', () => {
    const p = {
      tuberculosis_last_2_years: true,
      tuberculosis_health_care_worker: true,
      tuberculosis_ever_diagnosed: false,
    };
    expect(at(p, BG.tb)).toBe('Yes');
    expect(at(p, BG.tbWorker)).toBe('Yes');
    expect(at(p, BG.tbEver)).toBe('No');
  });

  it('worker No: nothing more', () => {
    const p = {
      tuberculosis_last_2_years: true,
      tuberculosis_health_care_worker: false,
      tuberculosis_ever_diagnosed: true,
    };
    expect(at(p, BG.tbWorker)).toBe('No');
    expect(at(p, BG.tbEver)).toBeUndefined();
  });

  it('TB No: neither follow-up, even when stored', () => {
    const p = {
      tuberculosis_last_2_years: false,
      tuberculosis_health_care_worker: true,
      tuberculosis_ever_diagnosed: true,
    };
    expect(at(p, BG.tbWorker)).toBeUndefined();
    expect(at(p, BG.tbEver)).toBeUndefined();
  });

  it('follow-ups are never inferred from absence; unanswered ones need their answer', () => {
    const p = { tuberculosis_last_2_years: true };
    expect(at(p, BG.tbWorker)).toBeUndefined();
    expect(left(p)).toContainEqual({
      label: 'Tuberculosis contact the result of being a health care worker',
      reason: 'needs_your_answer',
    });
    const q = { ...p, tuberculosis_health_care_worker: true };
    expect(at(q, BG.tbEver)).toBeUndefined();
    expect(left(q)).toContainEqual({
      label: 'Ever diagnosed with tuberculosis',
      reason: 'needs_your_answer',
    });
  });

  it('a "Yes" to a diagnosis in the past two years answers "ever diagnosed" Yes; a "No" answers nothing', () => {
    const base = {
      tuberculosis_last_2_years: true,
      tuberculosis_health_care_worker: true,
    };
    expect(at({ ...base, tuberculosis_diagnosed: true }, BG.tbEver)).toBe('Yes');
    expect(
      at({ ...base, tuberculosis_diagnosed: false }, BG.tbEver),
    ).toBeUndefined();
  });

  it('only exact yes/no answers the follow-ups', () => {
    const p = {
      tuberculosis_last_2_years: true,
      tuberculosis_health_care_worker: 'I am a nurse',
    };
    expect(at(p, BG.tbWorker)).toBeUndefined();
  });

  it('the interview asks "ever diagnosed" only after a health-care-worker "Yes"', () => {
    expect(
      asks({ tuberculosis_last_2_years: true, tuberculosis_health_care_worker: false }),
    ).not.toContain('tuberculosis_ever_diagnosed');
    expect(
      asks({ tuberculosis_last_2_years: true, tuberculosis_health_care_worker: true }),
    ).toContain('tuberculosis_ever_diagnosed');
  });
});

describe('6. listed conditions', () => {
  it('any option reveals nothing more to fill', () => {
    const p = { eta_medical_conditions: 'Untreated syphilis' };
    const after = writes(p).filter(([f]) =>
      f.startsWith('[id="applicationDetails.backgroundQuestions_'),
    );
    expect(after).toEqual([[BG.conditions, 'Untreated syphilis']]);
  });
});

describe('7. travel date not known', () => {
  it('No: no date written', () => {
    const p = { travel_date_known: false, planned_entry_date: '2026-12-01' };
    expect(at(p, id('travelDetails_isTravelDateKnown'))).toBe('No');
    expect(
      writes(p).filter(([f]) => f.includes('travelDetails_travelDate')),
    ).toEqual([]);
    expect(
      left(p).some((n) => n.label === 'Time and time zone of your flight'),
    ).toBe(false);
  });
});

describe('8. representative stays with the applicant', () => {
  it('Yes: the question is answered, the representative page is not mapped and is listed', () => {
    const p = { applying_on_behalf: true };
    expect(at(p, '[id="welcome_isRepresentative"]')).toBe('Yes');
    expect(mapping().some((m) => /representative/i.test(m.selector) && m.selector !== '[id="welcome_isRepresentative"]')).toBe(false);
    expect(left(p)).toContainEqual({
      label: 'Representative details',
      reason: 'fill_yourself',
    });
    expect(
      left({ applying_on_behalf: false }).some(
        (n) => n.label === 'Representative details',
      ),
    ).toBe(false);
  });
});

describe('9. additional citizenship (recorded live 2026-10-19)', () => {
  it('is mapped, optional: unanswered is a gentle note', () => {
    expect(
      mapping().some((m) => /additionalCitizenship/.test(m.selector)),
    ).toBe(true);
    expect(left({}).some((n) => n.label === 'Additional citizenship')).toBe(
      true,
    );
  });
});

describe('notes', () => {
  it('no longer tells the applicant to write the details of a "Yes" themselves', () => {
    const p = {
      refused_visa_or_denied_entry: true,
      refusal_details: 'Refused a UK visitor visa in 2018.',
      criminal_offence: true,
      criminal_offence_details: 'Fined in Leeds in 2015 for shoplifting.',
    };
    expect(left(p).some((n) => /Details for each/.test(n.label))).toBe(false);
    for (const label of [
      'Refusal, denied entry or removal — details',
      'Arrest, charge or conviction — details',
    ])
      expect(left(p).some((n) => n.label === label)).toBe(false);
  });

  it('every new eTA fact is a form fact', () => {
    for (const k of [
      'us_nonimmigrant_visa_number',
      'us_nonimmigrant_visa_expiry_date',
      'refusal_details',
      'criminal_offence_details',
      'tuberculosis_ever_diagnosed',
    ])
      expect(IRCC_ETA_FACTS.find((f) => f.key === k)?.form).toBeDefined();
  });
});

describe('findings from the Mexican live run (2026-10-19)', () => {
  const street = id('contactDetails_streetNo');
  const name = id('contactDetails_streetAddress');
  const at2 = (p: Record<string, unknown>, sel: string) =>
    buildMappingInputs(resolvePortalFill('ircc-eta')!, p).find((i) => i.targetField === sel)?.mappedValue;

  it.each([
    ['Av. Prueba 123, Guadalajara, Jalisco, 44100, Mexico', '123', 'Av. Prueba'],
    ['Calle Sol No. 12, Monterrey, Nuevo León, 64000, Mexico', '12', 'Calle Sol'],
    ['Hauptstraße 5, 10115 Berlin, Germany', '5', 'Hauptstraße'],
    ['10 Test Street, London, Greater London, SW1A 1AA, England, United Kingdom', '10', 'Test Street'],
  ])('street number after the street: %s', (addr, no, st) => {
    const p = { residential_address: addr };
    expect(at2(p, street)).toBe(no);
    expect(at2(p, name)).toBe(st);
  });

  it('refusal details keep where it happened', () => {
    const p = {
      refused_visa_or_denied_entry: true,
      refusal_details: [
        { country: 'United States', what_was_refused: 'B1/B2 visitor visa', month_year: '2015-03', where: 'Mexico City', reason: 'Did not show strong enough ties' },
      ],
    };
    expect(at2(p, id('backgroundQuestions_refusedVisaOrPermitOrDeniedEntryToCanadaDetails'))).toBe(
      'B1/B2 visitor visa refused by United States in Mexico City in 2015-03. Reason given: Did not show strong enough ties.',
    );
  });
});
