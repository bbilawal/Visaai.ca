import {
  convertRegistryToFramework,
  type RegistryRequirement,
} from './registry-to-framework';

const req = (o: Partial<RegistryRequirement>): RegistryRequirement => ({
  requirement_code: 'passport_copy',
  kind: 'evidence',
  officially_required: true,
  label: 'Digital copy of your valid passport',
  description: null,
  official_form_code: null,
  official_form_url: null,
  rule: null,
  display_order: 100,
  ...o,
});

describe('convertRegistryToFramework', () => {
  it('emits unconditional evidence as a base document', () => {
    const { framework } = convertRegistryToFramework('ca-visitor', [req({})]);
    expect(framework.base_documents).toEqual([
      { type: 'passport_copy', label: 'Digital copy of your valid passport' },
    ]);
  });

  it('emits a form with its official code and url', () => {
    const { framework } = convertRegistryToFramework('ca-visitor', [
      req({
        requirement_code: 'imm5257',
        kind: 'form',
        label: 'Application for Visitor Visa',
        official_form_code: 'IMM 5257',
        official_form_url: 'https://www.canada.ca/imm5257.html',
      }),
    ]);
    expect(framework.base_forms).toEqual([
      {
        form_code: 'IMM 5257',
        form_name: 'Application for Visitor Visa',
        source_url: 'https://www.canada.ca/imm5257.html',
      },
    ]);
  });

  it('falls back to the requirement code when a government publishes no form number', () => {
    // The UK and Australia publish none. The item must still appear.
    const { framework } = convertRegistryToFramework('gb-visitor', [
      req({
        requirement_code: 'online_application',
        kind: 'form',
        official_form_code: null,
      }),
    ]);
    expect(framework.base_forms[0].form_code).toBe('ONLINE_APPLICATION');
    expect(framework.base_forms[0].source_url).toBeUndefined();
  });

  it('keeps conditions, steps and fees OUT of the document list', () => {
    // A checklist is things to obtain and upload. "Be in good health" and
    // "pay CAD 100" are neither, and listing them produces items an applicant
    // can never satisfy by uploading a file.
    const { framework } = convertRegistryToFramework('ca-visitor', [
      req({
        requirement_code: 'good_health',
        kind: 'condition',
        label: 'Be in good health',
      }),
      req({
        requirement_code: 'biometrics',
        kind: 'step',
        label: 'Give biometrics',
      }),
      req({
        requirement_code: 'processing_fee',
        kind: 'fee',
        label: 'Processing fee',
      }),
    ]);
    expect(framework.base_documents).toEqual([]);
    expect(framework.base_forms).toEqual([]);
  });

  it('includes a conditional requirement when the facts make it apply', () => {
    const { framework, undetermined } = convertRegistryToFramework(
      'ca-visitor',
      [
        req({
          requirement_code: 'minor_travel_authorization',
          label: 'Letter authorizing a minor to travel',
          rule: { fact: 'is_minor', op: 'eq', value: true },
        }),
      ],
      { is_minor: true },
    );
    expect(framework.base_documents).toHaveLength(1);
    expect(undetermined).toHaveLength(0);
  });

  it('excludes a conditional requirement a known fact rules out', () => {
    const { framework, excluded } = convertRegistryToFramework(
      'ca-visitor',
      [
        req({
          requirement_code: 'minor_travel_authorization',
          rule: { fact: 'is_minor', op: 'eq', value: true },
        }),
      ],
      { is_minor: false },
    );
    expect(framework.base_documents).toHaveLength(0);
    expect(excluded).toEqual(['minor_travel_authorization']);
  });

  it('does NOT drop a requirement whose question has not been asked', () => {
    // The failure the three-valued engine exists to prevent. Dropping this
    // shows the applicant a complete-looking checklist that silently omits a
    // document they will need.
    const { framework, undetermined } = convertRegistryToFramework(
      'ca-visitor',
      [
        req({
          requirement_code: 'minor_travel_authorization',
          label: 'Letter authorizing a minor to travel',
          rule: { fact: 'is_minor', op: 'eq', value: true },
        }),
      ],
    );
    expect(framework.base_documents).toHaveLength(0);
    expect(undetermined).toEqual([
      {
        requirement_code: 'minor_travel_authorization',
        label: 'Letter authorizing a minor to travel',
        dependsOn: ['is_minor'],
        kind: 'evidence',
      },
    ]);
  });

  it('carries kind and form identity on an undetermined form, so it can be rendered', () => {
    const { undetermined } = convertRegistryToFramework('ca-visitor', [
      req({
        requirement_code: 'imm5645',
        kind: 'form',
        label: 'Family Information form',
        official_form_code: 'IMM 5645',
        official_form_url: 'https://www.canada.ca/imm5645.pdf',
        rule: { fact: 'has_dependants', op: 'eq', value: true },
      }),
    ]);
    expect(undetermined[0]).toMatchObject({
      requirement_code: 'imm5645',
      kind: 'form',
      official_form_code: 'IMM 5645',
      official_form_url: 'https://www.canada.ca/imm5645.pdf',
    });
  });

  it('reports every fact an undetermined requirement depends on', () => {
    // Drives the next question: ask what actually settles the item.
    const { undetermined } = convertRegistryToFramework('ca-visitor', [
      req({
        rule: {
          any: [
            { fact: 'travelling_with_minor', op: 'eq', value: true },
            { fact: 'is_minor', op: 'eq', value: true },
          ],
        },
      }),
    ]);
    expect(undetermined[0].dependsOn.sort()).toEqual([
      'is_minor',
      'travelling_with_minor',
    ]);
  });

  it('emits no branch_rules, because the old shape cannot carry these conditions', () => {
    // Down-converting "nationality in [...]" into a single equality check
    // would silently drop the condition and make the requirement look
    // unconditional. Conditions are evaluated here instead.
    const { framework } = convertRegistryToFramework('ca-visitor', [
      req({ rule: { fact: 'nationality', op: 'in', value: ['IN', 'PK'] } }),
    ]);
    expect(framework.branch_rules).toEqual([]);
  });

  it('preserves display order', () => {
    const { framework } = convertRegistryToFramework('ca-visitor', [
      req({ requirement_code: 'second', display_order: 200 }),
      req({ requirement_code: 'first', display_order: 100 }),
    ]);
    expect(framework.base_documents.map((d) => d.type)).toEqual([
      'first',
      'second',
    ]);
  });

  it('carries the description through as a spec note', () => {
    const { framework } = convertRegistryToFramework('ca-visitor', [
      req({
        description: 'Valid for at least 6 months from your travel date.',
      }),
    ]);
    expect(framework.base_documents[0].specs).toEqual({
      note: 'Valid for at least 6 months from your travel date.',
    });
  });

  it('stamps provenance so the UI can say where the list came from', () => {
    const { framework } = convertRegistryToFramework('ca-visitor-visa', [
      req({}),
    ]);
    expect(framework.source).toBe('visa_registry');
    expect(framework.visaai_id).toBe('ca-visitor-visa');
  });

  it('includes a recommended item as a document but the caller can tell them apart', () => {
    // kind='recommended' is VisaAI advice. It reaches the checklist, but the
    // registry row it came from still carries officially_required=false, so
    // the surface that renders it can separate the two.
    const { framework } = convertRegistryToFramework('ca-visitor', [
      req({
        requirement_code: 'travel_history',
        kind: 'recommended',
        officially_required: false,
      }),
    ]);
    expect(framework.base_documents).toHaveLength(1);
    // Dry run 2026-10-14: emitted without this flag, "Evidence of previous
    // travel" became a REQUIRED item that blocked form generation for an
    // applicant who has never travelled, with no way to satisfy it.
    expect(framework.base_documents[0].required).toBe(false);
  });

  it('marks evidence that is not officially required as optional', () => {
    const { framework } = convertRegistryToFramework('ca-visitor', [
      req({ requirement_code: 'extra', officially_required: false }),
    ]);
    expect(framework.base_documents[0].required).toBe(false);
  });

  it('leaves officially required evidence required (no flag)', () => {
    const { framework } = convertRegistryToFramework('ca-visitor', [req({})]);
    expect(framework.base_documents[0].required).toBeUndefined();
  });

  it('handles an empty registry without producing a broken framework', () => {
    const { framework, undetermined, excluded } = convertRegistryToFramework(
      'xx-none',
      [],
    );
    expect(framework.base_documents).toEqual([]);
    expect(framework.base_forms).toEqual([]);
    expect(undetermined).toEqual([]);
    expect(excluded).toEqual([]);
  });

  it('does not throw on a malformed rule; it treats it as undetermined', () => {
    // Evaluation runs inside checklist rendering and must never take it down.
    const { framework, undetermined } = convertRegistryToFramework(
      'ca-visitor',
      [req({ rule: { nonsense: true } })],
    );
    expect(framework.base_documents).toHaveLength(0);
    expect(undetermined).toHaveLength(1);
  });
});

