import {
  planRegistryReconcile,
  type ReconcileRow,
  type SourcedDocument,
} from './registry-reconcile';

/**
 * Prod app 61f16bb5 (super visa, 2026-10-16). The registry was corrected —
 * "the invitation letter must state the family-size list" became a condition,
 * Option 2 stopped being a second upload slot, labels were rewritten — and the
 * applicant's vault did not move: update-checklist only ever ADDED rows. The
 * content-rule slot kept blocking "Generate my forms".
 */

const row = (o: Partial<ReconcileRow>): ReconcileRow => ({
  id: 'r1',
  document_type: 'host_letter_of_invitation',
  label: 'HOST: writes and signs a letter of invitation',
  required: true,
  added_reason: 'base_requirement',
  meta: { kind: 'document', owner: 'applicant' },
  ...o,
});

const LETTER: SourcedDocument = {
  type: 'host_letter_of_invitation',
  label: 'Letter of invitation from your host (child or grandchild)',
  owner: 'sponsor',
  specs: { note: 'Must list everyone counted in the family size.' },
};

describe('planRegistryReconcile', () => {
  it('rewrites a sourced row whose label, owner or guidance changed', () => {
    const plan = planRegistryReconcile([row({})], [LETTER], [], new Set());
    expect(plan.deletes).toEqual([]);
    expect(plan.updates).toEqual([
      {
        id: 'r1',
        values: {
          label: LETTER.label,
          meta: {
            kind: 'document',
            owner: 'sponsor',
            specs: { note: 'Must list everyone counted in the family size.' },
          },
        },
      },
    ]);
  });

  it('touches nothing when the row already matches', () => {
    const plan = planRegistryReconcile(
      [
        row({
          label: LETTER.label,
          meta: {
            kind: 'document',
            owner: 'sponsor',
            specs: { note: 'Must list everyone counted in the family size.' },
          },
        }),
      ],
      [LETTER],
      [],
      new Set(),
    );
    expect(plan).toEqual({ updates: [], deletes: [] });
  });

  it('demotes a row the registry now marks optional, and promotes one it marks required', () => {
    const plan = planRegistryReconcile(
      [
        row({
          id: 'a',
          document_type: 'proof_of_medical_exam',
          required: true,
          label: 'IME',
        }),
        row({
          id: 'b',
          document_type: 'medical_insurance',
          required: false,
          label: 'Ins',
        }),
      ],
      [
        { type: 'proof_of_medical_exam', label: 'IME', required: false },
        { type: 'medical_insurance', label: 'Ins' },
      ],
      [],
      new Set(),
    );
    expect(plan.updates).toEqual(
      expect.arrayContaining([
        { id: 'a', values: { required: false } },
        { id: 'b', values: { required: true } },
      ]),
    );
  });

  it('removes an unused row whose requirement is no longer a document (a content rule)', () => {
    const plan = planRegistryReconcile(
      [row({ id: 'rule', document_type: 'letter_of_invitation_contents' })],
      [LETTER],
      [],
      new Set(),
    );
    expect(plan.deletes).toEqual(['rule']);
  });

  it('keeps a stale row the applicant uploaded into, but stops it gating', () => {
    const plan = planRegistryReconcile(
      [
        row({
          id: 'used',
          document_type: 'income_proof_option_two',
          required: true,
        }),
      ],
      [LETTER],
      [],
      new Set(['used']),
    );
    expect(plan.deletes).toEqual([]);
    expect(plan.updates).toEqual([{ id: 'used', values: { required: false } }]);
  });

  it('keeps a row whose requirement is merely undetermined', () => {
    const plan = planRegistryReconcile(
      [
        row({
          id: 'u',
          document_type: 'minor_travel_authorization',
          added_reason: 'base_conditional',
          required: false,
        }),
      ],
      [],
      ['minor_travel_authorization'],
      new Set(),
    );
    expect(plan).toEqual({ updates: [], deletes: [] });
  });

  it('never touches forms, discovery, strengthening or family-gap rows', () => {
    const plan = planRegistryReconcile(
      [
        row({
          id: 'f',
          document_type: 'form_imm_5257',
          added_reason: 'base_form',
          meta: { kind: 'form' },
        }),
        row({
          id: 'd',
          document_type: 'bank_statement',
          added_reason: 'discovery:funds',
        }),
        row({
          id: 's',
          document_type: 'property_deed',
          added_reason: 'strengthening:ties',
        }),
        row({
          id: 'g',
          document_type: 'birth_certificate',
          added_reason: 'family_gap:child',
        }),
      ],
      [LETTER],
      [],
      new Set(),
    );
    expect(plan).toEqual({ updates: [], deletes: [] });
  });

  it('does not rewrite a label it cannot see (partial row)', () => {
    const plan = planRegistryReconcile(
      [row({ label: undefined, meta: { kind: 'document' } })],
      [{ type: 'host_letter_of_invitation', label: 'New' }],
      [],
      new Set(),
    );
    expect(plan.updates).toEqual([]);
  });
});
