import { readFileSync } from 'fs';
import { join } from 'path';
import {
  convertRegistryToFramework,
  type RegistryRequirement,
} from './registry-to-framework';
import type { RuleFacts } from './rule.types';

/**
 * The spousal sponsorship checklist, derived from the extraction file the
 * registry migration is generated from
 * (data/requirements/ca-sponsor-your-spouse-partner-or-child.json), so this
 * fails if the data regresses, not only if the code does.
 *
 * Until 20261019220100 the route's only documents were the photo and the fee
 * receipt, and `checklistSupplement: false` kept discovery from filling the
 * gap: the live E2E on 2026-10-19 had no slot for a passport, marriage
 * certificate, police certificate or the sponsor's proof of status, and the
 * Forms list had no IMM 0008, 5669, 5406 or 5532.
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
  '../../../../../data/requirements/ca-sponsor-your-spouse-partner-or-child.json',
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

/** The rows this change added. */
const V2_DOCUMENTS = [
  'passport',
  'birth_certificate',
  'marriage_certificate',
  'common_law_relationship_proof',
  'conjugal_relationship_proof',
  'relationship_evidence',
  'police_clearance',
  'proof_of_status',
  'sponsor_residence_proof',
  'sponsor_previous_relationship_proof',
  'children_citizenship_proof',
];
const V2_FORMS = ['imm0008', 'imm5669', 'imm5406', 'imm5532'];

function checklist(facts: RuleFacts) {
  const result = convertRegistryToFramework(
    'ca-sponsor-your-spouse-partner-or-child',
    rows,
    facts,
  );
  return {
    ...result,
    docs: new Map(result.framework.base_documents.map((d) => [d.type, d])),
  };
}

const requiredTypes = (docs: Map<string, { required?: false }>) =>
  [...docs.entries()]
    .filter(([, d]) => d.required !== false)
    .map(([t]) => t);

describe('ca-sponsor-your-spouse-partner-or-child checklist (from the registry extraction)', () => {
  it('requires the passport, marriage certificate, police certificates and the sponsor’s status proof for a married couple', () => {
    const { docs } = checklist({ marital_status: 'married' });
    for (const t of [
      'passport',
      'marriage_certificate',
      'police_clearance',
      'proof_of_status',
      'birth_certificate',
    ]) {
      expect(docs.get(t)).toBeDefined();
      expect(docs.get(t)?.required).toBeUndefined();
    }
  });

  it('gives a brand-new application (no facts) every unconditional slot, and holds back only the marital-status ones', () => {
    const { docs, undetermined } = checklist({});
    expect(requiredTypes(docs)).toEqual(
      expect.arrayContaining([
        'passport',
        'birth_certificate',
        'police_clearance',
        'proof_of_status',
      ]),
    );
    // Gated on an unanswered fact: "may be required", never required by default.
    expect(docs.has('marriage_certificate')).toBe(false);
    expect(docs.has('common_law_relationship_proof')).toBe(false);
    expect(undetermined.map((u) => u.requirement_code).sort()).toEqual(
      expect.arrayContaining(['common_law_relationship_proof', 'marriage_certificate']),
    );
    for (const u of undetermined.filter((x) => x.kind === 'evidence')) {
      expect(u.dependsOn).toEqual(['marital_status']);
    }
  });

  it('asks a common-law couple for common-law proof instead of a marriage certificate', () => {
    const { docs, excluded } = checklist({ marital_status: 'common_law' });
    expect(excluded).toContain('marriage_certificate');
    expect(docs.get('common_law_relationship_proof')?.required).toBeUndefined();
    const married = checklist({ marital_status: 'married' });
    expect(married.excluded).toContain('common_law_relationship_proof');
  });

  it('never requires a conditional item by default', () => {
    for (const facts of [{}, { marital_status: 'married' }] as RuleFacts[]) {
      const { docs } = checklist(facts);
      for (const t of [
        'conjugal_relationship_proof',
        'relationship_evidence',
        'sponsor_residence_proof',
        'sponsor_previous_relationship_proof',
        'children_citizenship_proof',
      ]) {
        expect(docs.get(t)).toBeDefined();
        expect(docs.get(t)?.required).toBe(false);
      }
    }
  });

  it('groups the sponsor’s documents under the sponsor and the couple’s evidence under the applicant', () => {
    const { docs } = checklist({ marital_status: 'married' });
    const sponsorOwned = [...docs.values()]
      .filter((d) => d.owner === 'sponsor')
      .map((d) => d.type)
      .sort();
    expect(sponsorOwned).toEqual(
      [
        'children_citizenship_proof',
        'proof_of_status',
        'sponsor_previous_relationship_proof',
        'sponsor_residence_proof',
      ].sort(),
    );
    for (const t of [
      'passport',
      'birth_certificate',
      'marriage_certificate',
      'relationship_evidence',
      'police_clearance',
    ]) {
      expect(docs.get(t)?.owner).toBeUndefined();
    }
  });

  it('lists IMM 0008, 5669, 5406 and 5532 next to IMM 1344', () => {
    const { framework } = checklist({ uses_representative: false });
    expect(framework.base_forms.map((f) => f.form_code)).toEqual([
      'IMM 1344',
      'IMM 0008',
      'IMM 5669',
      'IMM 5406',
      'IMM 5532',
    ]);
    for (const f of framework.base_forms) {
      expect(f.source_url).toMatch(
        /^https:\/\/www\.canada\.ca\/en\/immigration-refugees-citizenship\/services\/application\/application-forms-guides\/imm\d{4}\.html$/,
      );
    }
  });

  it('adds no fee receipt and no payment slot of its own', () => {
    for (const code of [...V2_DOCUMENTS, ...V2_FORMS]) {
      expect(code).not.toMatch(/fee|receipt|payment/);
    }
  });

  it('uses the document classifier’s types where one exists, so uploads land in the right slot', () => {
    for (const t of ['passport', 'birth_certificate', 'marriage_certificate', 'police_clearance']) {
      expect(V2_DOCUMENTS).toContain(t);
    }
  });

  it('quotes a registered, readable IRCC page for every new row', () => {
    expect(doc.source_roles.documents).toBe(
      'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/guide-5289-sponsor-your-spouse-common-law-partner-conjugal-partner-dependent-child-complete-guide.html',
    );
    const added = doc.requirements.filter((r) =>
      [...V2_DOCUMENTS, ...V2_FORMS].includes(r.requirement_code),
    );
    expect(added).toHaveLength(V2_DOCUMENTS.length + V2_FORMS.length);
    for (const r of added) {
      expect(doc.source_roles[r.source_role]).toMatch(/^https:\/\/www\.canada\.ca\//);
      // Never the checklist PDF: the sync cannot store it (see 20261019220000).
      expect(doc.source_roles[r.source_role]).not.toMatch(/\.pdf$/);
      expect(r.source_excerpt).toBe(r.source_excerpt.toLowerCase());
      expect(r.source_excerpt.length).toBeGreaterThan(20);
    }
  });
});
