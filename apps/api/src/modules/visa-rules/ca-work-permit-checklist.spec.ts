import { readFileSync } from 'fs';
import { join } from 'path';
import { profileToRuleFacts } from './profile-to-rule-facts';
import {
  convertRegistryToFramework,
  type RegistryRequirement,
} from './registry-to-framework';
import { validateRule } from './rule-evaluator';
import type { RuleFacts } from './rule.types';

/**
 * The work permit checklist, derived from the extraction file the registry
 * migration is generated from (data/requirements/ca-work-permit.json), so
 * this fails if the data regresses, not only if the code does.
 *
 * Measured against IRCC's forms-and-documents page for a work permit made
 * outside Canada (2026-07-17), guide 5487, the IMM 5645 page, the eligibility
 * page, the family open work permit page and the medical-exam country table,
 * all read 2026-10-29. Before v2 every applicant — the spouse of a worker on
 * an open permit included — was asked for an LMIA, and nobody was asked for a
 * passport, a photo, IMM 5645 or a medical exam.
 */
interface ExtractionRow extends Omit<
  RegistryRequirement,
  'description' | 'official_form_code' | 'official_form_url' | 'rule'
> {
  description?: string;
  official_form_code?: string;
  official_form_url?: string;
  rule?: unknown;
  source_role: string;
  source_excerpt: string;
}

const file = join(__dirname, '../../../../../data/requirements/ca-work-permit.json');
const doc = JSON.parse(readFileSync(file, 'utf8')) as {
  source_roles: Record<string, string>;
  requirements: ExtractionRow[];
};
const rows = doc.requirements.map(
  (r): RegistryRequirement => ({
    requirement_code: r.requirement_code,
    kind: r.kind,
    officially_required: r.officially_required,
    label: r.label,
    description: r.description ?? null,
    official_form_code: r.official_form_code ?? null,
    official_form_url: r.official_form_url ?? null,
    rule: r.rule ?? null,
    display_order: r.display_order,
    parameters: r.parameters ?? {},
  }),
);

const NOW = new Date('2026-10-29T00:00:00Z');

const BASE = {
  applicant_citizenship: 'Pakistan',
  country_of_residence: 'Pakistan',
  date_of_birth: '1994-03-02',
  marital_status: 'Single',
  work_start_date: '2027-02-01',
  work_end_date: '2028-01-31',
  public_health_occupation: 'No',
  designated_country_six_months: 'Yes',
};
const LMIA = { ...BASE, work_permit_type: 'lmia', work_location_province: 'Ontario' };
const EXEMPT = { ...BASE, work_permit_type: 'LMIA-exempt', work_location_province: 'Ontario' };
const OPEN_SPOUSE = {
  ...BASE,
  marital_status: 'Married',
  work_permit_type: 'open',
  principal_relationship: 'spouse of a worker',
};

const EMPLOYER_DOCS = [
  'current_employer_letter',
  'past_employer_reference_letters',
  'proof_of_past_work_experience',
  'proof_of_job_requirements',
  'resume',
];
const OPEN_FAMILY_DOCS = [
  'proof_of_relationship_to_principal',
  'principal_work_permit_copy',
  'principal_occupation_letter',
];

function checklist(facts: RuleFacts) {
  const result = convertRegistryToFramework('ca-work-permit', rows, facts);
  return {
    ...result,
    docs: new Map(result.framework.base_documents.map((d) => [d.type, d])),
    forms: result.framework.base_forms.map((f) => f.form_code),
  };
}
const fromProfile = (profile: Record<string, unknown>) =>
  checklist(profileToRuleFacts(profile, NOW));

