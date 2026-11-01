import { readFileSync } from 'fs';
import { join } from 'path';
import { profileToRuleFacts } from './profile-to-rule-facts';
import {
  convertRegistryToFramework,
  type RegistryRequirement,
} from './registry-to-framework';
import type { RuleFacts } from './rule.types';

/**
 * The study permit checklist, derived from the extraction file the registry
 * migration is generated from (data/requirements/ca-study-permit.json), so
 * this fails if the data regresses, not only if the code does.
 *
 * Measured against IRCC's personalised checklist, recorded live in the IRCC
 * secure account on 2026-10-20 for a Pakistani resident, married, spouse not
 * coming, Ontario PAL. IRCC required IMM 1294, passport, letter of
 * acceptance, PAL/TAL, proof of funds, photo, Request for Medical Exam and
 * Family Information (IMM 5645). VisaAI listed no IMM 5645 and no medical
 * exam. The marriage certificate stays as IMM 1294's instructions state it —
 * "if you are married, you must send a photocopy of your marriage licence or
 * certificate" — whether or not the spouse comes.
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

const file = join(
  __dirname,
  '../../../../../data/requirements/ca-study-permit.json',
);
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

const NOW = new Date('2026-10-20T00:00:00Z');

/** The applicant IRCC's checklist was recorded for, as intake writes it. */
const PAKISTANI_MARRIED_SPOUSE_STAYS = {
  applicant_citizenship: 'Pakistan',
  country_of_residence: 'Pakistan',
  date_of_birth: '1996-04-12',
  marital_status: 'Married',
  spouse_coming_to_canada: 'No',
  study_province: 'Ontario',
  has_attestation_letter: 'Yes',
  study_start_date: '2027-01-11',
  study_end_date: '2028-12-15',
};

function checklist(facts: RuleFacts) {
  const result = convertRegistryToFramework('ca-study-permit', rows, facts);
  return {
    ...result,
    docs: new Map(result.framework.base_documents.map((d) => [d.type, d])),
    forms: result.framework.base_forms.map((f) => f.form_code),
  };
}

const fromProfile = (profile: Record<string, unknown>) =>
  checklist(profileToRuleFacts(profile, NOW));

describe('ca-study-permit checklist (from the registry extraction)', () => {
  describe('married Pakistani applicant whose spouse is not coming', () => {
    const c = fromProfile(PAKISTANI_MARRIED_SPOUSE_STAYS);

    it('lists Family Information (IMM 5645) beside IMM 1294', () => {
      expect(c.forms).toEqual(['IMM 1294', 'IMM 5645']);
    });

    it('lists the immigration medical exam, without blocking the forms', () => {
      const med = c.docs.get('proof_of_medical_exam');
      expect(med).toBeDefined();
      // Guide 5269 lets the applicant wait for the visa office's
      // instructions instead of an upfront exam.
      expect(med?.required).toBe(false);
    });

    it('asks for the marriage certificate, as IMM 1294 instructs every married applicant', () => {
      expect(c.docs.get('marriage_certificate_copy')).toBeDefined();
      expect(c.docs.get('marriage_certificate_copy')?.required).toBeUndefined();
    });

    it('requires what IRCC requires: acceptance letter, PAL/TAL, passport, funds, photo', () => {
      for (const t of [
        'letter_of_acceptance',
        'provincial_attestation_letter',
        'passport_copy',
        'proof_of_funds',
        'passport_photos',
      ]) {
        expect(c.docs.get(t)).toBeDefined();
        expect(c.docs.get(t)?.required).toBeUndefined();
      }
    });

    it('leaves out the common-law declaration and the custodian proof', () => {
      expect(c.excluded).toEqual(
        expect.arrayContaining(['imm5409', 'custodianship_proof_of_care']),
      );
    });
  });

  it('asks for the marriage certificate whether or not the spouse comes', () => {
    const { docs } = fromProfile({
      ...PAKISTANI_MARRIED_SPOUSE_STAYS,
      spouse_coming_to_canada: 'Yes',
    });
    expect(docs.get('marriage_certificate_copy')?.required).toBeUndefined();
  });

  it('never asks a single applicant for a marriage certificate', () => {
    const { excluded } = fromProfile({
      ...PAKISTANI_MARRIED_SPOUSE_STAYS,
      marital_status: 'Single',
    });
    expect(excluded).toContain('marriage_certificate_copy');
  });

  it('does not list the medical exam for a resident of a country IRCC does not list', () => {
    const { docs, excluded } = fromProfile({
      ...PAKISTANI_MARRIED_SPOUSE_STAYS,
      country_of_residence: 'France',
    });
    expect(docs.has('proof_of_medical_exam')).toBe(false);
    expect(excluded).toContain('proof_of_medical_exam');
  });

  it('does not list the medical exam for a program of 6 months or less', () => {
    const { excluded } = fromProfile({
      ...PAKISTANI_MARRIED_SPOUSE_STAYS,
      study_start_date: '2027-01-11',
      study_end_date: '2027-05-30',
    });
    expect(excluded).toContain('proof_of_medical_exam');
  });

  it('holds the medical exam as "may be required" with no residence or dates', () => {
    const { undetermined } = checklist({});
    expect(
      undetermined.find((u) => u.requirement_code === 'proof_of_medical_exam')
        ?.dependsOn,
    ).toEqual(['stay_duration_days', 'residence_country']);
  });

  it('asks IMM 5645 only of applicants 18 or older', () => {
    const minor = fromProfile({
      ...PAKISTANI_MARRIED_SPOUSE_STAYS,
      date_of_birth: '2010-02-01',
    });
    expect(minor.forms).not.toContain('IMM 5645');
    expect(minor.excluded).toContain('imm5645');
  });

  it('reads the medical exam country list from IRCC’s table, Pakistan included', () => {
    const med = doc.requirements.find(
      (r) => r.requirement_code === 'proof_of_medical_exam',
    ) as ExtractionRow & {
      rule: { all: Array<{ fact: string; value: unknown }> };
    };
    const countries = med.rule.all.find((n) => n.fact === 'residence_country')
      ?.value as string[];
    expect(countries).toHaveLength(121);
    for (const code of ['PK', 'IN', 'BD', 'NG', 'PH', 'CN']) {
      expect(countries).toContain(code);
    }
    for (const code of ['FR', 'GB', 'US', 'AE', 'SA', 'IR']) {
      expect(countries).not.toContain(code);
    }
    // The condition row carries the identical rule, bound to the table page.
    const cond = doc.requirements.find(
      (r) => r.requirement_code === 'ime_country_of_residence',
    );
    expect(cond?.rule).toEqual(med.rule);
    expect(doc.source_roles[cond!.source_role]).toMatch(
      /medical-exams\/requirements-temporary-residents\/country-requirements\.html$/,
    );
  });

  it('quotes a readable IRCC page for every new row', () => {
    for (const code of [
      'imm5645',
      'proof_of_medical_exam',
      'ime_country_of_residence',
    ]) {
      const r = doc.requirements.find((x) => x.requirement_code === code)!;
      expect(doc.source_roles[r.source_role]).toMatch(
        /^https:\/\/www\.canada\.ca\/en\/immigration-refugees-citizenship\//,
      );
      expect(doc.source_roles[r.source_role]).not.toMatch(/\.pdf$/);
      expect(r.source_excerpt).toBe(r.source_excerpt.toLowerCase());
    }
  });
});
