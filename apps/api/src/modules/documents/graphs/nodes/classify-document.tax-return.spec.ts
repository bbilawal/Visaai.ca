import { classifyDocumentText, slotContentMismatch } from './classify-document';

// Synthetic, shape-only fixtures. Prod 2026-10-29 (TRV, "Self-employment income
// and tax records" slot): a Pakistani FBR Form 114(1) return of income was
// rejected as "a medical insurance policy". Its rent schedule has an
// "Insurance Premium" deduction line, and the insurance rule fired on
// `insurance` + `premium`. All names and figures below are invented.
const FBR_RETURN = `Federal Board of Revenue
114(1) (Return of Income filed voluntarily for complete year)
Tax Year 2026 Registration No 0000000000000 Name TEST APPLICANT
Income From Salary Employer Details M/S TEST TRADING
Income From Property Rent Received 100,000
Amount of Building for Repairs 20,000 Insurance Premium 0 Local Rate / Tax / Charge 0
Income From Business Manufacturing/Trading
Income / (Loss) from Business 500,000
Tax Chargeable 50,000 Admitted Income Tax 50,000
Wealth Statement Personal Assets and Liabilities
Any Other Asset(s) - CASH AND BANK BALANCE 250,000
Business Capital 1,000,000`;

const NTN_CERTIFICATE = `GOVERNMENT OF PAKISTAN
FEDERAL BOARD OF REVENUE
National Tax Number Certificate
NTN 0000000-0
Name TEST APPLICANT
Registered on 01-Jan-2020`;

const CRA_NOA = `Canada Revenue Agency
Notice of Assessment
Tax year 2025
Total income 85,000.00
Balance from this assessment 0.00`;

const PAYSLIP_WITH_INSURANCE_DEDUCTION = `TEST TRADING LLC
Monthly Pay Slip — March 2026
Employee: TEST APPLICANT
Mr. Test Applicant is employed with us as Sales Manager.
Basic Salary 120,000
Deductions: Group Insurance Premium 1,500  Income Tax 4,000
Net Pay 114,500`;

describe('classifyDocumentText — tax returns (prod 2026-10-29)', () => {
  it.each([
    ['an FBR return of income', FBR_RETURN],
    ['an FBR NTN certificate', NTN_CERTIFICATE],
    ['a CRA notice of assessment', CRA_NOA],
    ['a US 1040', 'Form 1040 U.S. Individual Income Tax Return 2025'],
  ])('files %s as a tax return, never as insurance', (_, text) => {
    expect(classifyDocumentText(text)).toBe('tax_return');
  });

  it('does not call a payslip with an insurance-premium deduction an insurance policy', () => {
    expect(classifyDocumentText(PAYSLIP_WITH_INSURANCE_DEDUCTION)).not.toBe(
      'medical_insurance',
    );
  });
});

describe('slotContentMismatch — tax records', () => {
  it.each([
    'self_employment_income',
    'self_employment_income_tax_records',
    'self_employment_tax_records',
    'business_income_tax_records',
    'tax_return',
    'income_tax_returns',
    'proof_of_funds',
    'bank_statement_6mo',
    'employment_letter',
    'proof_of_ties',
  ])('accepts an FBR return in the %s slot', (slot) => {
    expect(slotContentMismatch(slot, FBR_RETURN)).toBeNull();
    expect(slotContentMismatch(slot, NTN_CERTIFICATE)).toBeNull();
  });

  it('still flags a tax return where an identity document or exam belongs', () => {
    expect(slotContentMismatch('passport', FBR_RETURN)?.detected).toBe(
      'tax_return',
    );
    expect(slotContentMismatch('medical_exam', FBR_RETURN)?.detected).toBe(
      'tax_return',
    );
  });
});

// Review of 7397b0b6: documents that only MENTION a tax number or a return
// are not tax records. Synthetic, shape-only.
const BANK_WITH_NTN = `TEST BANK LIMITED
Account Statement
Account Number 0000-0000000-01 Account Title TEST APPLICANT
National Tax Number: 1234567-8
Opening Balance 10,000 Closing Balance 12,000`;

const BANK_WITH_FILER_FOOTER = `TEST BANK LIMITED
Account Statement
Account Number 0000-0000000-01 Closing Balance 12,000
Withholding tax deducted for Tax Year 2026. Non-filers: file your return of income to avoid higher deduction.`;

const EMPLOYMENT_LETTER_WITH_NTN = `TEST TRADING (PVT) LTD
National Tax Number 7654321-0
To whom it may concern
This is to certify that Mr. Test Applicant is employed with us as Sales Manager.`;

const SALES_TAX_INVOICE = `TEST SUPPLIES
Sales Tax Invoice No 42
National Tax Number (NTN) 1111111-1
Sales Tax Registration No 00-00-0000-000-00
Item Qty Rate Sales Tax 17% Total`;

const INSURANCE_SCHEDULE_WITH_NTN = `TEST INSURANCE COMPANY LIMITED
Health Insurance Policy Schedule
Policy No HP-0001 Insured TEST APPLICANT
Sum insured 1,000,000
National Tax Number 2222222-2`;

describe('classifyDocumentText — tax-number mentions are not tax records', () => {
  it.each([
    ['a bank statement printing the holder NTN', BANK_WITH_NTN, 'bank_statement'],
    ['a bank statement with a filer footer', BANK_WITH_FILER_FOOTER, 'bank_statement'],
    ['an employment letter with an NTN letterhead', EMPLOYMENT_LETTER_WITH_NTN, 'employment_letter'],
    ['an insurance schedule printing the insurer NTN', INSURANCE_SCHEDULE_WITH_NTN, 'medical_insurance'],
  ])('files %s by what it is', (_, text, expected) => {
    expect(classifyDocumentText(text)).toBe(expected);
  });

  it('does not file a sales-tax invoice as a tax return', () => {
    expect(classifyDocumentText(SALES_TAX_INVOICE)).not.toBe('tax_return');
  });

  it('does not file a payslip with an NTN letterhead as a tax return', () => {
    expect(
      classifyDocumentText(
        `National Tax Number 7654321-0\n${PAYSLIP_WITH_INSURANCE_DEDUCTION}`,
      ),
    ).toBe(classifyDocumentText(PAYSLIP_WITH_INSURANCE_DEDUCTION));
  });

  it('keeps an insurance schedule with an NTN acceptable in an insurance slot', () => {
    expect(
      slotContentMismatch('medical_insurance', INSURANCE_SCHEDULE_WITH_NTN),
    ).toBeNull();
  });
});
