/**
 * The study permit questionnaire mapping ('ircc-study') must emit exactly
 * what it emitted before the work permit questionnaire ('ircc-work') shared
 * its helpers (canada-ircc-eapp-common.ts, 2026-10-30). A consultant's locked
 * preflight review hashes the writes (selector, value, op…), so any change
 * here would silently unlock every reviewed study application.
 *
 * The fixture was generated from the mapping BEFORE the extraction
 * (UPDATE_EAPP_FIXTURE=1 rewrites it — do that only for an intended change,
 * and say so in the commit).
 */
import * as fs from 'fs';
import * as path from 'path';
import '../src/modules/automation/portal-fills/canada-ircc-study-eapp';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';

const FIXTURE = path.join(__dirname, 'fixtures', 'ircc-study-eapp-output.json');

/** Fictional applicants (no real person's data), covering every branch. */
const STUDENT: Record<string, unknown> = {
  family_name: 'Example',
  given_name: 'Test Student',
  date_of_birth: '1991-03-14',
  nationality: 'Pakistan',
  country_of_residence: 'Pakistan (citizen)',
  family_member_canadian_status: 'No',
  has_attestation_letter: 'Yes',
  study_province: 'Ontario',
  study_school_name: 'Example College of Applied Arts',
  dli_number: 'O000000000000',
  study_level: 'Post-graduate certificate',
  study_start_date: '2027-01-11',
  study_end_date: '2027-12-17',
  us_permanent_resident: 'No',
  marital_status: 'Married',
  spouse_coming_to_canada: 'No',
  has_children: 'Yes',
  children_accompanying: [],
  previous_canada_application: 'No',
  exchange_student: 'No',
  work_essential_to_studies: 'No',
  government_scholarship: 'No',
  family_member_status_in_canada: 'No',
  committed_crime: 'No',
  ever_arrested: 'No',
  ever_charged: 'No',
  ever_convicted: 'No',
  medical_exam_last_12_months: 'No',
  designated_country_six_months: 'Yes',
  uses_representative: 'No',
  biometrics_given: 'Yes',
};

const PROFILES: Record<string, Record<string, unknown>> = {
  recorded: STUDENT,
  empty: {},
  dobOnly: { date_of_birth: '1991-03-14' },
  quebecException: {
    ...STUDENT,
    study_province: 'Québec',
    has_attestation_letter: 'No, exchange student',
    marital_status: 'Single',
    family_member_status_in_canada: 'Yes',
    uses_representative: 'Yes',
  },
  yeses: {
    ...STUDENT,
    us_permanent_resident: 'Yes',
    ever_convicted: 'Yes',
    exchange_student: 'Yes',
    work_essential_to_studies: 'Yes',
    government_scholarship: 'Yes',
    medical_exam_last_12_months: 'Yes',
    designated_country_six_months: 'No',
    has_valid_canadian_permit: 'No',
    study_level: 'Secondary school',
    marital_status: 'Common-law',
    spouse_coming_to_canada: 'Yes',
    biometrics_given: 'No',
    country_of_residence: 'United Kingdom',
    nationality: 'GBN',
  },
  workFactsOnStudy: {
    ...STUDENT,
    work_permit_type: 'lmia',
    lmia_number: '1234567',
    work_start_date: '2027-01-11',
    work_end_date: '2029-01-10',
    principal_relationship: 'spouse of a worker',
    public_policy_or_special_measure: 'No',
  },
};

const regex = (r: unknown) => (r instanceof RegExp ? String(r) : undefined);

function output() {
  const mapping = resolvePortalFill('ircc-study')!;
  return {
    entries: mapping.map((f) => ({
      profileKey: f.profileKey,
      page: f.page,
      selector: f.selector,
      action: f.action,
      label: f.label,
      category: f.category,
      op: f.op,
      transform: f.transform,
      choices: f.choices,
      parent: f.parent,
      parentValue: f.parentValue,
      declaration: f.declaration,
      labelMatch: regex(f.labelMatch),
      pageMatch: regex(f.pageMatch),
      hasDerive: typeof f.derive === 'function',
    })),
    inputs: Object.fromEntries(
      Object.entries(PROFILES).map(([k, p]) => [
        k,
        buildMappingInputs(mapping, p),
      ]),
    ),
    coverage: Object.fromEntries(
      Object.entries(PROFILES).map(([k, p]) => [
        k,
        portalFillCoverage(mapping, p),
      ]),
    ),
  };
}

describe('study permit questionnaire output is unchanged by the work permit mapping', () => {
  it('emits byte-identical mapping entries, writes and coverage', () => {
    const now = JSON.stringify(output(), null, 2) + '\n';
    if (process.env.UPDATE_EAPP_FIXTURE === '1') {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, now);
    }
    expect(now).toBe(fs.readFileSync(FIXTURE, 'utf8'));
  });
});
