import type { VriInputData } from '../../src/modules/vri/graphs/vri.state';

/**
 * Anonymised replica of a real Canada TRV application (prod, 2026-10-14) that
 * the old VRI scored 27 with dummy numbers: home ties 0%, financial 0%,
 * employment 0%, documentation 100% — while the applicant owns two properties,
 * his wife and youngest son live at home, a sponsor declared CAD 30k, and six
 * of eleven uploads were never read (Azure OCR 429).
 *
 * Shape (keys, document types, OCR outcomes, cross-verification values) is
 * kept exactly; names, numbers and addresses are fictional.
 */
export const RETIREE_PROFILE: Record<string, unknown> = {
  retired: true,
  employed: false,
  full_name: 'TARIQ MAHMOOD',
  applicant_name: 'Tariq Mahmood',
  nationality: 'PAK',
  date_of_birth: '1960-03-10',
  spouse_name: 'Nadia Mahmood',
  passport_number: 'XX0000001',
  purpose_of_visit:
    'short family holiday to meet grandchild, spend holidays with family, and tourism',
  family_home_owned: true,
  additional_property_owned: true,
  additional_property_city: 'Murree',
  financial_support: 'son will cover trip costs',
  has_return_ticket: true,
  intends_to_return: true,
  youngest_son_in_home_country: true,
  spouse_in_home_country: true,
  family_ties_outside_destination: true,
  family_in_destination: true,
  grandchild_in_destination: true,
  will_provide_childcare: false,
  will_work_in_destination: false,
  son_annual_income_cad: 80000,
  other_son_annual_income_cad: 96254,
  other_son_supports_trip: true,
  available_trip_funds_cad: 30000,
  travel_history_countries: [],
  travel_medical_insurance: true,
  travel_medical_insurance_coverage_cad: 100000,
  planned_entry_date: '2026-12-01',
  planned_departure_date: '2027-01-31',
  duration_of_stay_days: 56,
  previous_visa_refused: true,
  previous_visa_refusal_date: '2025-06-30',
  previous_visa_refusal_reason:
    'IRPR 179(b); insufficient significant family ties outside Canada and purpose of helping with postpartum care for 12 months inconsistent with a temporary stay',
  other_visa_or_entry_refusals: false,
  immigration_violations: false,
  removal_orders: false,
  current_country_of_residence: 'Pakistan',
};

const ocr429 = {
  error:
    'OCR failed: azure-di analyze request failed (HTTP 429 Too Many Requests)',
  raw_ocr_length: 0,
  extracted_fields: {},
};

