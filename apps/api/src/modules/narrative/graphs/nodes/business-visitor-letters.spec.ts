import type { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';
import { lettersForRoute, requiredGenTypesForRoute } from '@visaai/types';
import {
  docInstruction,
  makeDraftDocumentNode,
  routeDirective,
  visaLine,
} from './draft-document';
import { makeSelfReviewNode } from './self-review';
import type {
  NarrativeState,
  NarrativeContext,
  DocType,
} from '../narrative.state';
import {
  azureQueryFieldsFor,
  extractionFieldsFor,
} from '../../../documents/ocr/extraction-schema';
import {
  isInvitationLetter,
  routeInvitingOrganization,
} from '../../../documents/graphs/nodes/sync-profile';

/**
 * Letters for Canada's business visitor route (registry `ca-business-visitors`).
 * The route had no letter configuration, so the letters were the generic
 * visitor ones: the visa was named "Business visitors" (the registry page
 * title), nothing said the applicant's pay stays outside Canada, and the
 * invitation letter brief was a relative's ("I, <host>, invite my mother").
 */

const AMIR: Record<string, unknown> = {
  full_name: 'Amir Khan',
  employer_name: 'Lahore Textiles Ltd',
  business_activity: 'meetings to negotiate a supply contract',
  canadian_business_name: 'Maple Fabrics Inc.',
  attending_business_event: 'yes',
  event_code: 'EVT-2027-0042',
  inviter_name: 'Jane Doe',
  inviter_address: '100 King St W, Toronto, ON M5X 1A9',
  inviter_phone: '+1 416 555 0100',
  inviter_email: 'jane.doe@maplefabrics.ca',
  paid_by_canadian_source: 'no',
  trip_expenses_paid_by: 'my employer, Lahore Textiles Ltd',
};

function ctx(over: Partial<NarrativeContext> = {}): NarrativeContext {
  return {
    profile: AMIR,
    vriScore: null,
    countryCode: 'CA',
    visaType: 'Business visitors',
    purpose: '',
    visaaiId: 'ca-business-visitors',
    stay: {
      entryDate: '2027-04-10',
      departureDate: '2027-04-20',
      days: 11,
      nights: 10,
    },
    ...over,
  };
}

function state(over: Partial<NarrativeState> = {}): NarrativeState {
  return {
    applicationId: 'app-1',
    docType: 'loe',
    context: ctx(),
    draft: '',
    critique: '',
    approved: false,
    needsHumanReview: false,
    revisionCount: 0,
    generatedDocumentId: null,
    ...over,
  };
}

function llm(content: string, seen: BaseMessage[][] = []): ChatOpenAI {
  return {
    invoke: (msgs: BaseMessage[]) => {
      seen.push(msgs);
      return Promise.resolve({ content });
    },
  } as unknown as ChatOpenAI;
}

async function prompt(over: Partial<NarrativeState> = {}): Promise<string> {
  const seen: BaseMessage[][] = [];
  await makeDraftDocumentNode(llm('Dear Officer,', seen))(state(over));
  return seen[0].map((m) => m.text).join('\n');
}

describe('which letters the business visitor route gets', () => {
  it('offers the company invitation letter, requires the LOE and cover letter', () => {
    expect(lettersForRoute('ca-business-visitors')).toEqual([
      'loe',
      'cover_letter',
      'invitation_letter',
      'itinerary',
    ]);
    expect(
      requiredGenTypesForRoute({
        country: 'CA',
        visaaiId: 'ca-business-visitors',
      }),
    ).toEqual(['loe', 'cover_letter']);
  });
});

describe('business visitor letter prompts', () => {
  it('names the visa a Temporary Resident Visa (business visitor)', async () => {
    expect(visaLine(ctx())).toContain(
      'Visa: Temporary Resident Visa (business visitor).',
    );
    const text = await prompt();
    expect(text).not.toMatch(/Visa: Business visitors/);
  });

  it('the LOE states the activity, company, event, payer and that pay stays outside Canada', async () => {
    const text = await prompt({ docType: 'loe' });
    expect(text).toContain('meetings to negotiate a supply contract');
    expect(text).toContain('Maple Fabrics Inc.');
    expect(text).toContain('EVT-2027-0042');
    expect(text).toContain('my employer, Lahore Textiles Ltd');
    expect(text).toMatch(/not entering the Canadian labour market/);
    expect(text).toMatch(/stay paid by their employer, Lahore Textiles Ltd/);
    expect(text).toMatch(/ties .* bring them home/);
  });

  it('the cover letter lists the business documents', async () => {
    const text = await prompt({ docType: 'cover_letter' });
    expect(text).toMatch(/Canadian company's letter of invitation/);
    expect(text).toMatch(
      /letter of support from the applicant's employer \(or parent company\)/,
    );
    expect(text).toMatch(/event registration/);
    expect(text).toMatch(/warranty contract/);
  });

  it("the invitation letter is the company's, never a family letter", async () => {
    const text = await prompt({ docType: 'invitation_letter' });
    expect(text).toMatch(/BY THE CANADIAN COMPANY OR ORGANIZATION/);
    expect(text).toMatch(/never write in a family or personal voice/);
    expect(text).toContain('Jane Doe');
    expect(text).toContain('100 King St W, Toronto, ON M5X 1A9');
    expect(text).toContain('jane.doe@maplefabrics.ca');
    expect(text).not.toMatch(/invite my mother/);
    expect(text).not.toMatch(/written BY THE HOST/);
  });

  it('the LOE says pay stays outside Canada only when the applicant said no Canadian pays', () => {
    const no = routeDirective(ctx(), 'loe');
    expect(no).toMatch(/not entering the Canadian labour market/);

    const yes = routeDirective(
      ctx({ profile: { ...AMIR, paid_by_canadian_source: 'yes' } }),
      'loe',
    );
    expect(yes).not.toMatch(/not entering the Canadian labour market/);
    expect(yes).not.toMatch(/they stay paid by/);

    const { paid_by_canadian_source: _drop, ...rest } = AMIR;
    void _drop;
    const unknown = routeDirective(ctx({ profile: rest }), 'loe');
    expect(unknown).not.toMatch(/not entering the Canadian labour market/);
    expect(unknown).not.toMatch(/they stay paid by/);
    expect(unknown).toMatch(/is not recorded: never claim either way/);
  });

  it('the cover letter mentions the payroll only if the employer letter says so', () => {
    expect(routeDirective(ctx(), 'cover_letter')).toMatch(
      /if the letter says so, that they remain on its payroll/,
    );
  });

  it('flags a Canadian payer instead of claiming pay stays outside Canada', () => {
    const text = routeDirective(
      ctx({ profile: { ...AMIR, paid_by_canadian_source: 'yes' } }),
      'loe',
    );
    expect(text).toMatch(/Never claim their pay stays outside Canada/);
    expect(text).not.toMatch(/No Canadian company or person pays/);
  });

  it('never quotes an event code the applicant said they do not have', () => {
    const text = routeDirective(
      ctx({ profile: { ...AMIR, event_code: 'no' } }),
      'loe',
    );
    expect(text).toMatch(/no IRCC event code is recorded/);
  });

  it('reads the intake aliases on an older profile', () => {
    const text = routeDirective(
      ctx({
        profile: {
          business_purpose: 'after-sales service',
          canadian_company_name: 'Northern Pumps Ltd',
          host_name: 'Sam Lee',
          company_address: '1 Main St, Calgary, AB',
        },
      }),
      'loe',
    );
    expect(text).toContain('after-sales service');
    expect(text).toContain('Northern Pumps Ltd, 1 Main St, Calgary, AB');
    expect(text).toContain('Sam Lee');
  });

  it('the reviewer checks the same business rules', async () => {
    const seen: BaseMessage[][] = [];
    await makeSelfReviewNode(llm('{"approved": true, "critique": ""}', seen))(
      state({ docType: 'invitation_letter', draft: 'Dear Officer,' }),
    );
    const text = seen[0].map((m) => m.text).join('\n');
    expect(text).toMatch(/BUSINESS VISITOR/);
    expect(text).toMatch(/never in a family voice/);
  });
});

describe('other routes are unchanged', () => {
  const DOCS: DocType[] = [
    'loe',
    'cover_letter',
    'invitation_letter',
    'itinerary',
  ];

  it('a TRV gets no route directive and keeps its own visa name and family-host brief', () => {
    const trv = ctx({
      visaaiId: 'ca-visitor-visa-temporary-resident-visa',
      visaType: 'Visitor visa',
      profile: { ...AMIR, purpose_of_visit: 'tourism' },
    });
    for (const d of DOCS) expect(routeDirective(trv, d)).toBe('');
    expect(visaLine(trv)).toContain('Visa: Visitor visa.');
    expect(docInstruction(trv, 'invitation_letter')).toMatch(
      /written BY THE HOST/,
    );
  });

  it('a super visa keeps its own directive', () => {
    const sv = ctx({
      visaaiId: 'ca-super-visa',
      visaType: 'Super visa for parents and grandparents',
      profile: { inviter_name: 'Mian Muhammad Bilawal' },
    });
    for (const d of DOCS) {
      const text = routeDirective(sv, d);
      expect(text).toMatch(/^\n\nSUPER VISA/);
      expect(text).not.toMatch(/BUSINESS VISITOR/);
    }
    expect(visaLine(sv)).toContain(
      'Visa: Super visa for parents and grandparents.',
    );
    expect(docInstruction(sv, 'invitation_letter')).toMatch(
      /written BY THE HOST/,
    );
  });

  it('an eTA gets no route directive', () => {
    const eta = ctx({
      visaaiId: 'ca-electronic-travel-authorization-eta',
      visaType: 'Electronic travel authorization (eTA)',
    });
    for (const d of DOCS) expect(routeDirective(eta, d)).toBe('');
    expect(visaLine(eta)).toContain(
      'Visa: Electronic travel authorization (eTA).',
    );
  });
});

describe('the invitation letter extraction reads a company letter', () => {
  it('asks for the organization and contact fields', () => {
    const keys = extractionFieldsFor('invitation_letter').map((f) => f.key);
    for (const k of [
      'host_name',
      'organization_name',
      'contact_name',
      'contact_phone',
      'contact_email',
      'organization_address',
      'event_code',
    ]) {
      expect(keys).toContain(k);
    }
    expect(azureQueryFieldsFor('invitation_letter').names).toContain(
      'OrganizationName',
    );
  });

  const BIZ = {
    id: 'doc-inv',
    type: 'invitation_letter',
    visaaiId: 'ca-business-visitors',
  };
  const COMPANY_LETTER = {
    organization_name: 'Maple Fabrics Inc.',
    contact_name: 'Jane Doe',
    contact_phone: '+1 416 555 0100',
    contact_email: 'jane.doe@maplefabrics.ca',
    organization_address: '100 King St W, Toronto, ON',
    event_code: 'EVT-2027-0042',
  };

  it('maps a company letter onto the business intake keys, gap-fill only, with provenance', () => {
    const profile: Record<string, unknown> = { inviter_email: 'typed@x.ca' };
    const filled = routeInvitingOrganization(profile, COMPANY_LETTER, BIZ);
    expect(profile).toMatchObject({
      canadian_business_name: 'Maple Fabrics Inc.',
      inviter_name: 'Jane Doe',
      inviter_phone: '+1 416 555 0100',
      inviter_email: 'typed@x.ca',
      inviter_address: '100 King St W, Toronto, ON',
      event_code: 'EVT-2027-0042',
    });
    expect(filled).not.toContain('inviter_email');
    const sources = profile._document_sources as Record<
      string,
      { document_id: string; value: unknown }
    >;
    expect(sources.inviter_name).toMatchObject({
      document_id: 'doc-inv',
      value: 'Jane Doe',
    });
    expect(sources.inviter_email).toBeUndefined();
  });

  it('a re-read of the same letter can correct the value it wrote', () => {
    const profile: Record<string, unknown> = {};
    routeInvitingOrganization(profile, COMPANY_LETTER, BIZ);
    routeInvitingOrganization(
      profile,
      { ...COMPANY_LETTER, contact_name: 'Janet Doe' },
      BIZ,
    );
    expect(profile.inviter_name).toBe('Janet Doe');
  });

  it('never runs on another route (a TRV or super visa host stays the host)', () => {
    for (const visaaiId of [
      'ca-visitor-visa-temporary-resident-visa',
      'ca-super-visa',
      null,
    ]) {
      const profile: Record<string, unknown> = { host_name: 'Real Host' };
      expect(
        routeInvitingOrganization(profile, COMPANY_LETTER, {
          ...BIZ,
          visaaiId,
        }),
      ).toEqual([]);
      expect(profile).toEqual({ host_name: 'Real Host' });
    }
  });

  it('any alias of the inviter, or an inviter object, counts as answered', () => {
    const aliased: Record<string, unknown> = {
      host_name: 'Sam Lee',
      family_member_name: 'x',
      company_address: '1 Main St',
    };
    const filled = routeInvitingOrganization(aliased, COMPANY_LETTER, BIZ);
    expect(filled).not.toContain('inviter_name');
    expect(filled).not.toContain('inviter_address');
    expect(filled).toContain('canadian_business_name');

    const withObject: Record<string, unknown> = {
      inviter: { name: 'Sam Lee' },
    };
    const f2 = routeInvitingOrganization(withObject, COMPANY_LETTER, BIZ);
    expect(f2).toEqual(['canadian_business_name', 'event_code']);
  });

  it('a company letter read as host_* maps the signatory as the contact', () => {
    const profile: Record<string, unknown> = {};
    routeInvitingOrganization(
      profile,
      {
        organization_name: 'Maple Fabrics Inc.',
        host_name: 'Jane Doe',
        host_address: '100 King St W, Toronto, ON',
      },
      BIZ,
    );
    expect(profile).toMatchObject({
      canadian_business_name: 'Maple Fabrics Inc.',
      inviter_name: 'Jane Doe',
      inviter_address: '100 King St W, Toronto, ON',
    });
  });

  it('leaves a family letter (a person host, or no organization) alone', () => {
    for (const letter of [
      {
        host_name: 'Mian Muhammad Bilawal',
        host_relationship: 'son',
        organization_name: 'Acme Payroll Ltd',
      },
      {
        host_name: 'Mian Muhammad Bilawal',
        host_status: 'Canadian citizen',
        organization_name: 'X',
      },
      { host_name: 'Mian Muhammad Bilawal', contact_name: 'Someone' },
    ]) {
      const profile: Record<string, unknown> = {};
      expect(routeInvitingOrganization(profile, letter, BIZ)).toEqual([]);
      expect(profile).toEqual({});
    }
  });

  it('recognises an invitation letter by its type or its slot', () => {
    expect(isInvitationLetter('invitation_letter', null)).toBe(true);
    expect(
      isInvitationLetter('document', {
        slotType: 'letter_of_invitation_from_canadian_company',
        owner: null,
        familyGap: false,
      }),
    ).toBe(true);
    expect(isInvitationLetter('passport', null)).toBe(false);
  });
});
