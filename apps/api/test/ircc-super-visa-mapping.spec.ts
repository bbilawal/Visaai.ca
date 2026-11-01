/**
 * Canada super visa (registry `ca-super-visa`) on IRCC tr-rt.
 *
 * A super visa is applied for in the same IRCC Portal temporary-residence
 * application as the visitor visa (TRV): same pages, same ids. What differs:
 *  - /purpose: "What are you applying for?" = Visitor visa (applyingFor 464),
 *    then "Visa type" = the super visa (visaPurpose 472, FAMILY_MORE_THAN_SIX),
 *    read off the portal's own bundle, not yet off a live page — so those two
 *    writes are UNVERIFIED: never probed, written last on the page, and a
 *    control that is not there halts the run instead of writing elsewhere;
 *  - the host is by definition the applicant's child or grandchild;
 *  - documents (invitation with host income, insurance, IME, relationship,
 *    host status, IMM 5476) are the applicant's to upload.
 */
import '../src/modules/automation/portal-fills/canada-ircc-super-visa'; // registers both
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  portalPageOrder,
  registerPortalFillVariant,
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
import { portalForRoute } from '../src/strategies';
import { selectPageGroups } from '../src/modules/portal-fill/page-groups';
import { IRCC_PAGES } from '../src/modules/automation/portal-fills/canada-ircc';
import type { SignedWriteIntent } from '@visaai/types';

const SV = 'ca-super-visa';
const base = () => resolvePortalFill('ircc')!;
const sv = () => resolvePortalFillFor('ircc', SV)!;

/** Modelled on the prod super visa intake of 2026-10-16 (names changed). */
const PARENT: Record<string, unknown> = {
  given_name: 'Muhammad',
  family_name: 'Khan',
  date_of_birth: '1958-03-09',
  nationality: 'PAK',
  passport_number: 'AB1234567',
  purpose_of_visit: 'family visit',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2028-02-28',
  destination_city: 'Milton',
  family_in_destination: true,
  financial_supporter: 'sons',
  has_travel_medical_insurance: true,
  travel_medical_insurance_duration_months: 12,
  uses_representative: true,
  representative_name: 'Ali Khan',
  host_name: 'Ali Khan',
};

describe('super visa — mapping selection', () => {
  it('a super visa application gets its own IRCC mapping', () => {
    expect(sv()).toBeDefined();
    expect(sv()).not.toBe(base());
  });

  it('any other route (and an unknown one) keeps the visitor mapping', () => {
    expect(
      resolvePortalFillFor('ircc', 'ca-visitor-visa-temporary-resident-visa'),
    ).toBe(base());
    expect(resolvePortalFillFor('ircc', null)).toBe(base());
    expect(resolvePortalFillFor('ircc', undefined)).toBe(base());
    expect(resolvePortalFillFor('nope', SV)).toBeUndefined();
  });

  it('keeps every visitor-visa write, same selector and order', () => {
    const svSelectors = sv().map((f) => `${f.page}|${f.selector}`);
    const baseSelectors = base().map((f) => `${f.page}|${f.selector}`);
    expect(svSelectors.filter((s) => baseSelectors.includes(s))).toEqual(
      baseSelectors,
    );
  });

  it("changes only the visitor mapping's visa purpose answer", () => {
    expect(base().some((f) => f.unverified)).toBe(false);
    expect(sv()).toHaveLength(base().length);
  });
});

describe('super visa — same portal as the visitor visa', () => {
  it('the route still files on IRCC tr-rt (portalForRoute)', () => {
    expect(portalForRoute('CA', SV)?.portalId).toBe('ircc');
  });

  it("does not register its pages as a portal's (page keys stay tr-rt's)", () => {
    // The registered page order is exactly tr-rt's (the visitor pages): the
    // super visa variant adds no page key of its own.
    expect(portalPageOrder('/purpose')).toEqual(IRCC_PAGES.map((p) => p.page));
  });

  it('a variant needs its base portal mapping', () => {
    expect(() => registerPortalFillVariant('nope', SV, [])).toThrow();
  });
});

