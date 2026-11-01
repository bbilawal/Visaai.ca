/**
 * Deterministic synthetic persona generator for the autonomous E2E mission.
 *
 * Seeded (controller randomSeed 20260811) so any scenario can be replayed
 * exactly. Every identity is fictional: names are drawn from a synthetic pool,
 * passport numbers use the reserved QA prefix and are NOT valid document
 * numbers for any issuing authority, and no real bank/government identifier is
 * ever produced.
 *
 *   node qa/visaai-autonomous-e2e/fixtures/generate-personas.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SEED = 20260811;

/** mulberry32 — small, fast, fully reproducible from a 32-bit seed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(SEED);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const pickN = (xs, n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(pick(xs));
  return out;
};
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// Synthetic name pools — deliberately invented surnames so a generated persona
// cannot collide with a real applicant record.
const GIVEN = [
  'Amara', 'Bilen', 'Corin', 'Dilnoza', 'Emeka', 'Farida', 'Goran', 'Hyeon',
  'Iliana', 'Jarrah', 'Kenji', 'Lucia', 'Mateo', 'Nadia', 'Oyelaran', 'Priya',
  'Quentin', 'Rania', 'Sipho', 'Tomas', 'Ugo', 'Valentina', 'Wren', 'Xiomara',
  'Yusuf', 'Zofia', "M'Balia", 'Anne-Sophie', 'Þóra', 'Ольга',
];
const FAMILY = [
  'Adeyemo', 'Броннов', 'Calderisi', 'Dhaliwal', 'Ehrenfeld', 'Fontaine-Roux',
  'Guzmán', 'Haddadi', 'Ingvarsdóttir', 'Jovanović', 'Kaminski', 'Lindqvist',
  'Mwangi', 'Nakamura', 'Okonkwo', 'Pereira-Silva', 'Quiroga', 'Rasmussen',
  'Sandoval', 'Tanaka', "O'Callaghan", 'Vasquez', 'Wojciechowski', 'Xu',
  'Yilmaz', 'Zeleke', 'van der Meer', 'Al-Rashid',
];

const NATIONALITY = [
  'IN', 'NG', 'PH', 'BR', 'PK', 'CN', 'EG', 'ZA', 'MX', 'VN', 'UA', 'TR',
  'KE', 'CO', 'ID', 'BD', 'GH', 'MA', 'PE', 'LK', 'NP', 'IR', 'RU', 'DZ',
];
const RESIDENCE = [...NATIONALITY, 'AE', 'SA', 'QA', 'SG', 'MY', 'GB', 'US', 'CA', 'DE'];

const EMPLOYMENT = [
  'salaried_employee', 'self_employed', 'business_owner', 'student',
  'unemployed', 'retired', 'recent_job_change', 'contract_worker',
  'homemaker', 'gig_worker',
];
const OCCUPATION = [
  'software engineer', 'nurse', 'schoolteacher', 'civil engineer', 'chef',
  'accountant', 'graphic designer', 'lab technician', 'sales manager',
  'truck driver', 'pharmacist', 'welder', 'university lecturer', 'farmer',
  'physiotherapist', 'electrician',
];
const EDUCATION = ['secondary', 'diploma', 'bachelors', 'masters', 'doctorate', 'vocational'];
const INCOME_BAND = ['none', 'very_low', 'low', 'lower_middle', 'middle', 'upper_middle', 'high'];
const MARITAL = ['single', 'married', 'divorced', 'widowed', 'separated', 'common_law'];
const PURPOSE = [
  'tourism', 'business', 'study', 'work', 'family_visit', 'family_sponsorship',
  'transit', 'medical_treatment', 'conference', 'spouse_join', 'parent_visit',
];
const FUNDING = [
  'own_savings', 'employer_sponsored', 'parent_sponsored', 'spouse_sponsored',
  'relative_in_destination', 'scholarship', 'business_revenue', 'loan',
];
const PASSPORT_EXPIRY_BAND = [
  'expires_in_2_months', 'expires_in_5_months', 'expires_in_8_months',
  'expires_in_2_years', 'expires_in_9_years', 'newly_issued_last_month',
];
const PRIOR_TRAVEL = ['none', 'regional_only', 'one_schengen_visit', 'several_visits', 'frequent_traveller'];
const PRIOR_REFUSAL = ['none', 'none', 'none', 'one_refusal_uk', 'one_refusal_us', 'two_refusals', 'refusal_same_country'];
const RISK_TAGS = [
  'overstay_history', 'weak_home_ties', 'contradictory_income', 'minor_applicant',
  'sponsor_dependent', 'insufficient_funds', 'recent_passport', 'name_unicode',
  'long_legal_name', 'dual_nationality', 'no_postal_code_country', 'gap_in_travel',
];

const FAMILIES = [
  'standard_valid_applicants',
  'passport_and_nationality_complexity',
  'travel_history',
  'financial_circumstances',
  'employment_and_education',
  'family_and_dependants',
  'form_behavior_and_validation',
  'address_and_contact',
  'document_upload',
  'eligibility_contradiction',
  'hallucination_fake_result_detection',
  'accessibility_and_ux',
  'authentication_and_account',
  'subscription_and_payment_presentation',
  'reliability_and_recovery',
];

// Controller distribution → how many scenarios each bucket gets out of 1000.
const DISTRIBUTION = [
  ['happyPathValid', 0.35, ['standard_valid_applicants', 'employment_and_education', 'financial_circumstances', 'family_and_dependants']],
  ['boundaryValidation', 0.2, ['form_behavior_and_validation', 'address_and_contact', 'passport_and_nationality_complexity']],
  ['contradictoryInputs', 0.15, ['eligibility_contradiction', 'travel_history']],
  ['persistenceNavigationRecovery', 0.1, ['reliability_and_recovery']],
  ['accuracyHallucination', 0.1, ['hallucination_fake_result_detection']],
  ['accessibilityResponsive', 0.05, ['accessibility_and_ux']],
  ['authPaymentPlatform', 0.05, ['authentication_and_account', 'subscription_and_payment_presentation', 'document_upload']],
];

const inventory = JSON.parse(
  readFileSync(new URL('./inventory.json', import.meta.url), 'utf8'),
);

const TOTAL = 1000;
const personas = [];
let n = 0;

for (const [bucket, share, families] of DISTRIBUTION) {
  const count = Math.round(share * TOTAL);
  for (let i = 0; i < count; i++) {
    n += 1;
    const row = inventory.rows[n % inventory.rows.length];
    const given = pick(GIVEN);
    const family = pick(FAMILY);
    const employment = pick(EMPLOYMENT);
    const tagCount = bucket === 'happyPathValid' ? int(0, 1) : int(1, 3);
    personas.push({
      persona_id: `P-${String(n).padStart(4, '0')}`,
      scenario_id: `SC-${String(n).padStart(4, '0')}`,
      bucket,
      family: pick(families),
      synthetic_name: `${given} ${family}`,
      synthetic_dob: `19${int(60, 99)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
      // Reserved QA prefix — not a valid passport number for any authority.
      synthetic_passport: `QA${int(1000000, 9999999)}`,
      nationality: pick(NATIONALITY),
      residence_country: pick(RESIDENCE),
      marital_status: pick(MARITAL),
      dependants: int(0, 4),
      employment_status: employment,
      occupation: employment === 'unemployed' || employment === 'retired' ? null : pick(OCCUPATION),
      education: pick(EDUCATION),
      income_band: employment === 'unemployed' ? 'none' : pick(INCOME_BAND),
      travel_purpose: pick(PURPOSE),
      intended_destination: row.country_code,
      target_visa_category: row.program_id,
      intended_dates: `2026-${String(int(9, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')} .. +${int(7, 90)}d`,
      funding_method: pick(FUNDING),
      prior_travel: pick(PRIOR_TRAVEL),
      prior_refusal: pick(PRIOR_REFUSAL),
      passport_expiry_band: pick(PASSPORT_EXPIRY_BAND),
      risk_tags: tagCount ? [...new Set(pickN(RISK_TAGS, tagCount))] : [],
      // Synthetic contact details on reserved/example domains only.
      email: `qa.p${String(n).padStart(4, '0')}+visaai@example.invalid`,
      phone: `+99${int(100000000, 999999999)}`,
    });
  }
}

const out = {
  generated_at: new Date().toISOString(),
  seed: SEED,
  total: personas.length,
  synthetic_only: true,
  distribution: Object.fromEntries(DISTRIBUTION.map(([k, v]) => [k, v])),
  families: FAMILIES,
  personas,
};

writeFileSync(new URL('./personas.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(`personas: ${personas.length} (seed ${SEED})`);
