import { readFileSync } from 'fs';
import { join } from 'path';
import {
  convertRegistryToFramework,
  type RegistryRequirement,
} from './registry-to-framework';
import { profileToRuleFacts } from './profile-to-rule-facts';
import {
  IRCC_UPLOAD_SLOTS,
  PORTAL_DOCUMENTS_KEY,
  documentsOfSlot,
} from '../automation/portal-fills/ircc-uploads';

/**
 * The visitor visa (TRV) checklist, derived from the extraction file the
 * registry rows come from (data/requirements/ca-visitor-visa.json).
 *
 * Live bug 2026-10-29 (app 945eb7f1): a self-funded tourist's Documents page
 * had no slot for his own bank statements. IRCC's apply page lists "Bank
 * account statement" under "Recommended documents" (the same heading as
 * travel history), but the extraction only captured "have enough money for
 * your stay" — a `condition`, which is correctly never an upload. So the
 * registry produced no funds document at all, and the IRCC fill's
 * "Proof of financial support" upload had nothing to attach.
 * Migration 20261029120000 adds the same row to the live registry.
 */
interface ExtractionRow extends Omit<
  RegistryRequirement,
  'description' | 'official_form_code' | 'official_form_url' | 'rule'
> {
  description?: string | null;
  official_form_code?: string | null;
  official_form_url?: string | null;
  rule?: unknown;
}

const file = join(
  __dirname,
  '../../../../../data/requirements/ca-visitor-visa.json',
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

function uploads(profile: Record<string, unknown>) {
  return convertRegistryToFramework(
    'ca-visitor-visa-temporary-resident-visa',
    rows,
    profileToRuleFacts(profile, new Date('2026-10-29T00:00:00Z')),
  ).framework.base_documents;
}

const fundsSlot = IRCC_UPLOAD_SLOTS.find((s) => s.key === 'funds')!;

describe('ca-visitor-visa checklist: proof of funds', () => {
  const docs = uploads({
    applicant_citizenship: 'Pakistan',
    country_of_residence: 'Pakistan',
    employment_status: 'self_employed',
    purpose_of_visit: 'Tourism',
    trip_funded_by: 'self',
  });

  it("has a slot for the applicant's own bank statements", () => {
    const funds = docs.filter(
      (d) =>
        documentsOfSlot(
          {
            [PORTAL_DOCUMENTS_KEY]: [
              {
                id: '00000000-0000-0000-0000-000000000001',
                documentType: d.type,
                fileName: 'x.pdf',
                mimeType: 'application/pdf',
                approved: true,
                createdAt: '2026-10-29T00:00:00Z',
              },
            ],
          },
          fundsSlot,
        ).length > 0,
    );
    expect(funds.map((d) => d.type)).toEqual(['bank_statement']);
  });

  it('is optional, as IRCC lists it under "Recommended documents"', () => {
    const bank = docs.find((d) => d.type === 'bank_statement')!;
    expect(bank.required).toBe(false);
  });

  it('the money condition itself is still not an upload', () => {
    expect(docs.map((d) => d.type)).not.toContain('sufficient_funds');
  });
});