describe('super visa — /purpose', () => {
  const all = buildMappingInputs(sv(), PARENT);
  const purpose = all.filter((m) => m.page === '/purpose');

  it('answers "applying for" Visitor visa, then the super visa type', () => {
    const applying = purpose.find((m) => m.fieldKey === 'ircc_applying_for');
    const type = purpose.find((m) => m.fieldKey === 'ircc_visa_purpose');
    expect(applying).toMatchObject({
      targetField: '#applyingFor_radio-button-464-input',
      mappedValue: 'Visitor visa',
      op: 'radio',
    });
    expect(type).toMatchObject({
      targetField: '#visaPurpose_radio-button-472-input',
      mappedValue:
        'Visit children or grandchildren for more than 6 months (super visa)',
      op: 'radio',
      reveal: true,
    });
  });

  it('answers the two radios first: a new draft shows the rest only after them (live 2026-10-18)', () => {
    const keys = purpose.map((m) => m.fieldKey);
    expect(keys.slice(0, 2)).toEqual([
      'ircc_applying_for',
      'ircc_visa_purpose',
    ]);
  });

  it('the stay dates are the whole stay (a super visa runs past 6 months)', () => {
    expect(
      purpose
        .filter((m) => m.fieldKey === 'planned_departure_date')
        .map((m) => m.mappedValue),
    ).toEqual(['2028', '02', '28']);
  });

  it('caps the purpose text at the 475 characters tr-rt accepts', () => {
    const f = sv().find((x) => x.profileKey === 'purpose_of_visit');
    expect(f?.maxLength).toBe(475);
    const long = buildMappingInputs(sv(), {
      ...PARENT,
      purpose_of_visit: `Visiting my son ${'and his family '.repeat(40)}`,
    });
    expect(long.some((m) => m.fieldKey === 'purpose_of_visit')).toBe(false);
  });

  it('the visitor mapping never answers "super visa"', () => {
    const trv = buildMappingInputs(base(), PARENT).filter(
      (m) => m.page === '/purpose',
    );
    expect(
      trv.some((m) => /visaPurpose_radio-button-472/.test(m.targetField)),
    ).toBe(false);
  });

  it('a page missing the unverified radios still fills its verified fields', () => {
    const intents = purpose.map(
      (m) =>
        ({
          fieldKey: m.fieldKey,
          page: m.page,
          selector: m.targetField,
          ...(m.reveal ? { reveal: true } : {}),
        }) as unknown as SignedWriteIntent,
    );
    const probe = purpose
      .filter((m) => !m.reveal)
      .map((m) => ({ selector: m.targetField, found: true }));
    const r = selectPageGroups(intents, probe, '/purpose');
    expect(r.ok).toBe(true);
  });
});

describe('super visa — host and invitation', () => {
  it('the host is a family member (a child or grandchild) when unstated', () => {
    const inv = buildMappingInputs(sv(), PARENT).find(
      (m) => m.fieldKey === 'inviter_relationship',
    );
    expect(inv).toMatchObject({
      targetField: '#relationInviter_select',
      mappedValue: 'Family member',
      op: 'select_text',
    });
    // The visitor mapping does not assume it.
    expect(
      buildMappingInputs(base(), PARENT).some(
        (m) => m.fieldKey === 'inviter_relationship',
      ),
    ).toBe(false);
  });

  it('a stated relationship still wins', () => {
    const inv = buildMappingInputs(sv(), {
      ...PARENT,
      host_relationship: 'friend',
    }).find((m) => m.fieldKey === 'inviter_relationship');
    expect(inv?.mappedValue).toBe('Friend');
  });
});

