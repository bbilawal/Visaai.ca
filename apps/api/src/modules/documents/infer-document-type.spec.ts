import { inferDocumentType } from './documents.service';

/**
 * The filename fallback, used only for uploads that are not tied to a checklist
 * slot. The old rule list matched a bare `letter` before anything else, so
 * `admission_letter.pdf` was filed as an employment letter and the extractor
 * then asked an admission letter for a salary.
 */
describe('inferDocumentType', () => {
  it.each([
    ['passport_bio_page.jpg', 'passport'],
    ['Admission_Letter.pdf', 'admission_letter'],
    ['UofT offer letter.pdf', 'admission_letter'],
    ['i-20.pdf', 'admission_letter'],
    ['birth certificate.pdf', 'birth_certificate'],
    ['Marriage-Certificate.pdf', 'marriage_certificate'],
    ['property deed 2019.pdf', 'property_document'],
    ['land title.pdf', 'property_document'],
    ['bank_statement_march.pdf', 'bank_statement'],
    ['payslip-jan.pdf', 'pay_stubs'],
    ['notice of assessment 2024.pdf', 'noa'],
    ['ITR_2024.pdf', 'tax_return'],
    ['employment letter.pdf', 'employment_letter'],
    ['invitation from uncle.pdf', 'invitation_letter'],
    ['flight itinerary.pdf', 'travel_itinerary'],
    ['hotel booking.pdf', 'hotel_booking'],
    ['police clearance certificate.pdf', 'police_clearance'],
    ['medical exam report.pdf', 'medical_exam'],
    ['travel insurance policy.pdf', 'medical_insurance'],
    // Prod 2026-10-14: `medical` matched first and an insurance policy was
    // filed as a medical exam.
    ['Medical Insurance_compressed.pdf', 'medical_insurance'],
    ['health insurance.pdf', 'medical_insurance'],
  ])('files %s as %s', (fileName, expected) => {
    expect(inferDocumentType(fileName)).toBe(expected);
  });

  it('files an admission letter as admission_letter, not employment_letter', () => {
    expect(inferDocumentType('admission_letter.pdf')).not.toBe(
      'employment_letter',
    );
  });

  it('leaves an unrecognisable name generic rather than guessing wrong', () => {
    expect(inferDocumentType('scan_0001.pdf')).toBe('document');
    expect(inferDocumentType('IMG_2043.jpg')).toBe('document');
  });
});