describe('ca-work-permit checklist (from the registry extraction)', () => {
  it('every rule is valid in the closed rule language', () => {
    for (const r of doc.requirements) {
      if (r.rule) expect(validateRule(r.rule)).toEqual([]);
    }
  });

  it('asks every applicant for IMM 1295, IMM 5645, the passport and a photo', () => {
    for (const p of [LMIA, EXEMPT, OPEN_SPOUSE]) {
      const c = fromProfile(p);
      expect(c.forms).toEqual(['IMM 1295', 'IMM 5645']);
      expect(c.docs.get('passport_copy')?.required).toBeUndefined();
      expect(c.docs.get('passport_photos')?.required).toBeUndefined();
    }
  });

  describe('employer-specific with an LMIA', () => {
    const c = fromProfile(LMIA);

    it('lists the LMIA and contract, the number and the job offer letter', () => {
      for (const t of [
        'lmia_and_employment_contract',
        'lmia_or_offer_of_employment_number',
        'job_offer_letter',
      ]) {
        expect(c.docs.get(t)?.required).toBeUndefined();
      }
    });

    it('lists the employer-specific documents IRCC always asks for', () => {
      for (const t of EMPLOYER_DOCS) expect(c.docs.has(t)).toBe(true);
    });

    it('leaves out the open-permit documents and fee, and the LMIA-exempt contract', () => {
      expect(c.excluded).toEqual(
        expect.arrayContaining([
          ...OPEN_FAMILY_DOCS,
          'open_work_permit_holder_fee',
          'employment_contract_lmia_exempt',
          'quebec_acceptance_certificate',
        ]),
      );
    });

    it('treats a SAWP worker as an LMIA worker', () => {
      const sawp = fromProfile({ ...BASE, work_permit_type: 'sawp' });
      expect(sawp.docs.has('lmia_and_employment_contract')).toBe(true);
      expect(sawp.docs.has('job_offer_letter')).toBe(true);
    });
  });

  describe('the Quebec acceptance certificate', () => {
    it('is asked for an LMIA job in Quebec of more than 30 days', () => {
      const c = fromProfile({ ...LMIA, work_location_province: 'Quebec' });
      expect(c.docs.has('quebec_acceptance_certificate')).toBe(true);
    });

    it('is not asked for 30 days or less', () => {
      const c = fromProfile({
        ...LMIA,
        work_location_province: 'Quebec',
        work_start_date: '2027-02-01',
        work_end_date: '2027-02-20',
      });
      expect(c.excluded).toContain('quebec_acceptance_certificate');
    });

    it('is not asked for an LMIA-exempt job in Quebec', () => {
      const c = fromProfile({ ...EXEMPT, work_location_province: 'Quebec' });
      expect(c.excluded).toContain('quebec_acceptance_certificate');
    });
  });

  describe('employer-specific, LMIA-exempt', () => {
    const c = fromProfile(EXEMPT);

    it('lists the contract and the offer of employment number, not the LMIA', () => {
      expect(c.docs.has('employment_contract_lmia_exempt')).toBe(true);
      expect(c.docs.has('lmia_or_offer_of_employment_number')).toBe(true);
      expect(c.excluded).toEqual(
        expect.arrayContaining(['lmia_and_employment_contract', 'job_offer_letter']),
      );
      for (const t of EMPLOYER_DOCS) expect(c.docs.has(t)).toBe(true);
    });
  });

  describe('open work permit, spouse of a foreign worker', () => {
    const c = fromProfile(OPEN_SPOUSE);

    it('never asks for an LMIA, a number, a job offer or employer documents', () => {
      expect(c.excluded).toEqual(
        expect.arrayContaining([
          'lmia_and_employment_contract',
          'lmia_or_offer_of_employment_number',
          'job_offer_letter',
          'employment_contract_lmia_exempt',
          ...EMPLOYER_DOCS,
        ]),
      );
    });

    it('lists the family documents and the marriage certificate', () => {
      for (const t of [...OPEN_FAMILY_DOCS, 'marriage_certificate_copy']) {
        expect(c.docs.has(t)).toBe(true);
      }
    });

    it('holds the family documents as "may be required" until the principal is known', () => {
      const u = fromProfile({ ...OPEN_SPOUSE, principal_relationship: undefined });
      expect(
        u.undetermined.find((x) => x.requirement_code === 'principal_work_permit_copy')
          ?.dependsOn,
      ).toEqual(['work_permit_type', 'open_permit_principal']);
    });

    it('does not quote the worker-family page at the spouse of a student', () => {
      const s = fromProfile({ ...OPEN_SPOUSE, principal_relationship: 'spouse of a student' });
      expect(s.excluded).toEqual(expect.arrayContaining(OPEN_FAMILY_DOCS));
    });
  });

  it('holds every permit-kind document as "may be required" with no permit type', () => {
    const { undetermined } = fromProfile(BASE);
    const codes = undetermined.map((u) => u.requirement_code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'lmia_and_employment_contract',
        'job_offer_letter',
        ...EMPLOYER_DOCS,
        'open_work_permit_holder_fee',
      ]),
    );
  });

  describe('the medical exam', () => {
    it('is listed, without blocking the forms, for a Pakistani resident working over 6 months', () => {
      const med = fromProfile(LMIA).docs.get('proof_of_medical_exam');
      expect(med).toBeDefined();
      expect(med?.required).toBe(false);
    });

    it('is not listed for a French resident with no listed country and no public-health job', () => {
      const c = fromProfile({
        ...LMIA,
        applicant_citizenship: 'France',
        country_of_residence: 'France',
        designated_country_six_months: 'No',
      });
      expect(c.excluded).toContain('proof_of_medical_exam');
    });

    it('is listed for a public-health job, however short the stay and wherever they lived', () => {
      const c = fromProfile({
        ...LMIA,
        applicant_citizenship: 'France',
        country_of_residence: 'France',
        designated_country_six_months: 'No',
        public_health_occupation: 'Yes, nurse',
        work_start_date: '2027-02-01',
        work_end_date: '2027-04-30',
      });
      expect(c.docs.has('proof_of_medical_exam')).toBe(true);
    });

    it('is listed for a short stay only for a public-health or agricultural job', () => {
      const short = { ...LMIA, work_start_date: '2027-02-01', work_end_date: '2027-04-30' };
      expect(fromProfile(short).excluded).toContain('proof_of_medical_exam');
      expect(
        fromProfile({ ...short, public_health_occupation: 'yes, farm work' }).docs.has(
          'proof_of_medical_exam',
        ),
      ).toBe(true);
    });

    it('is listed for a French resident who spent 6+ months in a listed country', () => {
      const c = fromProfile({
        ...LMIA,
        applicant_citizenship: 'France',
        country_of_residence: 'France',
        designated_country_six_months: 'Yes',
      });
      expect(c.docs.has('proof_of_medical_exam')).toBe(true);
    });

    it('carries the study permit’s IME country list, read from IRCC’s table', () => {
      const study = JSON.parse(
        readFileSync(file.replace('ca-work-permit', 'ca-study-permit'), 'utf8'),
      ) as { requirements: ExtractionRow[] };
      const studyRule = study.requirements.find(
        (r) => r.requirement_code === 'ime_country_of_residence',
      )?.rule;
      const cond = doc.requirements.find(
        (r) => r.requirement_code === 'ime_country_of_residence',
      )!;
      expect(cond.rule).toEqual(studyRule);
      expect(doc.source_roles[cond.source_role]).toMatch(
        /medical-exams\/requirements-temporary-residents\/country-requirements\.html$/,
      );
    });
  });

  it('asks IMM 5645 only of applicants 18 or older', () => {
    const minor = fromProfile({ ...LMIA, date_of_birth: '2010-02-01' });
    expect(minor.forms).not.toContain('IMM 5645');
    expect(minor.excluded).toContain('imm5645');
  });

  it('asks proof of status only of a resident who is not a citizen there', () => {
    expect(fromProfile(LMIA).excluded).toContain('proof_of_status_in_residence_country');
    const c = fromProfile({ ...LMIA, applicant_citizenship: 'India', country_of_residence: 'United Arab Emirates' });
    expect(c.docs.has('proof_of_status_in_residence_country')).toBe(true);
  });

  it('has a police certificate only as a condition, never an upload slot', () => {
    const police = doc.requirements.find((r) => r.requirement_code === 'police_certificate_if_asked');
    expect(police?.kind).toBe('condition');
    expect(police?.rule).toBeUndefined();
  });

  it('charges the open work permit holder fee only for an open permit, at the figures IRCC states', () => {
    const fee = (code: string) => doc.requirements.find((r) => r.requirement_code === code)!;
    expect(fee('work_permit_fee').parameters).toMatchObject({ amount: 155, currency: 'CAD' });
    expect(fee('open_work_permit_holder_fee').parameters).toMatchObject({ amount: 100, currency: 'CAD' });
    expect(fee('biometrics_fee').parameters).toMatchObject({ amount: 85, currency: 'CAD' });
    expect(fromProfile(LMIA).excluded).toContain('open_work_permit_holder_fee');
    expect(fromProfile(OPEN_SPOUSE).excluded).not.toContain('open_work_permit_holder_fee');
  });

  it('quotes a readable canada.ca page for every row, lowercased as the normalizer stores it', () => {
    for (const r of doc.requirements) {
      expect(doc.source_roles[r.source_role]).toMatch(
        /^https:\/\/(www\.canada\.ca\/en\/immigration-refugees-citizenship\/|ircc\.canada\.ca\/english\/)/,
      );
      expect(doc.source_roles[r.source_role]).not.toMatch(/\.pdf$/);
      expect(r.source_excerpt).toBe(r.source_excerpt.toLowerCase());
    }
  });
});