describe('super visa — preflight coverage', () => {
  const cov = (p: Record<string, unknown>) => portalFillCoverage(sv(), p);
  const page = (p: Record<string, unknown>, path: string) =>
    cov(p).pages.find((x) => x.page === path);

  it('counts the purpose radios as filled on /purpose', () => {
    const trv = portalFillCoverage(base(), PARENT).pages.find(
      (x) => x.page === '/purpose',
    );
    const trvRadios = buildMappingInputs(base(), PARENT).filter(
      (m) => m.page === '/purpose' && m.op === 'radio',
    ).length;
    expect(page(PARENT, '/purpose')?.filled).toBe(
      (trv?.filled ?? 0) - trvRadios + 2,
    );
  });

  it('lists the super visa documents on /doc-upload', () => {
    const labels = page(PARENT, '/doc-upload')!.left.map((l) => l.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Letter of invitation from your child or grandchild',
        "Proof of your host's income",
        'Proof of medical insurance',
        'Proof of your immigration medical exam',
        "Proof of your host's status in Canada",
        'Proof you are the parent or grandparent',
        'Use of a Representative (IMM 5476)',
      ]),
    );
  });

  it('IMM 5476 only when a representative is used', () => {
    const labels = page(
      { ...PARENT, uses_representative: false },
      '/doc-upload',
    )!.left.map((l) => l.label);
    expect(labels).not.toContain('Use of a Representative (IMM 5476)');
  });

  it('flags insurance shorter than a year or under $100,000', () => {
    const short = page(
      { ...PARENT, travel_medical_insurance_duration_months: 6 },
      '/doc-upload',
    )!.left.find((l) => l.label === 'Proof of medical insurance');
    expect(short?.note).toMatch(/at least 1 year/);
    const low = page(
      { ...PARENT, medical_insurance_coverage_cad: 50000 },
      '/doc-upload',
    )!.left.find((l) => l.label === 'Proof of medical insurance');
    expect(low?.note).toMatch(/\$100,000/);
    const none = page(
      { ...PARENT, has_travel_medical_insurance: false },
      '/doc-upload',
    )!.left.find((l) => l.label === 'Proof of medical insurance');
    expect(none?.reason).toBe('not_in_profile');
  });

  it('host income: the figure and a co-signer are read when recorded', () => {
    const inc = page(
      {
        ...PARENT,
        host_annual_income_cad: 85000,
        co_signer_name: 'Sara Khan',
      },
      '/doc-upload',
    )!.left.find((l) => l.label === "Proof of your host's income");
    expect(inc?.note).toMatch(/85,000/);
    expect(inc?.note).toMatch(/Sara Khan/);
  });

  it('IME: says so when the exam is not done yet', () => {
    const ime = page(
      { ...PARENT, ime_completed: false },
      '/doc-upload',
    )!.left.find((l) => l.label === 'Proof of your immigration medical exam');
    expect(ime?.note).toMatch(/before you apply/i);
  });

  it('representative page: listed for the applicant when one is used', () => {
    expect(page(PARENT, '/representative')?.left[0]).toMatchObject({
      reason: 'fill_yourself',
    });
    expect(
      page({ ...PARENT, uses_representative: false }, '/representative')
        ?.left ?? [],
    ).toEqual([]);
  });

  it('the visitor coverage has no super visa pages', () => {
    const pages = portalFillCoverage(base(), PARENT).pages.map((p) => p.page);
    const trRt = new Set(IRCC_PAGES.map((p) => p.page));
    expect(pages.filter((p) => !trRt.has(p))).toEqual([]);
  });
});

/**
 * Audit 2026-10-19: the PARENT fixture sets `family_in_destination: true`,
 * which the super visa interview never asks — so it hid that the host's
 * contact and the second-inviter radio were never asked. These profiles carry
 * only what the super visa interview records.
 */
