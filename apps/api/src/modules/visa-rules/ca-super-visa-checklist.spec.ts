import { readFileSync } from 'fs';
import { join } from 'path';
import {
  convertRegistryToFramework,
  type RegistryRequirement,
} from './registry-to-framework';
import { planOrphanLinks } from '../documents/slot-link';

/**
 * The super visa checklist, derived from the extraction file the registry
 * migration is generated from (data/requirements/ca-super-visa.json) — so this
 * fails if the data regresses, not only if the code does.
 *
 * Prod app 61f16bb5 (2026-10-16) showed: no passport, no medical insurance, no
 * application form, a content rule as an upload slot, Option 1 and Option 2 as
 * two slots for one document, and every host document filed under the
 * applicant.
 */
interface ExtractionRow extends Omit<
  RegistryRequirement,
  'description' | 'official_form_code' | 'official_form_url' | 'rule'
> {
  description?: string;
  official_form_code?: string;
  official_form_url?: string;
  rule?: unknown;
}

const file = join(
  __dirname,
  '../../../../../data/requirements/ca-super-visa.json',
);
const rows = (
  JSON.parse(readFileSync(file, 'utf8')) as { requirements: ExtractionRow[] }
).requirements.map(
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

describe('ca-super-visa checklist (from the registry extraction)', () => {
  const { framework, undetermined } = convertRegistryToFramework(
    'ca-super-visa',
    rows,
    { uses_representative: true },
  );
  const docs = new Map(framework.base_documents.map((d) => [d.type, d]));

  it('asks for the passport and the medical insurance policy', () => {
    expect(docs.get('passport_copy')?.required).toBeUndefined(); // required
    expect(docs.get('medical_insurance')?.required).toBeUndefined();
    expect(docs.get('medical_insurance')?.validity_months).toBe(12);
  });

  it('has exactly one upload slot per real document', () => {
    expect([...docs.keys()].sort()).toEqual(
      [
        'applicant_income_must_continue',
        'host_letter_of_invitation',
        'income_proof_option_one',
        'medical_insurance',
        'passport_copy',
        'proof_of_host_status',
        'proof_of_medical_exam',
        'proof_of_relationship',
      ].sort(),
    );
    // A content rule and an alternative are not documents.
    expect(docs.has('letter_of_invitation_contents')).toBe(false);
    expect(docs.has('income_proof_option_two')).toBe(false);
  });

  it('gates preparation only on what must be in hand before applying', () => {
    const gating = framework.base_documents
      .filter((d) => d.required !== false)
      .map((d) => d.type)
      .sort();
    expect(gating).toEqual(
      [
        'host_letter_of_invitation',
        'income_proof_option_one',
        'medical_insurance',
        'passport_copy',
        'proof_of_host_status',
        'proof_of_relationship',
      ].sort(),
    );
  });

  it('files the host documents under the host', () => {
    for (const t of [
      'host_letter_of_invitation',
      'proof_of_host_status',
      'income_proof_option_one',
    ]) {
      expect(docs.get(t)?.owner).toBe('sponsor');
    }
    expect(docs.get('passport_copy')?.owner).toBeUndefined();
  });

  it('lists IMM 5257, and IMM 5476 when a representative is used', () => {
    expect(framework.base_forms.map((f) => f.form_code)).toEqual([
      'IMM 5257',
      'IMM 5476',
    ]);
    const without = convertRegistryToFramework('ca-super-visa', rows, {
      uses_representative: false,
    });
    expect(without.framework.base_forms.map((f) => f.form_code)).toEqual([
      'IMM 5257',
    ]);
    expect(undetermined).toEqual([]);
  });

  it('labels the slots in plain language (no HOST: prefix, no "Option 1")', () => {
    for (const d of framework.base_documents) {
      expect(d.label).not.toMatch(/^HOST:|^Option \d/);
    }
  });

  it('routes the files the applicant actually uploaded into these slots', () => {
    const items = framework.base_documents.map((d) => ({
      id: d.type,
      document_type: d.type,
      status: 'missing',
      meta: { kind: 'document' },
    }));
    const links = planOrphanLinks(
      [
        {
          id: 'passport.pdf',
          document_type: 'passport',
          checklist_item_id: null,
        },
        {
          id: 'insurance.pdf',
          document_type: 'medical_insurance',
          checklist_item_id: null,
        },
      ],
      items,
    );
    expect(links).toEqual([
      { documentId: 'passport.pdf', itemId: 'passport_copy' },
      { documentId: 'insurance.pdf', itemId: 'medical_insurance' },
    ]);
  });
});
