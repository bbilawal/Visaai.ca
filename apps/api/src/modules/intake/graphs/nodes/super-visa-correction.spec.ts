import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isIntakeAnswered } from '@visaai/types';
import { makeProcessAnswerNode } from './process-answer';
import { makeUpdateProfileNode } from './update-profile';
import type { IntakeState } from '../intake.state';
import { SUPER_VISA_PROFILE_61F16BB5 } from '../../../../../test/fixtures/super-visa-profile-61f16bb5';

/**
 * Dry run 2026-10-16 20:02Z (super visa, application 61f16bb5): after the
 * intake was complete, the applicant sent the correction below. The reply was
 * "No changes were recorded from this message." and the profile row was
 * rewritten unchanged — no host income, no household, no insurance, no medical
 * exam, and Mian Talha kept `birth_year: 2000` with no date of birth.
 *
 * Replaying that prompt against the production model (gpt-5.6-luna, 4 runs)
 * always returned well-formed facts, and the graph records well-formed facts
 * (asserted below). What the extractor did with the reply is the weak link: a
 * reply that is not ONE bare JSON object (a code fence followed by a note with
 * braces, a trailing comma) was parsed as `{}` without a word in the logs. The
 * extractor now asks the API for JSON mode and parses tolerantly.
 */

const MESSAGE =
  "Additional details: My host son Mian Muhammad Bilawal's 2025 total income (CRA line 15000) is CAD 80,000. His household is 4 people: Mian Muhammad Bilawal (1989-10-14), his wife Farhana Choudhry (1993-09-02), their daughter Ayat Bilawal (2025-07-10), and me Sumera Ahmad (1968-10-09). I have super visa medical insurance from a Canadian insurer, policy SV-DUMMY-2027-001, CAD 100,000 coverage, March 1, 2027 to March 1, 2028, paid in full. I completed my upfront immigration medical exam on October 10, 2026 in Islamabad. I have about CAD 5,000 of my own savings. My husband owns our family home at 138 Millat Colony, Rawalpindi. My son Mian Talha was born on 2000-05-20.";

/** What gpt-5.6-luna returned for this message with this branch's prompt (live replay). */
const LIVE_EXTRACTION = JSON.stringify({
  inviter_name: 'Mian Muhammad Bilawal',
  host_annual_income_cad: 80000,
  host_income_tax_year: 2025,
  host_household_members: [
    {
      name: 'Mian Muhammad Bilawal',
      date_of_birth: '1989-10-14',
      relationship_to_host: 'self',
    },
    {
      name: 'Farhana Choudhry',
      date_of_birth: '1993-09-02',
      relationship_to_host: 'wife',
    },
    {
      name: 'Ayat Bilawal',
      date_of_birth: '2025-07-10',
      relationship_to_host: 'daughter',
    },
    {
      name: 'Sumera Ahmad',
      date_of_birth: '1968-10-09',
      relationship_to_host: 'parent',
    },
  ],
  has_super_visa_insurance: true,
  medical_insurance_provider: 'Canadian insurer',
  medical_insurance_coverage_cad: 100000,
  medical_insurance_months: 12,
  medical_insurance_paid: 'paid in full',
  immigration_medical_exam_date: '2026-10-10',
  available_funds: 5000,
  funds_currency: 'CAD',
  has_property: true,
  children: [
    {
      name: 'Mian Talha',
      relationship: 'son',
      sex: 'Male',
      date_of_birth: '2000-05-20',
      in_home_country: true,
      country_of_residence: 'Pakistan',
    },
  ],
});

function state(): IntakeState {
  return {
    applicationId: 'app-1',
    visaTypeId: 'vt-super',
    frameworkId: null,
    destinationCountry: 'CA',
    destinationState: null,
    requirementsJson: { visaai_id: 'ca-super-visa' },
    profileJson: { ...SUPER_VISA_PROFILE_61F16BB5 },
    riskIndicators: [],
    checklistItems: [],
    suggestedVisaTypes: [],
    messages: [
      new AIMessage(
        'You can keep correcting answers here, or continue to your documents.',
      ),
      new HumanMessage(MESSAGE),
    ],
    isComplete: true,
    currentQuestion:
      'You can keep correcting answers here, or continue to your documents.',
    checklistBuiltAt: null,
    profileChanges: [],
  };
}