describe('super visa — /inviter-info from the interview answers alone', () => {
  const INTERVIEW: Record<string, unknown> = { ...PARENT };
  delete INTERVIEW.family_in_destination;
  Object.assign(INTERVIEW, {
    inviter_relationship: 'son',
    inviter_address: '1202 Stirling Todd Terrace, Milton, ON L9T 6Y7',
    inviter_phone: '905-226-5664',
    inviter_phone_type: 'cell',
    inviter_email: 'ali.khan@example.com',
  });
  const at = (p: Record<string, unknown>, target: string) =>
    buildMappingInputs(sv(), p).find((m) => m.targetField === target);
  const SECOND = {
    ...INTERVIEW,
    has_second_inviter: true,
    second_inviter_name: 'Sara Khan',
    second_inviter_relationship: 'daughter-in-law',
    second_inviter_address: '1228 Turner Drive, Milton, ON L9T 5R6',
    second_inviter_phone: '647-819-8953',
    second_inviter_phone_type: 'cell',
    second_inviter_email: 'sara.khan@example.com',
  };
  const secondNote = (p: Record<string, unknown>) =>
    portalFillCoverage(sv(), p)
      .pages.find((x) => x.page === '/inviter-info')
      ?.left.find((l) => l.label === 'Second inviter');

  it("writes the host's phone type, number and email", () => {
    expect(
      at(INTERVIEW, '#telType_phoneNumberInviter_radio-button-02-input'),
    ).toBeDefined();
    expect(at(INTERVIEW, '#emailAddressInviter_input')?.mappedValue).toBe(
      'ali.khan@example.com',
    );
    expect(
      buildMappingInputs(sv(), INTERVIEW).some(
        (m) => m.fieldKey === 'inviter_phone' && /9052265664|905/.test(String(m.mappedValue)),
      ),
    ).toBe(true);
  });

  it('No: answers the second-inviter radio No and types no second inviter', () => {
    const p = { ...INTERVIEW, has_second_inviter: false };
    expect(at(p, '#hasSecondInviter_radio-button-02-input')).toBeDefined();
    expect(at(p, '#hasSecondInviter_radio-button-01-input')).toBeUndefined();
    expect(at(p, '#secondInviter_lastName_input')).toBeUndefined();
    expect(secondNote(p)).toBeUndefined();
  });

  it("Yes: answers Yes and types the second inviter's details", () => {
    expect(at(SECOND, '#hasSecondInviter_radio-button-01-input')).toBeDefined();
    expect(at(SECOND, '#secondInviter_lastName_input')).toBeDefined();
    expect(at(SECOND, '#relationInviterTwo_select')).toBeDefined();
    expect(at(SECOND, '#emailAddressInviterTwo_input')?.mappedValue).toBe(
      'sara.khan@example.com',
    );
    expect(secondNote(SECOND)).toBeUndefined();
  });

  it('Yes with a number outside Canada and the U.S.: "Other", its dialling code and number (live 2026-10-19)', () => {
    const p = { ...SECOND, second_inviter_phone: '+92 300 1234567' };
    const w = Object.fromEntries(
      buildMappingInputs(sv(), p).map((m) => [m.targetField, m.mappedValue]),
    );
    expect(w['#telLocation_phoneNumberInviterTwo_radio-button-02-input']).toBe('Other');
    expect(w['#telCountryCode_phoneNumberInviterTwo']).toBe('92');
    expect(w['#telNumber_phoneNumberInviterTwo']).toBe('3001234567');
    expect(secondNote(p)?.note ?? '').not.toMatch(/telephone number/);
  });

  it('Yes with a number VisaAI cannot place: nothing guessed, the number is named', () => {
    const p = { ...SECOND, second_inviter_phone: '12345' };
    expect(
      buildMappingInputs(sv(), p).some((m) =>
        /telCountryCode_phoneNumberInviterTwo|telNumber_phoneNumberInviterTwo/.test(
          String(m.targetField),
        ),
      ),
    ).toBe(false);
    expect(secondNote(p)?.note).toMatch(/12345/);
  });

  it('Yes with no number: the generic gap, no number named', () => {
    const p: Record<string, unknown> = { ...SECOND };
    delete p.second_inviter_phone;
    const note = secondNote(p)?.note;
    expect(note).toMatch(/telephone number/);
  });
});

describe('super visa — insurance under the interview key', () => {
  const ins = (p: Record<string, unknown>) =>
    portalFillCoverage(sv(), p)
      .pages.find((x) => x.page === '/doc-upload')!
      .left.find((l) => l.label === 'Proof of medical insurance');
  const P: Record<string, unknown> = {
    ...PARENT,
    has_super_visa_insurance: true,
  };
  delete P.travel_medical_insurance_duration_months;

  it('a policy under a year recorded as medical_insurance_months is flagged', () => {
    expect(ins({ ...P, medical_insurance_months: 6 })?.note).toMatch(
      /recorded as 6 months/,
    );
  });

  it('a year or more is not flagged', () => {
    expect(ins({ ...P, medical_insurance_months: 12 })?.note).not.toMatch(
      /recorded as/,
    );
  });

  it('cover recorded under insurance_coverage_amount is checked', () => {
    expect(
      ins({ ...P, medical_insurance_months: 12, insurance_coverage_amount: 50000 })
        ?.note,
    ).toMatch(/\$100,000/);
  });
});
