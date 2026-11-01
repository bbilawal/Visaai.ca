import { withoutUnaskedDeclarations } from './required-facts';

/**
 * Live 2026-10-19 (eTA, app 691755df): to "Yes, I was in close contact with
 * tuberculosis patients at work", the extractor also recorded "contact as a
 * health care worker: Yes" — a declaration IRCC asks separately, never asked.
 */
const ETA = {
  destinationCountry: 'CA',
  requirementsJson: { visaai_id: 'ca-electronic-travel-authorization-eta' },
};

describe('withoutUnaskedDeclarations', () => {
  it('drops a health-care-worker answer the question did not ask', () => {
    const out = withoutUnaskedDeclarations(
      {
        ...ETA,
        currentQuestion:
          'In the past two years, were you diagnosed with tuberculosis, or have you been in close contact with someone who has tuberculosis?',
      },
      { tuberculosis_last_2_years: true, tuberculosis_health_care_worker: true, tb_health_care_worker: true },
    );
    expect(out).toEqual({ tuberculosis_last_2_years: true });
  });

  it('keeps it when the question asked it', () => {
    const extracted = { tuberculosis_health_care_worker: true };
    expect(
      withoutUnaskedDeclarations(
        { ...ETA, currentQuestion: 'Is that contact with tuberculosis the result of being a health care worker?' },
        extracted,
      ),
    ).toEqual(extracted);
  });

  it('"ever diagnosed" only from its own question', () => {
    expect(
      withoutUnaskedDeclarations(
        { ...ETA, currentQuestion: 'Is that contact the result of being a health care worker?' },
        { tuberculosis_health_care_worker: true, tuberculosis_ever_diagnosed: false },
      ),
    ).toEqual({ tuberculosis_health_care_worker: true });
    expect(
      withoutUnaskedDeclarations(
        { ...ETA, currentQuestion: 'Have you ever been diagnosed with tuberculosis?' },
        { tuberculosis_ever_diagnosed: false },
      ),
    ).toEqual({ tuberculosis_ever_diagnosed: false });
  });

  it('leaves facts without the rule alone, and other routes untouched', () => {
    const extracted = { criminal_offence: false, occupation: 'Nurse' };
    expect(withoutUnaskedDeclarations({ ...ETA, currentQuestion: 'Anything?' }, extracted)).toEqual(extracted);
    const trv = { destinationCountry: 'CA', requirementsJson: { visaai_id: 'ca-visitor-visa-temporary-resident-visa' }, currentQuestion: 'x' };
    expect(withoutUnaskedDeclarations(trv, { tuberculosis: true })).toEqual({ tuberculosis: true });
  });
});
