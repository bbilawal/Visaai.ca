import type { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';
import type { SupabaseClient } from '@supabase/supabase-js';
import { lettersForRoute, requiredGenTypesForRoute } from '@visaai/types';
import {
  familyTiesDirective,
  makeDraftDocumentNode,
  routeDirective,
} from './draft-document';
import { makeLoadNarrativeDataNode } from './load-narrative-data';
import { makeSelfReviewNode } from './self-review';
import type { NarrativeState, NarrativeContext } from '../narrative.state';
import { VALID_DOC_TYPES } from '../../narrative.service';

/**
 * Letters for the Parent and Grandparent Super Visa (dry run 2026-10-16,
 * application 61f16bb5). The route is a registry visa type, so the legacy
 * `country_frameworks` join the letters read was empty: every letter was
 * drafted for "Visa: ( )" in a country with no name, the stay was given as a
 * 365-day visit, and there was no invitation letter at all — the one letter
 * IRCC makes mandatory for a super visa.
 */

const SUMERA: Record<string, unknown> = {
  full_name: 'Sumera Ahmad',
  purpose_of_visit: 'family visit',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2028-02-28',
  inviter_name: 'Mian Muhammad Bilawal',
  inviter_relationship: 'son',
  inviter_status: 'Canadian citizen',
  inviter_date_of_birth: '1992-05-01',
  inviter_address: '1202 Stirling Todd Terrace, Milton, ON L9E 2E2',
  host_household_members: [
    {
      name: 'Mian Muhammad Bilawal',
      date_of_birth: '1992-05-01',
      relationship_to_host: 'self',
    },
    {
      name: 'Sumera Ahmad',
      date_of_birth: '1968-10-09',
      relationship_to_host: 'mother',
    },
  ],
  host_annual_income_cad: 80000,
  host_income_tax_year: 2025,
  has_co_signer: false,
  has_super_visa_insurance: true,
  medical_insurance_provider: 'Manulife',
  medical_insurance_coverage_cad: 100000,
  medical_insurance_months: 12,
  medical_insurance_paid: 'paid in full',
  medical_exam_last_12_months: true,
  immigration_medical_exam_date: '2026-11-20',
};

function ctx(over: Partial<NarrativeContext> = {}): NarrativeContext {
  return {
    profile: SUMERA,
    vriScore: null,
    countryCode: 'CA',
    visaType: 'Super visa for parents and grandparents',
    purpose: '',
    visaaiId: 'ca-super-visa',
    stay: {
      entryDate: '2027-03-01',
      departureDate: '2028-02-28',
      days: 365,
      nights: 364,
    },
    ...over,
  };
}

function state(over: Partial<NarrativeState> = {}): NarrativeState {
  return {
    applicationId: 'app-1',
    docType: 'invitation_letter',
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

describe('which letters a route gets', () => {
  it('a super visa gets the host invitation letter first', () => {
    expect(lettersForRoute('ca-super-visa')).toEqual([
      'invitation_letter',
      'cover_letter',
      'loe',
      'itinerary',
    ]);
  });

  it('every other route keeps the three letters it had', () => {
    expect(lettersForRoute('ca-visitor-visa-temporary-resident-visa')).toEqual([
      'loe',
      'itinerary',
      'cover_letter',
    ]);
    expect(lettersForRoute(null)).toEqual(['loe', 'itinerary', 'cover_letter']);
  });

  it('the Generate stage needs the invitation letter approved on a super visa', () => {
    expect(
      requiredGenTypesForRoute({ country: 'CA', visaaiId: 'ca-super-visa' }),
    ).toEqual(['invitation_letter', 'loe', 'cover_letter']);
  });

  it('the API accepts an invitation letter', () => {
    expect(VALID_DOC_TYPES).toContain('invitation_letter');
  });
});

describe('loadNarrativeData — registry routes', () => {
  function db(
    app: Record<string, unknown>,
    profile: Record<string, unknown>,
    docs: unknown[] = [],
    verifs: unknown[] = [],
  ) {
    const chain = (data: unknown, list?: unknown[]) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.single = () => Promise.resolve({ data, error: null });
      c.then = (res: (v: unknown) => unknown) =>
        res({ data: list ?? [], error: null });
      return c;
    };
    return {
      from: (table: string) =>
        table === 'applications'
          ? chain(app)
          : table === 'documents'
            ? chain(null, docs)
            : table === 'document_verifications'
              ? chain(null, verifs)
              : chain({ profile_json: profile }),
    } as unknown as SupabaseClient;
  }

  it("reads the applicant's own passport and the uploaded policy into the context", async () => {
    const node = makeLoadNarrativeDataNode(
      db(
        {
          vri_score: null,
          destination_country: 'CA',
          visa_types: {
            visaai_id: 'ca-super-visa',
            official_name: 'Super visa',
          },
        },
        {
          full_name: 'MIAN MUHAMMAD',
          passport_number: 'AL1183581',
          planned_entry_date: '2027-03-01',
          planned_departure_date: '2028-02-28',
        },
        [
          { id: 'd1', document_type: 'passport' },
          { id: 'd2', document_type: 'medical_insurance' },
        ],
        [
          {
            document_id: 'd1',
            verification_type: 'identity',
            result: 'pass',
            details_json: {
              extracted_fields: {
                full_name: 'SUMERA AHMAD',
                passport_number: 'AL1183581',
              },
            },
          },
          {
            document_id: 'd2',
            verification_type: 'identity',
            result: 'pass',
            details_json: {
              extracted_fields: {
                insurer_name: '21st Century',
                coverage_start_date: 'Jun-01-2025',
                expiry_date: 'May-31-2026',
              },
            },
          },
        ],
      ),
    );
    const out = await node({ applicationId: 'app-1' } as NarrativeState);
    expect(out.context?.evidence?.applicantName).toBe('Sumera Ahmad');
    expect(out.context?.evidence?.insurance?.coversStay).toBe(false);
  });

  it('names the registry visa and country instead of an empty framework', async () => {
    const node = makeLoadNarrativeDataNode(
      db(
        {
          vri_score: null,
          destination_country: 'CA',
          country_frameworks: null,
          visa_types: {
            visaai_id: 'ca-super-visa',
            official_name: 'Super visa for parents and grandparents',
          },
        },
        SUMERA,
      ),
    );
    const out = await node({ applicationId: 'app-1' } as NarrativeState);
    expect(out.context).toMatchObject({
      countryCode: 'CA',
      visaType: 'Super visa for parents and grandparents',
      visaaiId: 'ca-super-visa',
    });
  });

  it('still reads a legacy framework application', async () => {
    const node = makeLoadNarrativeDataNode(
      db(
        {
          vri_score: 70,
          destination_country: null,
          country_frameworks: {
            country_code: 'CA',
            visa_type: 'visitor',
            purpose: 'family',
          },
          visa_types: null,
        },
        {},
      ),
    );
    const out = await node({ applicationId: 'app-1' } as NarrativeState);
    expect(out.context).toMatchObject({
      countryCode: 'CA',
      visaType: 'visitor',
      purpose: 'family',
      visaaiId: null,
    });
  });
});

describe('super visa letter prompts', () => {
  it('the invitation letter is written by the host, in the first person', async () => {
    const text = await prompt();
    expect(text).toMatch(/written BY THE HOST/);
    expect(text).toContain('Mian Muhammad Bilawal');
    expect(text).toMatch(/financial support for the whole stay/i);
    expect(text).toMatch(/name and date of birth/i);
    expect(text).toMatch(/copy of .*(citizenship|status)/i);
  });

  it('hands the model the household and the income test as computed facts', async () => {
    const text = await prompt();
    expect(text).toMatch(/family size: 2/i);
    expect(text).toContain('CAD 38,002');
    expect(text).toContain('CAD 80,000');
    expect(text).toMatch(/2025 tax year/);
    expect(text).toMatch(/meets/i);
  });

  it('states the insurance and the medical exam', async () => {
    const text = await prompt({ docType: 'cover_letter' });
    expect(text).toContain('Manulife');
    expect(text).toContain('CAD 100,000');
    expect(text).toMatch(/12 months/);
    expect(text).toContain('2026-11-20');
  });

  it('describes a 12-month stay in months and forbids the TRV day-count framing', async () => {
    const text = await prompt({ docType: 'loe' });
    expect(text).toMatch(/12 months/);
    expect(text).toMatch(/up to 5 years per entry/i);
    expect(text).toMatch(
      /never describe (it|the stay) as a visit of 365 days/i,
    );
    expect(text).not.toMatch(/use exactly 365 days/);
  });

  it('a short TRV visit keeps the day count and gets no super visa text', () => {
    const trv = ctx({
      visaaiId: 'ca-visitor-visa-temporary-resident-visa',
      visaType: 'Visitor visa',
      profile: { purpose_of_visit: 'tourism' },
      stay: {
        entryDate: '2026-12-01',
        departureDate: '2027-01-31',
        days: 62,
        nights: 61,
      },
    });
    expect(routeDirective(trv, 'loe')).toBe('');
  });

  it('warns the writer when the income does not meet the minimum, rather than claiming it does', () => {
    const short = ctx({
      profile: {
        ...SUMERA,
        host_household_members: Array.from({ length: 7 }, (_, i) => ({
          name: `p${i}`,
          date_of_birth: '2000-01-01',
        })),
        has_co_signer: true,
        co_signer_relationship: 'brother',
        co_signer_annual_income_cad: 104544,
      },
    });
    const text = routeDirective(short, 'invitation_letter');
    expect(text).toMatch(/does NOT meet/);
    expect(text).toMatch(/only the host's spouse or common-law partner/i);
    expect(text).toMatch(/never claim/i);
  });

  it('the reviewer checks the same super visa facts', async () => {
    const seen: BaseMessage[][] = [];
    await makeSelfReviewNode(llm('{"approved": true, "critique": ""}', seen))(
      state({ draft: 'Dear Officer,' }),
    );
    const text = seen[0].map((m) => m.text).join('\n');
    expect(text).toContain('CAD 38,002');
    expect(text).toMatch(/written BY THE HOST/);
  });

  it('names the application a super visa, never a "Temporary Resident Visa application"', async () => {
    const text = await prompt({ docType: 'loe' });
    expect(text).toMatch(/Parent and Grandparent Super Visa application/);
    expect(text).toMatch(/do not title it .*Temporary Resident Visa/i);
  });

  it('the uploaded policy outranks the declared insurance', () => {
    const c = ctx({
      evidence: {
        applicantName: 'Sumera Ahmad',
        stay: { entryDate: '2027-03-01', departureDate: '2028-02-28' },
        insurance: {
          insurer: '21st Century TRAVEL INSURANCE LIMITED',
          policyNumber: '11460162V-A',
          coverageAmount: 100000,
          start: '2025-06-01',
          end: '2026-05-31',
          coversStay: false,
        },
      },
    });
    const text = routeDirective(c, 'loe');
    expect(text).not.toContain('Manulife');
    expect(text).toMatch(/does not cover the planned stay/i);
  });

  it('a medical exam with no date is not described as done', () => {
    const c = ctx({
      profile: {
        ...SUMERA,
        medical_exam_last_12_months: undefined,
        immigration_medical_exam_date: undefined,
      },
    });
    expect(routeDirective(c, 'loe')).toMatch(/not recorded as done/);
  });

  it('a long-stay itinerary is short and factual, not padded', async () => {
    const text = await prompt({ docType: 'itinerary' });
    expect(text).toMatch(/arrival, accommodation, purpose and departure/i);
    expect(text).toMatch(/no filler/i);
  });

  it('the evidence block reaches the writer', async () => {
    const text = await prompt({
      docType: 'loe',
      context: ctx({
        evidence: {
          applicantName: 'Sumera Ahmad',
          stay: { entryDate: '2027-03-01', departureDate: '2028-02-28' },
          insurance: null,
        },
      }),
    });
    expect(text).toContain('exactly as "Sumera Ahmad"');
  });
});

describe('letter of explanation — family refusals', () => {
  it("never turns a relative's refusal into the applicant's", async () => {
    const text = await prompt({
      docType: 'loe',
      context: ctx({ visaaiId: 'ca-visitor-visa-temporary-resident-visa' }),
    });
    expect(text).toMatch(/refusal of a family member/i);
  });
});

describe('letter of explanation — family ties', () => {
  // Prod 2026-10-16 21:35Z: the LOE said "my son, Mian Talha, also lives with
  // me there". Intake: Talha "lives in Pakistan with his wife and child"
  // (in_home_country: true) — in the home country is not at the applicant's
  // address.
  const TALHA = {
    name: 'Mian Talha',
    relationship: 'son',
    in_home_country: true,
    country_of_residence: 'Pakistan',
  };
  const BILAWAL = {
    name: 'Mian Muhammad Bilawal',
    relationship: 'son',
    in_home_country: false,
    country_of_residence: 'Canada',
  };

  it('states where each child lives and forbids "lives with me" without it', () => {
    const text = familyTiesDirective(
      ctx({ profile: { ...SUMERA, children: [TALHA, BILAWAL] } }),
      'loe',
    );
    expect(text).toMatch(/Mian Talha \(son\): lives in Pakistan/);
    expect(text).toMatch(/does not say .*lives? with the applicant/i);
    expect(text).toMatch(/Mian Muhammad Bilawal \(son\): lives in Canada/);
  });

  it('says a child lives with the applicant only when the profile does', () => {
    const text = familyTiesDirective(
      ctx({
        profile: { ...SUMERA, children: [{ ...TALHA, same_address: true }] },
      }),
      'loe',
    );
    expect(text).toMatch(/Mian Talha \(son\): lives with the applicant/);
    expect(text).not.toMatch(/does not say/);
  });

  it('reaches the LOE prompt, and only the LOE', async () => {
    const profile = { ...SUMERA, children: [TALHA] };
    const loe = await prompt({ docType: 'loe', context: ctx({ profile }) });
    expect(loe).toMatch(/FAMILY TIES/);
    expect(familyTiesDirective(ctx({ profile }), 'itinerary')).toBe('');
  });

  it('says nothing without children', () => {
    expect(familyTiesDirective(ctx(), 'loe')).toBe('');
  });
});