function llm(reply: string, seen: { prompt?: string; options?: unknown } = {}) {
  return {
    invoke: (messages: Array<{ content: string }>, options?: unknown) => {
      seen.prompt = messages.map((m) => m.content).join('\n');
      seen.options = options;
      return Promise.resolve({ content: reply });
    },
  } as unknown as ChatOpenAI;
}

/** A profile row that update_profile reads and writes back. */
function rowDb(profile: Record<string, unknown>) {
  const written: Array<Record<string, unknown>> = [];
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.maybeSingle = () =>
    Promise.resolve({ data: { profile_json: profile }, error: null });
  c.upsert = (row: { profile_json: Record<string, unknown> }) => {
    written.push(row.profile_json);
    return Promise.resolve({ error: null });
  };
  return { db: { from: () => c } as unknown as SupabaseClient, written };
}

async function record(reply: string) {
  const s = state();
  const out = await makeProcessAnswerNode(llm(reply))(s);
  const { db, written } = rowDb(SUPER_VISA_PROFILE_61F16BB5);
  await makeUpdateProfileNode(db)({
    ...s,
    profileJson: { ...s.profileJson, ...out.profileJson },
  });
  return { out, row: written[0] };
}

describe('post-completion correction with the super visa facts (dry run 2026-10-16)', () => {
  it('tells the extractor the super visa keys and asks for JSON mode', async () => {
    const seen: { prompt?: string; options?: unknown } = {};
    await makeProcessAnswerNode(llm(LIVE_EXTRACTION, seen))(state());
    for (const key of [
      'host_annual_income_cad',
      'host_income_tax_year',
      'host_household_members',
      'has_super_visa_insurance',
      'immigration_medical_exam_date',
      'available_funds',
    ])
      expect(seen.prompt).toContain(key);
    expect(seen.prompt).toContain('SV-DUMMY-2027-001');
    expect(seen.options).toEqual({ response_format: { type: 'json_object' } });
  });

  it('records every new super visa fact on the row and reports them as changes', async () => {
    const { out, row } = await record(LIVE_EXTRACTION);
    expect(row).toMatchObject({
      host_annual_income_cad: 80000,
      host_income_tax_year: 2025,
      has_super_visa_insurance: true,
      medical_insurance_coverage_cad: 100000,
      medical_insurance_months: 12,
      immigration_medical_exam_date: '2026-10-10',
      available_funds: 5000,
      has_property: true,
    });
    expect(row.host_household_members).toHaveLength(4);
    const keys = (out.profileChanges ?? []).map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'host_annual_income_cad',
        'host_household_members',
        'immigration_medical_exam_date',
        'children',
      ]),
    );
  });

  it("records Mian Talha's date of birth on the existing child, without a duplicate", async () => {
    const { row } = await record(LIVE_EXTRACTION);
    const talha = (row.children as Array<Record<string, unknown>>).filter(
      (c) => c.name === 'Mian Talha',
    );
    expect(talha).toHaveLength(1);
    expect(talha[0].date_of_birth).toBe('2000-05-20');
  });

  it('a medical exam done on a date answers "exam in the last 12 months" yes', async () => {
    const { row } = await record(LIVE_EXTRACTION);
    expect(row.medical_exam_last_12_months).toBe(true);
  });

  it('the interview resumes for what is still missing instead of claiming nothing changed', async () => {
    const { row } = await record(LIVE_EXTRACTION);
    // The dry-run applicant still owes the inviter status, DOB, address and
    // the family-at-home tie — so the interview resumes and asks for those,
    // rather than saying nothing changed.
    expect(
      isIntakeAnswered(row, { country: 'CA', visaaiId: 'ca-super-visa' }),
    ).toBe(false);
  });

  it('still records the facts when the reply is fenced and followed by a note with braces', async () => {
    const reply =
      '```json\n' +
      LIVE_EXTRACTION +
      '\n```\nNote: values like {amount} are in CAD.';
    const { row } = await record(reply);
    expect(row.host_annual_income_cad).toBe(80000);
  });

  it('still records the facts when the JSON carries a trailing comma', async () => {
    const reply = LIVE_EXTRACTION.replace(/\}$/, ',}');
    const { row } = await record(reply);
    expect(row.host_annual_income_cad).toBe(80000);
  });

  it("puts the host's wife and daughter in the household, not in the applicant's children", async () => {
    const seen: { prompt?: string } = {};
    await makeProcessAnswerNode(llm(LIVE_EXTRACTION, seen))(state());
    expect(seen.prompt).toMatch(
      /HOST's household is not the applicant's children[\s\S]*host_household_members/,
    );
  });
});