describe('convertRegistryToFramework — form guidance (#50)', () => {
  it("carries a form requirement's description as its note", () => {
    const { framework } = convertRegistryToFramework(
      'ca-visitor-visa-temporary-resident-visa',
      [
        {
          requirement_code: 'imm5476',
          kind: 'form',
          officially_required: true,
          label: 'Use of a Representative',
          description: 'Sign it, have your representative sign it, upload it.',
          official_form_code: 'IMM 5476',
          official_form_url: null,
          rule: { fact: 'uses_representative', op: 'eq', value: true },
          display_order: 1,
        },
      ],
      { uses_representative: true },
    );
    expect(framework.base_forms).toEqual([
      {
        form_code: 'IMM 5476',
        form_name: 'Use of a Representative',
        specs: {
          note: 'Sign it, have your representative sign it, upload it.',
        },
      },
    ]);
  });
});

describe('convertRegistryToFramework — who supplies a document, and for how long it must be valid', () => {
  // Super visa (prod app 61f16bb5, 2026-10-16): the host's invitation letter,
  // proof of status and income proof were filed under the APPLICANT, so the
  // vault never said that a son in Canada had to produce them.
  it('files evidence the registry marks as the sponsor/host document under the sponsor', () => {
    const { framework } = convertRegistryToFramework('ca-super-visa', [
      req({
        requirement_code: 'host_letter_of_invitation',
        label: 'Letter of invitation from your host',
        parameters: { document_owner: 'sponsor' },
      }),
    ]);
    expect(framework.base_documents[0]).toEqual(
      expect.objectContaining({
        type: 'host_letter_of_invitation',
        owner: 'sponsor',
      }),
    );
  });

  it('leaves the applicant as owner when the registry says nothing', () => {
    const { framework } = convertRegistryToFramework('ca-super-visa', [
      req({ parameters: { colour: true } }),
    ]);
    expect(framework.base_documents[0].owner).toBeUndefined();
  });

  it('carries a minimum validity (months) so expiry is checked against it', () => {
    const { framework } = convertRegistryToFramework('ca-super-visa', [
      req({
        requirement_code: 'medical_insurance',
        label: 'Proof of Canadian medical insurance',
        parameters: { minimum_validity_months: 12, currency: 'CAD' },
      }),
    ]);
    expect(framework.base_documents[0].validity_months).toBe(12);
  });

  it('ignores a malformed validity rather than inventing one', () => {
    const { framework } = convertRegistryToFramework('ca-super-visa', [
      req({ parameters: { minimum_validity_months: 'twelve' } }),
    ]);
    expect(framework.base_documents[0].validity_months).toBeUndefined();
  });
});

