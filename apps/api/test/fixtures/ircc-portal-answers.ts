/**
 * Answers to every IRCC portal question the interview asks
 * (IRCC_PORTAL_FACTS in @visaai/types intake-requirements): a married
 * applicant with no children, no host, and "no" to every declaration. Not
 * employed, so the current-job and work-history questions do not apply;
 * no trips in the past 5 years and no biometrics given before.
 */
export const IRCC_PORTAL_ANSWERS: Record<string, unknown> = {
  available_funds_cad: 5000,
  country_of_birth: 'Pakistan',
  sex: 'Male',
  multiple_citizenship: false,
  citizen_from_birth: true,
  has_national_id: false,
  has_other_names: false,
  residence_since: 'since birth',
  marital_status: 'Married',
  marriage_date: '1990-05-12',
  spouse_name: 'Nadia Karim',
  spouse_date_of_birth: '1968-10-09',
  spouse_country_of_birth: 'Pakistan',
  spouse_occupation: 'Homemaker',
  spouse_same_address: true,
  spouse_coming_to_canada: false,
  has_children: false,
  parents: [{ name: 'A Parent', relationship: 'father', deceased: true, year_of_death: 1999 }],
  has_post_secondary_education: false,
  // Not working since 2012: the current period covers the last 10 years.
  not_employed_since: '2012-01',
  travelled_last_5_years: false,
  // Earlier countries of residence (tr-rt wave 2a): none.
  lived_elsewhere_last_5_years: false,
  // No host: where the tourist will stay (tr-rt wave 2a, TRV only).
  accommodation_provider_name: 'Lakeview Inn',
  accommodation_address: '200 Front St W, Toronto, ON M5V 3K2',
  held_canadian_visa_10_years: false,
  travel_by_air: true,
  biometrics_given: false,
  military_service: false,
  immigration_violations: false,
  refused_or_ordered_to_leave: false,
  committed_crime: false,
  ever_arrested: false,
  ever_charged: false,
  ever_convicted: false,
  violent_organization_member: false,
  ill_treatment: false,
  medical_exam_last_12_months: false,
  tuberculosis: false,
  tuberculosis_contact: false,
  dialysis: false,
  addiction: false,
  mental_health_condition: false,
  syphilis: false,
  native_language: 'Urdu',
  official_language_ability: 'English',
  residential_address: '12 Mall Road, Lahore, Punjab 54000, Pakistan',
  mailing_same_as_residential: true,
  trip_expenses_paid_by: 'Self',
  email: 'applicant@example.com',
  phone_number: '+92 300 0000000',
  phone_type: 'cell',
  other_phone_numbers: [],
};