export const RETIREE_DATA: VriInputData = {
  profile: RETIREE_PROFILE,
  checklistItems: [
    {
      id: 'c1',
      document_type: 'form_imm_5257',
      required: true,
      status: 'verified',
    },
    {
      id: 'c2',
      document_type: 'passport_copy',
      required: true,
      status: 'verified',
    },
    {
      id: 'c3',
      document_type: 'travel_history',
      required: true,
      status: 'verified',
    },
  ],
  documents: [
    { id: 'passport', document_type: 'passport_copy', ocr_status: 'complete' },
    {
      id: 'invite',
      document_type: 'invitation_letter',
      ocr_status: 'complete',
    },
    { id: 'cnic', document_type: 'document', ocr_status: 'failed' },
    { id: 'emp', document_type: 'employment_letter', ocr_status: 'failed' },
    { id: 'pof', document_type: 'proof_of_funds', ocr_status: 'failed' },
    { id: 'med', document_type: 'medical_exam', ocr_status: 'failed' },
    { id: 'wife_id', document_type: 'document', ocr_status: 'complete' },
    {
      id: 'marriage',
      document_type: 'marriage_certificate',
      ocr_status: 'failed',
    },
    { id: 'bank', document_type: 'bank_statement', ocr_status: 'failed' },
    { id: 'own_id', document_type: 'document', ocr_status: 'complete' },
    { id: 'travel', document_type: 'travel_history', ocr_status: 'complete' },
  ],
  verifications: [
    {
      document_id: 'passport',
      verification_type: 'identity',
      result: 'pass',
      details_json: {
        extracted_fields: {
          full_name: 'TARIQ MAHMOOD',
          date_of_birth: '1960-03-10',
          passport_number: 'XX0000001',
          expiry_date: '2033-08-06',
        },
      },
    },
    {
      document_id: 'invite',
      verification_type: 'identity',
      result: 'pass',
      details_json: {
        extracted_fields: {
          host_status: 'a Canadian citizen',
          date_of_birth: 'June 2025,',
        },
      },
    },
    {
      document_id: 'cnic',
      verification_type: 'identity',
      result: 'fail',
      details_json: ocr429,
    },
    {
      document_id: 'emp',
      verification_type: 'identity',
      result: 'fail',
      details_json: ocr429,
    },
    {
      document_id: 'pof',
      verification_type: 'identity',
      result: 'fail',
      details_json: ocr429,
    },
    {
      document_id: 'med',
      verification_type: 'identity',
      result: 'fail',
      details_json: ocr429,
    },
    {
      document_id: 'wife_id',
      verification_type: 'identity',
      result: 'pass',
      details_json: {
        extracted_fields: {
          full_name: 'Nadia Mahmood Tariq Mahmood',
          date_of_birth: '10.03.1960',
        },
      },
    },
    {
      document_id: 'marriage',
      verification_type: 'identity',
      result: 'fail',
      details_json: ocr429,
    },
    {
      document_id: 'bank',
      verification_type: 'identity',
      result: 'fail',
      details_json: ocr429,
    },
    {
      document_id: 'own_id',
      verification_type: 'identity',
      result: 'pass',
      details_json: {
        extracted_fields: {
          full_name: 'Malik Abdul Ghani XQZ',
          date_of_birth: '10.03.1960',
        },
      },
    },
    {
      document_id: 'travel',
      verification_type: 'identity',
      result: 'pass',
      details_json: {
        extracted_fields: {
          full_name: 'MAHMOOD TARIQ',
          date_of_birth: '1960-03-10',
        },
      },
    },
  ],
  crossVerifications: [
    cv('date_of_birth', 'mismatch', '1960-03-10', 'June 2025,'),
    cv('full_name', 'mismatch', 'TARIQ MAHMOOD', 'Nadia Mahmood Tariq Mahmood'),
    cv('full_name', 'mismatch', 'TARIQ MAHMOOD', 'MAHMOOD TARIQ'),
    cv('date_of_birth', 'match', '1960-03-10', '1960-03-10'),
    cv('date_of_birth', 'mismatch', '1960-03-10', '10.03.1960'),
    cv('full_name', 'mismatch', 'TARIQ MAHMOOD', 'Malik Abdul Ghani XQZ'),
    cv('date_of_birth', 'mismatch', '1960-03-10', '10.03.1960'),
    cv('date_of_birth', 'mismatch', 'June 2025,', '1960-03-10'),
    cv('date_of_birth', 'mismatch', 'June 2025,', '10.03.1960'),
    cv('date_of_birth', 'mismatch', 'June 2025,', '10.03.1960'),
    cv('full_name', 'mismatch', 'MAHMOOD TARIQ', 'Nadia Mahmood Tariq Mahmood'),
    cv('date_of_birth', 'mismatch', '1960-03-10', '10.03.1960'),
    cv('full_name', 'mismatch', 'MAHMOOD TARIQ', 'Malik Abdul Ghani XQZ'),
    cv('date_of_birth', 'mismatch', '1960-03-10', '10.03.1960'),
    cv(
      'full_name',
      'mismatch',
      'Nadia Mahmood Tariq Mahmood',
      'Malik Abdul Ghani XQZ',
    ),
    cv('date_of_birth', 'match', '10.03.1960', '10.03.1960'),
  ],
  destinationCountry: 'CA',
  currentVisaType: null,
};

function cv(field: string, result: string, a: string, b: string) {
  return {
    field_compared: field,
    result,
    details_json: { value_a: a, value_b: b },
  };
}