describe('convertRegistryToFramework — evidence that may follow the application', () => {
  // Super visa IME: IRCC requires it, but a super visa applicant without an
  // upfront exam is told what to do by the visa office AFTER applying. It
  // blocked "Generate my forms" on prod app 61f16bb5.
  it('keeps it on the list but does not let it gate preparation', () => {
    const { framework } = convertRegistryToFramework('ca-super-visa', [
      req({
        requirement_code: 'proof_of_medical_exam',
        parameters: { may_follow_application: true },
      }),
    ]);
    expect(framework.base_documents[0]).toEqual(
      expect.objectContaining({
        type: 'proof_of_medical_exam',
        required: false,
      }),
    );
  });
});

describe('convertRegistryToFramework — a government fee receipt is obtained at submission', () => {
  it('lists the receipt but never makes it a gating slot', () => {
    const { framework } = convertRegistryToFramework('ca-sponsor-your-spouse-partner-or-child', [
      req({ requirement_code: 'processing_fee_receipt', label: 'Proof of payment (fee receipt)' }),
      req({}),
    ]);
    const byType = Object.fromEntries(framework.base_documents.map((d) => [d.type, d]));
    expect(byType.processing_fee_receipt.required).toBe(false);
    expect(byType.passport_copy.required).toBeUndefined();
  });

  it('does not loosen other evidence whose code merely mentions a fee', () => {
    const { framework } = convertRegistryToFramework('x', [
      req({ requirement_code: 'tuition_fee_paid_letter', label: 'Letter showing tuition paid' }),
      req({ requirement_code: 'endorsement_fee_receipt_copy', label: 'Endorsement fee receipt' }),
    ]);
    expect(framework.base_documents.map((d) => d.required)).toEqual([undefined, undefined]);
  });
});
