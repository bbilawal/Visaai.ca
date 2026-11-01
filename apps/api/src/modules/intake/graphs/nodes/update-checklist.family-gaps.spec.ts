import { makeUpdateChecklistNode } from './update-checklist';
import type { IntakeState } from '../intake.state';
import type { ChatOpenAI } from '@langchain/openai';
import {
  makeFakeDb,
  type Row,
} from '../../../documents/family-gaps/__fixtures__/fake-db';

/**
 * Dry run 2026-10-15 (Canada visitor visa, Pakistani applicant): the family
 * documents IRCC's form depends on were never requested. The intake checklist
 * build is one of the two places the checklist is synced, so it must request
 * them too — and close them when the data is in.
 */

const noLlm = {
  withStructuredOutput() {
    throw new Error('discovery must not run');
  },
} as unknown as ChatOpenAI;

const REQUIREMENTS = {
  source: 'visa_registry',
  base_forms: [{ form_code: 'IMM 5257', form_name: 'Application for TRV' }],
  base_documents: [
    { type: 'passport_copy', label: 'Passport copy' },
    { type: 'travel_history', label: 'Travel history' },
    { type: 'bank_statement', label: 'Bank statements' },
    { type: 'employment_letter', label: 'Employment letter' },
    { type: 'birth_certificate', label: 'Birth certificate' },
  ],
};

const STATE = {
  applicationId: 'app-1',
  visaTypeId: 'vt-trv',
  frameworkId: null,
  destinationCountry: 'CA',
  destinationState: null,
  requirementsJson: REQUIREMENTS,
  profileJson: {},
  riskIndicators: [],
  checklistItems: [],
  suggestedVisaTypes: [],
  messages: [],
  isComplete: false,
  currentQuestion: null,
} as unknown as IntakeState;

function db(visaaiId: string, profile: Row, checklist: Row[] = []) {
  return makeFakeDb({
    applications: [{ id: 'app-1', visa_type_id: 'vt-trv' }],
    visa_types: [{ id: 'vt-trv', visaai_id: visaaiId }],
    application_profiles: [{ application_id: 'app-1', profile_json: profile }],
    checklist_items: checklist,
    documents: [],
  });
}

const withStored = (s: IntakeState, rows: Row[]) =>
  ({
    ...s,
    checklistItems: rows.map((r) => ({ ...r })),
  }) as unknown as IntakeState;

const FAMILY = {
  full_name: 'Muzaffar Ahmad',
  nationality: 'Pakistani',
  marital_status: 'married',
  spouse_name: 'Sumera Ahmad',
  marriage_date: '1988-09-16',
  youngest_son_name: 'Mian Muhammad Bilawal',
};

describe('update_checklist — family documents', () => {
  it('requests a missing child birth certificate and the spouse ID on a Canada visitor application', async () => {
    const fake = db('ca-visitor-visa-temporary-resident-visa', FAMILY);
    await makeUpdateChecklistNode(fake.client, noLlm)(STATE);
    const labels = fake.tables.checklist_items.map((r) => r.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Birth certificate — Mian Muhammad Bilawal',
        'National ID card or passport — Sumera Ahmad',
      ]),
    );
    // The registry's own birth-certificate requirement is still on the list:
    // a family request does not stand in for it.
    expect(
      fake.tables.checklist_items.filter(
        (r) => r.document_type === 'birth_certificate',
      ),
    ).toHaveLength(2);
  });

  it('closes the request on the next build once the date of birth is in the profile', async () => {
    const fake = db('ca-visitor-visa-temporary-resident-visa', FAMILY);
    const node = makeUpdateChecklistNode(fake.client, noLlm);
    await node(STATE);
    fake.tables.application_profiles[0].profile_json = {
      ...FAMILY,
      youngest_son_date_of_birth: '1995-11-22',
      spouse_date_of_birth: '1968-10-09',
    };
    // As the rebuild does: the checkpointed state carries the stored list.
    await node(withStored(STATE, fake.tables.checklist_items));
    expect(
      fake.tables.checklist_items.filter((r) =>
        String(r.added_reason).startsWith('family_gap:'),
      ),
    ).toEqual([]);
  });

  it('requests nothing on a route the configuration does not list', async () => {
    const fake = db('gb-standard-visitor', FAMILY);
    await makeUpdateChecklistNode(fake.client, noLlm)(STATE);
    expect(
      fake.tables.checklist_items.filter((r) =>
        String(r.added_reason).startsWith('family_gap:'),
      ),
    ).toEqual([]);
  });

  it('family requests do not hide a thin sourced list from supplemental discovery', async () => {
    // 3 sourced documents is thin; two family rows on top must not make it
    // look complete and cost the applicant the supporting-evidence pass.
    const base = REQUIREMENTS.base_documents.slice(0, 3);
    const thin = {
      ...STATE,
      requirementsJson: { ...REQUIREMENTS, base_documents: base },
    } as IntakeState;
    const fake = db('ca-visitor-visa-temporary-resident-visa', FAMILY);
    let discoveryCalls = 0;
    const llm = {
      withStructuredOutput() {
        discoveryCalls += 1;
        return {
          stream: () => Promise.reject(new Error('no stream in test')),
          invoke: () =>
            Promise.resolve({
              required_forms: [],
              required_documents: [],
              strengthening_documents: [],
            }),
        };
      },
    } as unknown as ChatOpenAI;
    const node = makeUpdateChecklistNode(fake.client, llm);
    await node(thin);
    expect(discoveryCalls).toBe(1);
    expect(
      fake.tables.checklist_items.filter((r) =>
        String(r.added_reason).startsWith('family_gap:'),
      ).length,
    ).toBeGreaterThanOrEqual(2);
    // Second build: discovery added nothing, so the list is still thin.
    await node(withStored(thin, fake.tables.checklist_items));
    expect(discoveryCalls).toBe(2);
  });
});
