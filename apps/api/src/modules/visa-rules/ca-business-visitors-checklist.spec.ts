import { readFileSync } from 'fs';
import { join } from 'path';
import {
  convertRegistryToFramework,
  type RegistryRequirement,
} from './registry-to-framework';
import {
  normalizeBusinessActivity,
  profileToRuleFacts,
} from './profile-to-rule-facts';
import { validateRule } from './rule-evaluator';
import type { RuleNode } from './rule.types';

/**
 * The business visitor checklist, derived from the extraction file the
 * registry rows come from (data/requirements/ca-business-visitors.json) — so
 * this fails if the data regresses, not only if the code does.
 *
 * Audit 2026-10-18: every evidence row was unruled and required, so an IMM 5257
 * applicant got required uploads for an eTA passport, the visa they were
 * applying for, a US green card, typed host contact details, a border funds
 * check, a second copy of the invitation letter and after-sales warranties.
 * Migration 20261018120000 applies the same corrections to the live rows.
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
  '../../../../../data/requirements/ca-business-visitors.json',
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

function checklist(profile: Record<string, unknown>) {
  const { framework, undetermined, excluded } = convertRegistryToFramework(
    'ca-business-visitors',
    rows,
    profileToRuleFacts(profile, new Date('2026-10-18T00:00:00Z')),
  );
  const required = framework.base_documents
    .filter((d) => d.required !== false)
    .map((d) => d.type)
    .sort();
  return {
    required,
    uploads: framework.base_documents.map((d) => d.type).sort(),
    // Only document kinds reach the checklist as "may be required" items
    // (update-checklist.ts); an undetermined condition is not an upload.
    maybe: undetermined
      .filter((u) => u.kind === 'evidence' || u.kind === 'form')
      .map((u) => u.requirement_code)
      .sort(),
    excluded,
  };
}

const NEVER_UPLOADS = [
  'same_passport_used_for_eta',
  'visitor_visa_if_applicable',
  'host_24_hour_contact_details',
  'proof_of_funds_at_border',
  'two_original_invitation_letters',
  'invitation_letter_notarization',
];

describe('ca-business-visitors extraction file', () => {
  it('every rule is valid in the closed rule language', () => {
    for (const r of rows) {
      if (r.rule) expect(validateRule(r.rule as RuleNode)).toEqual([]);
    }
  });

  it.each(NEVER_UPLOADS)('%s is not an upload kind', (code) => {
    const r = rows.find((x) => x.requirement_code === code)!;
    expect(r.kind).toBe('condition');
  });
});

describe('ca-business-visitors checklist (from the registry extraction)', () => {
  it('(a) Pakistani applicant, no US status, attending meetings', () => {
    const c = checklist({
      applicant_citizenship: 'Pakistan',
      country_of_residence: 'Pakistan',
      us_permanent_resident: 'no',
      purpose_of_visit: 'Business meetings with a Toronto client',
    });
    expect(c.required).toEqual(
      ['letters_of_support_and_invitation', 'passport_valid_entire_stay'].sort(),
    );
    expect(c.uploads).toEqual(c.required);
    expect(c.maybe).toEqual([]);
    expect(c.excluded).toEqual(
      expect.arrayContaining([
        'us_green_card_and_passport',
        'warranty_service_or_contract_documents',
      ]),
    );
    for (const code of NEVER_UPLOADS) expect(c.uploads).not.toContain(code);
  });

  it('(b) US lawful permanent resident adds the green card', () => {
    const c = checklist({
      applicant_citizenship: 'Pakistan',
      us_permanent_resident: 'yes',
      purpose_of_visit: 'attend a trade show',
    });
    expect(c.required).toEqual(
      [
        'letters_of_support_and_invitation',
        'passport_valid_entire_stay',
        'us_green_card_and_passport',
      ].sort(),
    );
  });

  it('(c) after-sales service visit adds the warranty / service contract', () => {
    const c = checklist({
      applicant_citizenship: 'Pakistan',
      us_permanent_resident: false,
      purpose_of_visit: 'business',
      business_activity: 'Repairing the packaging machines we sold under warranty',
    });
    expect(c.required).toEqual(
      [
        'letters_of_support_and_invitation',
        'passport_valid_entire_stay',
        'warranty_service_or_contract_documents',
      ].sort(),
    );
  });

  it('unanswered facts leave the two conditional documents as "may be required", never required', () => {
    const c = checklist({ purpose_of_visit: 'business' });
    expect(c.required).toEqual(
      ['letters_of_support_and_invitation', 'passport_valid_entire_stay'].sort(),
    );
    expect(c.maybe).toEqual(
      expect.arrayContaining([
        'us_green_card_and_passport',
        'warranty_service_or_contract_documents',
      ]),
    );
  });
});

describe('normalizeBusinessActivity', () => {
  it.each([
    ['after-sales service', 'after_sales_service'],
    ['installing equipment we sold', 'after_sales_service'],
    ['warranty repairs', 'after_sales_service'],
    ['after_sales_service', 'after_sales_service'],
    ['fixing the machines we sold', 'after_sales_service'],
    ['fix the conveyor line', 'after_sales_service'],
    ['technical support for our ERP install base', 'after_sales_service'],
    ['support on the software we sold', 'after_sales_service'],
    ['upgrading the firmware on delivered units', 'after_sales_service'],
    ['servicing', 'after_sales_service'],
    ['work under the service contract for the presses', 'after_sales_service'],
    ['deliver on our support agreement', 'after_sales_service'],
    ['visit under a service-contract', 'after_sales_service'],
    ['commissioning the new line', 'after_sales_service'],
    // The document-requiring category wins when both match.
    [
      'meetings with the client and technical support on the software we sold',
      'after_sales_service',
    ],
    ['meetings with clients', 'meetings'],
    ['attend a conference', 'meetings'],
    ['buying goods for my company', 'buying_goods'],
    // Live E2E 2026-10-18: a bare "contract" is a purchase or sales contract,
    // not servicing goods already sold; it made the warranty upload required.
    [
      'Meeting suppliers and negotiating purchase contracts',
      'buying_goods',
    ],
    ['meetings with a supplier to negotiate a contract', 'meetings'],
    ['training at the parent company', 'training'],
  ])('%s -> %s', (text, value) => {
    expect(normalizeBusinessActivity(text)).toBe(value);
  });

  it.each(['business', 'visit family', '', null, 42])(
    'leaves %p unset',
    (v) => {
      expect(normalizeBusinessActivity(v)).toBeUndefined();
    },
  );

  it('drops an unrecognised business_activity answer rather than letting it rule a document out', () => {
    const f = profileToRuleFacts({ business_activity: 'various things' });
    expect(f.business_activity).toBeUndefined();
  });

  it('a contract alone is not after-sales service', () => {
    expect(
      normalizeBusinessActivity('review the contract with our distributor'),
    ).toBeUndefined();
  });

  it('"commission" alone (sales commission) is not after-sales service', () => {
    expect(normalizeBusinessActivity('discuss my commission')).toBeUndefined();
  });

  it('an unrecognised explicit answer does NOT fall back to the purpose text', () => {
    const f = profileToRuleFacts({
      purpose_of_visit: 'Business meetings',
      business_activity: 'looking after the units we shipped last year',
    });
    expect(f.business_activity).toBeUndefined();
    const c = checklist({
      us_permanent_resident: 'no',
      purpose_of_visit: 'Business meetings',
      business_purpose: 'looking after the units we shipped last year',
    });
    expect(c.excluded).not.toContain('warranty_service_or_contract_documents');
    expect(c.maybe).toContain('warranty_service_or_contract_documents');
  });

  it('a recognised explicit answer beats the purpose text', () => {
    const f = profileToRuleFacts({
      purpose_of_visit: 'Business meetings',
      business_activity: 'fixing the machines we sold',
    });
    expect(f.business_activity).toBe('after_sales_service');
  });

  it('does not override a recognised explicit answer with the purpose text', () => {
    const f = profileToRuleFacts({
      purpose_of_visit: 'business meetings',
      business_activity: 'after-sales service',
    });
    expect(f.business_activity).toBe('after_sales_service');
  });
});
