import {
  classifyDocumentText,
  refineIdentityFields,
  slotContentMismatch,
} from './classify-document';

/**
 * Super visa test uploads on prod app 61f16bb5 (2026-10-16, user-approved
 * dummy documents).
 */

// Shape of DUMMY_ime.pdf: an upfront-medical confirmation from a panel clinic.
// It names IRCC, which is what made the classifier call it IRCC
// correspondence and the IME slot reject it.
const IME_CONFIRMATION = `Upfront Immigration Medical Examination - Confirmation
Immigration, Refugees and Citizenship Canada (IRCC) panel physician
Applicant: SUMERA AHMAD   Date of birth: 1968-10-09
Passport: AL1183581
Exam date: 2026-10-10
IME / UMI number: DUMMY-0000000000
Panel clinic: TEST DUMMY Medical Centre, Islamabad
Examining physician: Dr. TEST DUMMY`;

const REFUSAL = `Immigration, Refugees and Citizenship Canada
June 30, 2025
IMM 5621 — your application is refused. I am not satisfied you will leave Canada.`;

const IME_FIELDS: Record<string, unknown> = {
  full_name: 'SUMERA AHMAD',
  expiry_date: '2026-10-10',
};

describe('upfront medical exam confirmation', () => {
  it('is a medical exam, not IRCC correspondence, even though it names IRCC', () => {
    expect(classifyDocumentText(IME_CONFIRMATION)).toBe('medical_exam');
  });

  it('still recognises a refusal letter', () => {
    expect(classifyDocumentText(REFUSAL)).toBe('refusal_letter');
  });

  it('fits the medical exam slot', () => {
    expect(
      slotContentMismatch('proof_of_medical_exam', IME_CONFIRMATION),
    ).toBeNull();
  });

  it('lets IRCC medical instructions sit in the medical exam slot', () => {
    // IRCC sends medical instructions after applying when no upfront exam
    // was taken: that letter is what the slot holds in the meantime.
    const instructions = `Immigration, Refugees and Citizenship Canada
Medical instructions: you must undergo a medical examination within 30 days.`;
    expect(
      slotContentMismatch('proof_of_medical_exam', instructions),
    ).toBeNull();
  });

  it('moves a labelled exam date out of expiry_date', () => {
    const { fields, adjustments } = refineIdentityFields(
      'proof_of_medical_exam',
      IME_CONFIRMATION,
      IME_FIELDS,
    );
    expect(fields.exam_date).toBe('2026-10-10');
    expect(fields.expiry_date).toBeUndefined();
    expect(adjustments.expiry_date).toMatch(/exam date/);
  });

  it('keeps a real expiry date that is not the exam date', () => {
    const { fields } = refineIdentityFields('medical_exam', IME_CONFIRMATION, {
      expiry_date: '2027-10-10',
    });
    expect(fields.expiry_date).toBe('2027-10-10');
  });
});

describe('field hygiene', () => {
  it('drops a currency that is not a currency code', () => {
    // DUMMY_insurance.pdf: currency "paid in full".
    const { fields, adjustments } = refineIdentityFields(
      'medical_insurance',
      'policy text',
      { currency: 'paid in full', coverage_amount: 100000 },
    );
    expect(fields.currency).toBeUndefined();
    expect(fields.coverage_amount).toBe(100000);
    expect(adjustments.currency).toBeDefined();
  });

  it('keeps an ISO currency code', () => {
    const { fields } = refineIdentityFields('medical_insurance', 'x', {
      currency: 'CAD',
    });
    expect(fields.currency).toBe('CAD');
  });
});
