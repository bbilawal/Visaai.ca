/**
 * Canada business visitor (registry `ca-business-visitors`) on IRCC tr-rt.
 *
 * Same portal and pages as the visitor visa (TRV); what differs:
 *  - /purpose: "Why you need a visa" is always Business (473), whatever the
 *    stated purpose text or the host's relationship would derive for a TRV;
 *  - /inviter-info: the inviter is the Canadian contact, so the relationship
 *    is Organization (Conference for an event) unless the profile says;
 *  - the intake and Forms page ask who invites them and what they will do,
 *    family in Canada or not (the TRV host questions hang off
 *    `family_in_destination`, so a business trip was never asked).
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';
import '../src/modules/automation/portal-fills/canada-ircc-super-visa';
import '../src/modules/automation/portal-fills/canada-ircc-business-visitor';
import {
  CA_ETA_VISAAI_ID,
  intakeFactSpecs,
  missingIntakeFacts,
  type PrefilledFormField,
} from '@visaai/types';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
import { portalForRoute } from '../src/strategies';
import {
  finalizeFields,
  type FinalizeContext,
} from '../src/modules/prefill/graphs/nodes/finalize-fields';
import {
  businessPurposePhrase,
  isBusinessEvent,
} from '../src/modules/automation/portal-fills/canada-ircc-business-visitor';

const BIZ = 'ca-business-visitors';
const TRV = 'ca-visitor-visa-temporary-resident-visa';
const SV = 'ca-super-visa';
const ETA = CA_ETA_VISAAI_ID;

function mappingFor(visaaiId: string) {
  const portalId = portalForRoute('CA', visaaiId)?.portalId;
  return resolvePortalFillFor(portalId!, visaaiId)!;
}
const base = () => resolvePortalFill('ircc')!;
const biz = () => mappingFor(BIZ);

const value = (
  inputs: ReturnType<typeof buildMappingInputs>,
  key: string,
): unknown => inputs.find((m) => m.fieldKey === key)?.mappedValue;

const TRAVELLER: Record<string, unknown> = {
  given_name: 'Adaeze',
  family_name: 'Okafor',
  date_of_birth: '1984-06-12',
  nationality: 'NGA',
  country_of_residence: 'Nigeria',
  passport_number: 'A12345678',
  planned_entry_date: '2027-04-10',
  planned_departure_date: '2027-04-20',
  business_activity: 'meetings with a supplier to negotiate a contract',
  canadian_business_name: 'Maple Robotics Inc.',
  inviter_name: 'John Tremblay',
  inviter_address: '100 King St W, Toronto, ON M5X 1A9',
  inviter_phone: '416-555-0100',
  inviter_email: 'john.tremblay@example.com',
};

const form = (
  key: string,
  v: string,
  source: PrefilledFormField['source'],
): PrefilledFormField => ({
  key,
  label: key,
  value: v,
  group: 'Travel',
  source,
});

describe('business visitor — mapping selection', () => {
  it('resolves its own variant of the tr-rt mapping', () => {
    expect(portalForRoute('CA', BIZ)?.portalId).toBe('ircc');
    expect(biz()).toBeDefined();
    expect(biz()).not.toBe(base());
    expect(biz()).not.toBe(mappingFor(SV));
  });

  it('TRV, super visa and eTA mappings are unchanged by it', () => {
    expect(mappingFor(TRV)).toBe(base());
    expect(mappingFor(ETA)).toBe(resolvePortalFill('ircc-eta'));
    expect(mappingFor(SV)).not.toBe(base());
  });

  it('keeps every visitor-visa write, same page, selector and order', () => {
    expect(
      biz()
        .filter((f) => f.page !== '/special-event-code')
        .map((f) => `${f.page}|${f.selector}`),
    ).toEqual(base().map((f) => `${f.page}|${f.selector}`));
  });

  it('adds only the special-event-code page, right after the invitation', () => {
    const pages = biz().map((f) => f.page);
    const at = pages.indexOf('/special-event-code');
    expect(at).toBe(pages.lastIndexOf('/inviter-info') + 1);
    expect(base().some((f) => f.page === '/special-event-code')).toBe(false);
  });
});

describe('business visitor — visa purpose is always Business (473)', () => {
  const purpose = (p: Record<string, unknown>) =>
    buildMappingInputs(biz(), p).filter((m) => m.page === '/purpose');

  it('from the business answers', () => {
    const inputs = purpose(TRAVELLER);
    expect(value(inputs, 'ircc_applying_for')).toBe('Visitor visa');
    expect(value(inputs, 'ircc_visa_purpose')).toBe('Business');
    expect(
      inputs.find((m) => m.fieldKey === 'ircc_visa_purpose')?.targetField,
    ).toBe('#visaPurpose_radio-button-473-input');
  });

  it('even when the purpose text names family, or the host is a relative', () => {
    const inputs = purpose({
      ...TRAVELLER,
      purpose_of_visit: "meet my brother's company about an order",
      inviter_relationship: 'brother',
      inviter_status: 'Canadian citizen',
    });
    expect(value(inputs, 'ircc_visa_purpose')).toBe('Business');
  });

  it('even with a stored TRV / super visa purpose or a Forms override', () => {
    const q = applyPrefillOverrides(biz(), TRAVELLER, [
      form('ircc_visa_purpose', 'Tourism', 'consultant'),
      form(
        'visa_purpose',
        'Visit children or grandchildren for more than 6 months (super visa)',
        'applicant',
      ),
    ]);
    expect(value(purpose(q), 'ircc_visa_purpose')).toBe('Business');
  });

  it('a TRV with the same answers still derives its own purpose', () => {
    const inputs = buildMappingInputs(base(), {
      ...TRAVELLER,
      purpose_of_visit: 'tourism',
      business_activity: undefined,
    });
    expect(value(inputs, 'ircc_visa_purpose')).toBe('Tourism');
  });
});

describe('business visitor — purpose description', () => {
  const text = (p: Record<string, unknown>) =>
    String(value(buildMappingInputs(biz(), p), 'purpose_of_visit'));

  it('composed from the business answers, with the dates, when none was typed', () => {
    expect(text(TRAVELLER)).toBe(
      'Business visit to Maple Robotics Inc. for meetings with a supplier to negotiate a contract from April 10, 2027 to April 20, 2027 (11 days): visiting John Tremblay. I will return home on April 20, 2027.',
    );
  });

  it('a thin typed purpose ("Business") is composed too', () => {
    expect(text({ ...TRAVELLER, purpose_of_visit: 'Business' })).toMatch(
      /^Business visit to Maple Robotics Inc\. for meetings/,
    );
  });

  it('a real typed description wins (the dates are still added)', () => {
    const t = text({
      ...TRAVELLER,
      purpose_of_visit: 'Contract negotiation at Maple Robotics, Toronto.',
    });
    expect(t).toMatch(/^Contract negotiation at Maple Robotics, Toronto/);
  });

  it('a blank left on the form stays blank', () => {
    expect(
      value(
        buildMappingInputs(biz(), { ...TRAVELLER, purpose_of_visit: '' }),
        'purpose_of_visit',
      ),
    ).toBeUndefined();
  });

  it('the TRV composition is unchanged', () => {
    expect(
      String(
        value(
          buildMappingInputs(base(), {
            ...TRAVELLER,
            purpose_of_visit: 'Business',
          }),
          'purpose_of_visit',
        ),
      ),
    ).toMatch(/^Business from April 10, 2027/);
  });

  it('phrase: no repeated company, no trailing period, nothing invented', () => {
    expect(
      businessPurposePhrase({
        business_activity: 'Attend meetings with Acme Corp.',
        canadian_business_name: 'Acme Corp.',
      }),
    ).toBe('Business visit to attend meetings with Acme Corp');
    expect(
      businessPurposePhrase({
        business_activity: 'meet scrap metal suppliers',
        canadian_business_name: 'Acme',
      }),
    ).toBe('Business visit to Acme to meet scrap metal suppliers');
    expect(businessPurposePhrase({ canadian_business_name: 'Acme' })).toBe(
      'Business visit to Acme',
    );
    expect(businessPurposePhrase({})).toBeUndefined();
  });

  it('never longer than the portal takes (475)', () => {
    expect(
      value(
        buildMappingInputs(biz(), {
          ...TRAVELLER,
          business_activity: 'x '.repeat(300),
        }),
        'purpose_of_visit',
      ),
    ).toBeUndefined();
  });
});

describe('business visitor — inviter', () => {
  const inviter = (p: Record<string, unknown>) =>
    buildMappingInputs(biz(), p).filter((m) => m.page === '/inviter-info');

  it('the contact at a company is an Organization', () => {
    const inputs = inviter(TRAVELLER);
    expect(value(inputs, 'inviter_relationship')).toBe('Organization');
    expect(value(inputs, 'inviter_family_name')).toBe('Tremblay');
    expect(value(inputs, 'inviter_given_name')).toBe('John');
    expect(value(inputs, 'inviter_city')).toBe('Toronto');
  });

  it('an event organiser is a Conference', () => {
    expect(
      value(
        inviter({ ...TRAVELLER, business_activity: 'attend a trade fair' }),
        'inviter_relationship',
      ),
    ).toBe('Conference');
    expect(
      value(
        inviter({ ...TRAVELLER, attending_business_event: 'Yes' }),
        'inviter_relationship',
      ),
    ).toBe('Conference');
  });

  it('a relationship the profile states wins', () => {
    expect(
      value(
        inviter({ ...TRAVELLER, inviter_relationship: 'friend' }),
        'inviter_relationship',
      ),
    ).toBe('Friend');
  });

  it('never the relative being visited or the hotel', () => {
    const p = {
      ...TRAVELLER,
      inviter_name: undefined,
      inviter_address: undefined,
      family_in_destination: 'Yes',
      family_member_name: 'Ali Khan',
      relationship_to_family_in_destination: 'brother',
      accommodation_provider_name: 'Hilton Toronto',
    };
    const inputs = inviter(p);
    expect(value(inputs, 'inviter_given_name')).toBeUndefined();
    expect(value(inputs, 'inviter_family_name')).toBeUndefined();
    expect(value(inputs, 'inviter_relationship')).toBe('Organization');
    // The TRV keeps visiting the brother.
    const trv = buildMappingInputs(base(), p);
    expect(value(trv, 'inviter_given_name')).toBe('Ali');
    expect(value(trv, 'inviter_relationship')).toBe('Family member');
  });

  it('business_contact_* answers reach the inviter page', () => {
    const inputs = inviter({
      ...TRAVELLER,
      inviter_name: undefined,
      business_contact_name: 'Marie Roy',
    });
    expect(value(inputs, 'inviter_given_name')).toBe('Marie');
    expect(value(inputs, 'inviter_family_name')).toBe('Roy');
  });

  it('a TRV host with no relationship stays unanswered', () => {
    const inputs = buildMappingInputs(base(), TRAVELLER).filter(
      (m) => m.page === '/inviter-info',
    );
    expect(value(inputs, 'inviter_relationship')).toBeUndefined();
  });

  it('isBusinessEvent: an explicit No wins over the activity', () => {
    expect(
      isBusinessEvent({
        business_activity: 'conference',
        attending_business_event: 'No',
      }),
    ).toBe(false);
  });
});

describe('business visitor — documents left for the applicant', () => {
  const left = (p: Record<string, unknown>) =>
    (
      portalFillCoverage(biz(), p).pages.find((x) => x.page === '/doc-upload')
        ?.left ?? []
    ).map((n) => n.label);

  it('invitation and employer letter always', () => {
    expect(left(TRAVELLER)).toEqual(
      expect.arrayContaining([
        'Letter of invitation from the Canadian business',
        'Letter from your employer outside Canada',
      ]),
    );
  });

  it('event registration and a service contract only when they apply', () => {
    expect(left(TRAVELLER)).not.toContain('Event registration');
    expect(left(TRAVELLER)).not.toContain('Warranty or service contract');
    const l = left({
      ...TRAVELLER,
      business_activity: 'after-sales service on equipment at a trade fair',
    });
    expect(l).toContain('Event registration');
    expect(l).toContain('Warranty or service contract');
  });

  it('no super visa documents', () => {
    const all = portalFillCoverage(biz(), TRAVELLER).pages.flatMap((x) =>
      x.left.map((n) => n.label),
    );
    expect(all.join('|')).not.toMatch(
      /Proof of medical insurance|Proof of your immigration medical exam|Proof of your host's income|Super visa/,
    );
  });
});

describe('business visitor — intake asks who invites them', () => {
  const ctx = { country: 'CA', visaaiId: BIZ };
  const keys = (id: string) =>
    intakeFactSpecs({ country: 'CA', visaaiId: id }).map((f) => f.key);

  it('business facts on the business route only', () => {
    const k = keys(BIZ);
    for (const key of [
      'business_activity',
      'canadian_business_name',
      'inviter_name',
      'inviter_address',
      'paid_by_canadian_source',
    ])
      expect(k).toContain(key);
    for (const id of [TRV, SV, ETA]) {
      expect(keys(id)).not.toContain('business_activity');
      expect(keys(id)).not.toContain('paid_by_canadian_source');
    }
  });

  it('the contact is asked with no family in Canada', () => {
    const missing = missingIntakeFacts(
      { family_in_destination: false },
      ctx,
    ).map((f) => f.key);
    expect(missing).toEqual(
      expect.arrayContaining([
        'inviter_name',
        'inviter_phone',
        'inviter_email',
      ]),
    );
  });

  it('a second inviter is asked with no family in Canada', () => {
    const missing = (p: Record<string, unknown>) =>
      missingIntakeFacts(p, ctx).map((f) => f.key);
    expect(missing({ family_in_destination: false })).toContain(
      'has_second_inviter',
    );
    expect(missing({ has_second_inviter: 'Yes' })).toContain(
      'second_inviter_name',
    );
  });

  it('a TRV with no family in Canada is still not asked for a host', () => {
    const missing = missingIntakeFacts(
      { family_in_destination: false },
      { country: 'CA', visaaiId: TRV },
    ).map((f) => f.key);
    expect(missing).not.toContain('inviter_phone');
    expect(missing).not.toContain('has_second_inviter');
  });

  it('the event code only for an event', () => {
    const k = (p: Record<string, unknown>) =>
      missingIntakeFacts(p, ctx).map((f) => f.key);
    expect(k({ attending_business_event: 'No' })).not.toContain('event_code');
    expect(k({ attending_business_event: 'Yes' })).toContain('event_code');
  });
});

describe('business visitor — Forms page', () => {
  const ctx = (
    profile: Record<string, unknown>,
    visaaiId: string,
  ): FinalizeContext => ({
    applicantName: 'ADAEZE OKAFOR',
    profile,
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route: { country: 'CA', visaaiId },
  });
  const keys = (p: Record<string, unknown>, id: string) =>
    finalizeFields([], ctx(p, id)).map((f) => f.key);

  it('asks the business contact, not the host status', () => {
    const k = keys({ given_name: 'Adaeze', family_name: 'Okafor' }, BIZ);
    expect(k).toEqual(
      expect.arrayContaining([
        'business_activity',
        'canadian_business_name',
        'inviter_name',
        'inviter_address',
        'inviter_phone',
        'inviter_email',
      ]),
    );
    expect(k).not.toContain('inviter_status');
  });

  it('TRV, super visa and eTA forms get no business questions', () => {
    for (const id of [TRV, SV, ETA]) {
      const k = keys(TRAVELLER, id);
      expect(k).not.toContain('business_activity');
      expect(k).not.toContain('canadian_business_name');
    }
  });
});

describe('business visitor — organization name (live 2026-10-19)', () => {
  const org = (m: ReturnType<typeof biz>, p: Record<string, unknown>) =>
    value(buildMappingInputs(m, p), 'inviter_organization_name');

  it('the Canadian business, revealed by Organization', () => {
    expect(org(biz(), TRAVELLER)).toBe('Maple Robotics Inc.');
    const f = biz().find((x) => x.profileKey === 'inviter_organization_name')!;
    expect(f.selector).toBe('#nameOfOrgInviter_input');
    expect(f.parent).toBe('inviter_relationship');
  });

  it('the event for a Conference, the business when the event has no name', () => {
    const event = {
      ...TRAVELLER,
      attending_business_event: 'Yes',
      event_name: 'Collision Toronto 2027',
    };
    expect(org(biz(), event)).toBe('Collision Toronto 2027');
    expect(org(biz(), { ...TRAVELLER, attending_business_event: 'Yes' })).toBe(
      'Maple Robotics Inc.',
    );
  });

  it('a Conference prefers the event name over a company answer', () => {
    expect(
      org(biz(), {
        ...TRAVELLER,
        attending_business_event: 'Yes',
        event_name: 'Collision Toronto 2027',
        inviter_company_name: 'Collision Inc.',
      }),
    ).toBe('Collision Toronto 2027');
  });

  it("the inviter's own organization answer wins", () => {
    expect(
      org(biz(), { ...TRAVELLER, inviter_organization: 'Maple Group Ltd.' }),
    ).toBe('Maple Group Ltd.');
  });

  it('a TRV host who is family is never asked; an organization host is', () => {
    expect(
      org(base(), { ...TRAVELLER, inviter_relationship: 'brother' }),
    ).toBeUndefined();
    expect(
      org(base(), {
        ...TRAVELLER,
        inviter_relationship: 'company',
        inviter_company_name: 'Acme Ltd.',
      }),
    ).toBe('Acme Ltd.');
  });

  it('listed for the applicant when no name is known', () => {
    const p = { ...TRAVELLER, canadian_business_name: undefined };
    expect(org(biz(), p)).toBeUndefined();
    const left = portalFillCoverage(biz(), p).pages.find(
      (x) => x.page === '/inviter-info',
    )!.left;
    expect(left.map((n) => n.label)).toContain(
      'Inviter — name of organization or conference',
    );
  });
});

describe('business visitor — inviter address in parts (live 2026-10-19)', () => {
  const addr = (p: Record<string, unknown>) => {
    const inputs = buildMappingInputs(biz(), p);
    return {
      manual: value(inputs, 'inviter_manual_address'),
      num: value(inputs, 'inviter_street_number'),
      street: value(inputs, 'inviter_street'),
      city: value(inputs, 'inviter_city'),
      province: value(inputs, 'inviter_province'),
      postal: value(inputs, 'inviter_postal_code'),
    };
  };
  const host = (address: unknown) => ({
    ...TRAVELLER,
    inviter_address: undefined,
    canadian_business_address: address,
  });

  it('a one-line business address, postal code "A1A 1A1"', () => {
    expect(addr(host('100 King St W, Toronto, ON M5H1A1'))).toEqual({
      manual: 'Yes',
      num: '100',
      street: 'King St W',
      city: 'Toronto',
      province: 'Ontario',
      postal: 'M5H 1A1',
    });
  });

  it('province and postal code as separate parts', () => {
    expect(
      addr(host('100 King St W, Toronto, Ontario, m5h 1a1, Canada')).postal,
    ).toBe('M5H 1A1');
  });

  it('a dashed postal code and an accented province', () => {
    expect(addr(host('100 King St W, Toronto, ON, M5H-1A1')).postal).toBe(
      'M5H 1A1',
    );
    expect(
      addr(host('1 Rue Sainte-Catherine, Montréal, Québec H2X 1L4')),
    ).toMatchObject({ province: 'Quebec', postal: 'H2X 1L4' });
  });

  it('an address object', () => {
    expect(
      addr(
        host({
          street: '100 King St W',
          city: 'Toronto',
          province: 'ON',
          postal_code: 'M5H1A1',
        }),
      ),
    ).toMatchObject({ num: '100', province: 'Ontario', postal: 'M5H 1A1' });
  });

  it('an address that cannot be split is left, not guessed', () => {
    const p = host('King Street, Toronto');
    expect(addr(p).manual).toBeUndefined();
    const left = portalFillCoverage(biz(), p).pages.find(
      (x) => x.page === '/inviter-info',
    )!.left;
    expect(left.map((n) => n.label)).toContain(
      'Inviter — enter the address manually',
    );
  });

  it('every route writes "A1A 1A1"', () => {
    const p = { ...TRAVELLER, inviter_address: '5 Main St, Ottawa, ON K1A0B1' };
    expect(value(buildMappingInputs(base(), p), 'inviter_postal_code')).toBe(
      'K1A 0B1',
    );
  });
});

describe('business visitor — special event code (live 2026-10-19)', () => {
  const answer = (p: Record<string, unknown>) =>
    value(buildMappingInputs(biz(), p), 'has_special_event_code');
  const left = (p: Record<string, unknown>) =>
    portalFillCoverage(biz(), p).pages.find(
      (x) => x.page === '/special-event-code',
    )?.left ?? [];

  it('No only on an explicit answer; unknown is listed', () => {
    expect(answer({ ...TRAVELLER, attending_business_event: 'No' })).toBe('No');
    expect(answer({ ...TRAVELLER, attending_business_event: false })).toBe(
      'No',
    );
    expect(left({ ...TRAVELLER, attending_business_event: 'No' })).toEqual([]);
    expect(answer(TRAVELLER)).toBeUndefined();
    expect(left(TRAVELLER)).toEqual([
      expect.objectContaining({ reason: 'needs_your_answer' }),
    ]);
    const f = biz().find((x) => x.profileKey === 'has_special_event_code')!;
    expect(f.choices).toEqual({
      Yes: '#hasSpecialEventCode_radio-button-01-input',
      No: '#hasSpecialEventCode_radio-button-02-input',
    });
  });

  it('with an event code: Yes is written and the code typed into #codeIRCC_input (live 2026-10-19)', () => {
    for (const event_code of ['EV123', 12345]) {
      const p = { ...TRAVELLER, attending_business_event: 'Yes', event_code };
      const inputs = buildMappingInputs(biz(), p);
      expect(answer(p)).toBe('Yes');
      expect(
        inputs.find((m) => m.targetField === '#codeIRCC_input'),
      ).toMatchObject({ mappedValue: String(event_code), page: '/special-event-code' });
      expect(left(p)).toEqual([]);
    }
  });

  it('No: the code box is never written', () => {
    const p = { ...TRAVELLER, has_special_event_code: 'No', event_code: 'EV123' };
    expect(answer(p)).toBe('No');
    expect(
      buildMappingInputs(biz(), p).some((m) => m.targetField === '#codeIRCC_input'),
    ).toBe(false);
  });

  it('"yes" with no code given: Yes is written, the code is the applicant\'s', () => {
    for (const event_code of ['yes', true]) {
      const p = { ...TRAVELLER, attending_business_event: 'Yes', event_code };
      expect(answer(p)).toBe('Yes');
      expect(
        buildMappingInputs(biz(), p).some((m) => m.targetField === '#codeIRCC_input'),
      ).toBe(false);
      expect(left(p)).toEqual([
        expect.objectContaining({
          label: 'Special event code — the code',
          reason: 'not_in_profile',
        }),
      ]);
    }
  });

  it('an attendee who answered "no" to the event code has no code: No is written', () => {
    for (const event_code of [
      'no',
      'No.',
      'none',
      'N/A',
      "don't have one",
      'I do not have a code',
      false,
    ]) {
      const p = { ...TRAVELLER, attending_business_event: 'Yes', event_code };
      expect(answer(p)).toBe('No');
      expect(left(p)).toEqual([]);
      // and the registration note never calls "no" a code
      const docs = portalFillCoverage(biz(), p).pages.find(
        (x) => x.page === '/doc-upload',
      )!.left;
      const reg = docs.find((n) => n.label === 'Event registration')!;
      expect(reg.note).not.toMatch(/event code (no|none|n\/a|false)\b/i);
      expect(reg.note).toMatch(/if the organiser gave/);
    }
  });

  it('an explicit has_special_event_code wins over the code text', () => {
    expect(
      answer({ ...TRAVELLER, has_special_event_code: 'No', event_code: 'EV1' }),
    ).toBe('No');
    expect(
      answer({ ...TRAVELLER, has_special_event_code: 'Yes', event_code: 'no' }),
    ).toBe('Yes');
  });

  it("an event with no code stated is the applicant's answer", () => {
    const p = { ...TRAVELLER, attending_business_event: 'Yes' };
    expect(answer(p)).toBeUndefined();
    expect(left(p)).toEqual([
      expect.objectContaining({ reason: 'needs_your_answer' }),
    ]);
    expect(answer({ ...p, has_special_event_code: 'No' })).toBe('No');
  });

  it('the page is in the business page order after the invitation', () => {
    const pages = portalFillCoverage(biz(), TRAVELLER).pages.map((x) => x.page);
    expect(pages.indexOf('/special-event-code')).toBe(
      pages.indexOf('/inviter-info') + 1,
    );
  });
});

describe('business visitor — second inviter that is an organization (audit 2026-10-19)', () => {
  const SECOND = {
    ...TRAVELLER,
    has_second_inviter: 'Yes',
    second_inviter_name: 'Priya Raman',
    second_inviter_address: '200 Bay St, Toronto, ON M5J 2J2',
  };
  const orgWrite = (p: Record<string, unknown>, m = biz()) =>
    buildMappingInputs(m, p).find(
      (x) => x.targetField === '#nameOfOrgInviterTwo_input',
    )?.mappedValue;
  const orgNoted = (p: Record<string, unknown>, m = biz()) =>
    /organization or conference/.test(
      portalFillCoverage(m, p)
        .pages.find((x) => x.page === '/inviter-info')!
        .left.find((n) => n.label === 'Second inviter')?.note ?? '',
    );

  it('Organization: the name is typed into #nameOfOrgInviterTwo_input (live 2026-10-19)', () => {
    const p = {
      ...SECOND,
      second_inviter_relationship: 'Organization',
      second_inviter_organization_name: 'Northwind Logistics Ltd.',
    };
    expect(orgWrite(p)).toBe('Northwind Logistics Ltd.');
    expect(orgNoted(p)).toBe(false);
    // Same on the visitor route, which shares the second-inviter block.
    expect(orgWrite(p, base())).toBe('Northwind Logistics Ltd.');
  });

  it('Organization without a name: nothing typed, the name is noted', () => {
    const p = { ...SECOND, second_inviter_relationship: 'Organization' };
    expect(orgWrite(p)).toBeUndefined();
    expect(orgNoted(p)).toBe(true);
  });

  it('a person, or no second inviter: nothing typed or listed', () => {
    const friend = {
      ...SECOND,
      second_inviter_relationship: 'friend',
      second_inviter_organization_name: 'Northwind',
    };
    expect(orgWrite(friend)).toBeUndefined();
    expect(orgNoted(friend)).toBe(false);
    const none = {
      ...SECOND,
      has_second_inviter: 'No',
      second_inviter_relationship: 'Organization',
      second_inviter_organization_name: 'Northwind',
    };
    expect(orgWrite(none)).toBeUndefined();
    expect(orgNoted(none)).toBe(false);
  });

  it('intake asks the name only for an organization second inviter, only on this route', () => {
    const asked = (p: Record<string, unknown>, visaaiId = BIZ) =>
      missingIntakeFacts(p, { country: 'CA', visaaiId }).some(
        (f) => f.key === 'second_inviter_organization_name',
      );
    expect(
      asked({ ...SECOND, second_inviter_relationship: 'a company in Toronto' }),
    ).toBe(true);
    expect(
      asked({
        ...SECOND,
        second_inviter_relationship: 'Organization',
        second_inviter_organization_name: 'Northwind',
      }),
    ).toBe(false);
    expect(asked({ ...SECOND, second_inviter_relationship: 'friend' })).toBe(
      false,
    );
    expect(asked({ ...SECOND, second_inviter_relationship: undefined })).toBe(
      false,
    );
    expect(
      asked({
        ...SECOND,
        has_second_inviter: 'No',
        second_inviter_relationship: 'Organization',
      }),
    ).toBe(false);
    for (const route of [TRV, SV, ETA])
      expect(
        intakeFactSpecs({ country: 'CA', visaaiId: route }).some(
          (f) => f.key === 'second_inviter_organization_name',
        ),
      ).toBe(false);
  });
});
