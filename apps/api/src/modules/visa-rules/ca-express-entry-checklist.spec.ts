import { readFileSync } from 'fs';
import { join } from 'path';
import {
  convertRegistryToFramework,
  type RegistryRequirement,
} from './registry-to-framework';

/**
 * The Express Entry checklist, derived from the extraction file the registry
 * migration is generated from (data/requirements/ca-express-entry.json) — so
 * this fails if the data regresses, not only if the code does.
 *
 * Until 20261019120100 the route's only document row was the landing page's
 * "get your documents ready" summary line, so the registry produced one
 * unactionable slot and the real checklist came from the 9-21s discovery LLM
 * call. The documents are now quoted one by one from IRCC's
 * get-your-documents-ready page.
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
  '../../../../../data/requirements/ca-express-entry.json',
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

describe('ca-express-entry checklist (from the registry extraction)', () => {
  // No facts at all: a brand-new application must still get the full list.
  const { framework, undetermined } = convertRegistryToFramework(
    'ca-express-entry',
    rows,
    {},
  );
  const docs = new Map(framework.base_documents.map((d) => [d.type, d]));

  it('lists every document IRCC names for creating a profile', () => {
    expect([...docs.keys()].sort()).toEqual(
      [
        'education_credential_proof',
        'language_test_results',
        'passport_or_travel_document',
        'police_certificates',
        'proof_of_funds',
        'proof_of_work_experience',
        'provincial_nomination',
        'trade_certificate_of_qualification',
        'written_job_offer',
      ].sort(),
    );
    // The landing page's summary line is a pointer, not a document.
    expect(docs.has('documents_to_get_ready')).toBe(false);
    // "Consider the Provincial Nominee Program" is advice: as an upload slot
    // it asked the applicant for a file that does not exist (prod 2026-10-19).
    expect(docs.has('provincial_nominee_program')).toBe(false);
    // No document hides behind an unanswered fact (only the two family fees do).
    expect(
      undetermined.filter((u) => u.kind === 'evidence' || u.kind === 'recommended'),
    ).toEqual([]);
  });

  it('requires only the documents the page lists without a qualifier', () => {
    const required = framework.base_documents
      .filter((d) => d.required !== false)
      .map((d) => d.type)
      .sort();
    expect(required).toEqual(
      [
        'language_test_results',
        'passport_or_travel_document',
        'police_certificates',
        'proof_of_funds',
        'proof_of_work_experience',
      ].sort(),
    );
  });

  it('quotes the registered documents page for every new document', () => {
    const url = doc.source_roles.documents;
    expect(url).toBe(
      'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/documents.html',
    );
    for (const r of doc.requirements.filter((x) => x.kind === 'evidence')) {
      expect(r.source_role).toBe('documents');
      expect(r.source_excerpt).toMatch(
        /^you may need information from some or all of these documents when you create a profile:/,
      );
    }
  });

  it('every optional document says why in its own quoted wording', () => {
    for (const r of doc.requirements.filter(
      (x) => x.kind === 'evidence' && x.officially_required === false,
    )) {
      expect(r.source_excerpt).toMatch(/\(if you |\bif: /);
    }
  });
});
