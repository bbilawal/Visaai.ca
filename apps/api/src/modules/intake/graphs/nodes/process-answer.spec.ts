import { makeProcessAnswerNode } from './process-answer';
import type { IntakeState } from '../intake.state';
import { HumanMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';

/**
 * The extractor invented a fresh key on every turn, so a correction never landed
 * on the fact it corrected.
 *
 * Observed on a live application 2026-09-04: the applicant gave an impossible
 * departure date, was asked to correct it, did so twice, and the profile kept
 * BOTH `departure_date: "May 2026"` and `intended_departure_date: "2027-05-01"`
 * — plus four keys for one household income, two of them labelled _usd for an
 * amount given in CAD. Prefill reads one key and cannot know it is reading a
 * superseded answer.
 */

function makeLlm(capture: { prompt?: string }, reply: string) {
  return {
    invoke: (messages: Array<{ content: string }>) => {
      capture.prompt = messages[messages.length - 1]?.content ?? '';
      return Promise.resolve({ content: reply });
    },
  } as unknown as ChatOpenAI;
}

const BASE: IntakeState = {
  applicationId: 'app-1',
  visaTypeId: null,
  frameworkId: null,
  destinationCountry: 'CA',
  destinationState: null,
  requirementsJson: {},
  profileJson: { departure_date: 'May 2026', annual_income_cad: 150000 },
  riskIndicators: [],
  checklistItems: [],
  suggestedVisaTypes: [],
  messages: [new HumanMessage('may 2027 departure from canada')],
  isComplete: false,
  currentQuestion: 'What is the correct departure date?',
  checklistBuiltAt: null,
  profileChanges: [],
};

describe('processAnswer — corrections land on the fact they correct', () => {
  it('shows the extractor the facts already recorded, with their values', async () => {
    // Values, not just key names: correcting "May 2026" requires seeing that it
    // currently says May 2026.
    const capture: { prompt?: string } = {};
    const node = makeProcessAnswerNode(
      makeLlm(capture, '{"departure_date": "2027-05-01"}'),
    );

    await node(BASE);

    expect(capture.prompt).toContain('departure_date');
    expect(capture.prompt).toContain('May 2026');
    expect(capture.prompt).toContain('annual_income_cad');
  });

  it('overwrites the existing key rather than adding a variant', async () => {
    const capture: { prompt?: string } = {};
    const node = makeProcessAnswerNode(
      makeLlm(capture, '{"departure_date": "2027-05-01"}'),
    );

    const out = await node(BASE);

    // The reducer merges update over existing, so emitting the SAME key is what
    // makes the correction win.
    expect(out.profileJson).toEqual({ departure_date: '2027-05-01' });
  });

  it('says nothing about facts when none are recorded yet', async () => {
    const capture: { prompt?: string } = {};
    const node = makeProcessAnswerNode(makeLlm(capture, '{}'));

    await node({ ...BASE, profileJson: {} });

    expect(capture.prompt).toContain('nothing recorded yet');
  });

  it('caps a long profile so it cannot crowd out the answer being extracted', async () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 400; i++) big[`fact_${i}`] = `value_${i}`;
    const capture: { prompt?: string } = {};
    const node = makeProcessAnswerNode(makeLlm(capture, '{}'));

    await node({ ...BASE, profileJson: big });

    expect(capture.prompt).toContain('more not shown');
    expect(capture.prompt!.length).toBeLessThan(6000);
  });
});

describe('processAnswer — official-form facts and family members', () => {
  const TRV = {
    ...BASE,
    visaTypeId: 'vt-trv',
    requirementsJson: { visaai_id: 'ca-visitor-visa-temporary-resident-visa' },
  };

  it('tells the extractor the canonical key for each IMM 5257 question (#50)', async () => {
    const capture: { prompt?: string } = {};
    await makeProcessAnswerNode(makeLlm(capture, '{}'))(TRV);
    for (const key of [
      'passport_type',
      'us_permanent_resident',
      'has_valid_us_visa',
      'previously_visited_canada',
      'uses_representative',
      'representative_name',
      'planned_entry_date',
      'planned_departure_date',
    ]) {
      expect(capture.prompt).toContain(key);
    }
  });

  it('a corrected date updates the same fact recorded under an older alias key', async () => {
    const out = await makeProcessAnswerNode(
      makeLlm({}, '{"planned_departure_date": "2027-05-01"}'),
    )(TRV);
    expect(out.profileJson).toEqual({
      planned_departure_date: '2027-05-01',
      departure_date: '2027-05-01',
    });
  });

  it("merges a son's new detail into that son by name (#35)", async () => {
    const out = await makeProcessAnswerNode(
      makeLlm(
        {},
        '{"children": [{"name": "Bilal Khan", "occupation": "Surgeon"}]}',
      ),
    )({
      ...BASE,
      profileJson: {
        children: [
          { name: 'Ahmed Khan', occupation: 'Engineer' },
          { name: 'Bilal Khan', occupation: 'Doctor' },
        ],
      },
    });
    expect(out.profileJson).toEqual({
      children: [
        { name: 'Ahmed Khan', occupation: 'Engineer' },
        { name: 'Bilal Khan', occupation: 'Surgeon' },
      ],
    });
  });
});

describe('processAnswer — children go into `children` (dry run 2026-10-15)', () => {
  it('tells the extractor to record children in the `children` list, not ad-hoc keys', async () => {
    const capture: { prompt?: string; system?: string } = {};
    const llm = {
      invoke: (messages: Array<{ content: string }>) => {
        capture.system = messages[0]?.content ?? '';
        return Promise.resolve({ content: '{}' });
      },
    } as unknown as ChatOpenAI;
    await makeProcessAnswerNode(llm)(BASE);
    expect(capture.system).toContain('"children"');
    expect(capture.system).toContain('youngest_son_name');
    expect(capture.system).toContain('birth_year');
  });

  it('folds flat child keys the extractor still emits into `children`', async () => {
    const out = await makeProcessAnswerNode(
      makeLlm(
        {},
        '{"youngest_son_name": "Mian Talha", "youngest_son_birth_year": 2000, "youngest_son_in_home_country": true}',
      ),
    )({ ...BASE, profileJson: {} });
    expect(out.profileJson!.children).toEqual([
      {
        name: 'Mian Talha',
        relationship: 'son',
        sex: 'Male',
        birth_year: 2000,
        in_home_country: true,
      },
    ]);
  });

  it("an answer this turn overwrites the child's detail; a stale flat key does not", async () => {
    const out = await makeProcessAnswerNode(
      makeLlm({}, '{"youngest_son_in_home_country": false}'),
    )({
      ...BASE,
      profileJson: {
        youngest_son_name: 'Mian Talha',
        youngest_son_in_home_country: true,
        children: [
          {
            name: 'Mian Talha',
            relationship: 'son',
            sex: 'Male',
            in_home_country: true,
          },
        ],
      },
    });
    expect(out.profileJson!.children).toEqual([
      expect.objectContaining({ name: 'Mian Talha', in_home_country: false }),
    ]);
  });
});

describe('processAnswer — reports what changed', () => {
  it('lists each fact whose value this answer changed, with old and new', async () => {
    const out = await makeProcessAnswerNode(
      makeLlm(
        {},
        '{"marriage_date": "1988-09-16", "annual_income_cad": 150000}',
      ),
    )({
      ...BASE,
      profileJson: { marriage_date: '1999-09-16', annual_income_cad: 150000 },
    });
    expect(out.profileChanges).toEqual([
      { key: 'marriage_date', from: '1999-09-16', to: '1988-09-16' },
    ]);
  });

  it('reports no changes when nothing was extracted', async () => {
    const out = await makeProcessAnswerNode(makeLlm({}, '{}'))(BASE);
    expect(out.profileChanges).toEqual([]);
  });
});

/**
 * Prod 2026-10-16, app 5d3a17a4: the first intake message named the
 * applicant's citizenship and passport, and the stored profile came out as
 * {retired, children, employed, purpose_of_visit, duration_of_stay_months} —
 * no nationality. Nothing asked the extractor for it (discovery mode has no
 * canonical keys and the prompt's examples never mention it), so the eTA
 * eligibility gate saw 'unknown' and let a Pakistani choose the eTA.
 */
describe('processAnswer — nationality is always captured', () => {
  const PROD_MESSAGE =
    'I am a citizen of Pakistan with a Pakistani passport only. I want to visit my son Bilawal, a Canadian permanent resident in Ontario, for 2 months as a tourist. I am retired.';
  // What the model actually stored for that message.
  const PROD_EXTRACTION = JSON.stringify({
    retired: true,
    children: [
      {
        name: 'Bilawal',
        relationship: 'son',
        country_of_residence: 'Canada',
      },
    ],
    employed: false,
    purpose_of_visit: 'tourism',
    duration_of_stay_months: 2,
  });

  const DISCOVERY: IntakeState = {
    ...BASE,
    profileJson: {},
    messages: [new HumanMessage(PROD_MESSAGE)],
    currentQuestion: 'What is the purpose of your visit to Canada?',
  };

  it('asks the extractor for nationality in discovery mode', async () => {
    const capture: { prompt?: string; system?: string } = {};
    const llm = {
      invoke: (messages: Array<{ content: string }>) => {
        capture.system = messages[0]?.content ?? '';
        capture.prompt = messages[messages.length - 1]?.content ?? '';
        return Promise.resolve({ content: '{}' });
      },
    } as unknown as ChatOpenAI;

    await makeProcessAnswerNode(llm)(DISCOVERY);

    expect(`${capture.system}\n${capture.prompt}`).toMatch(/\bnationality\b/);
  });

  it('records the nationality the model left out of the prod message', async () => {
    const node = makeProcessAnswerNode(makeLlm({}, PROD_EXTRACTION));

    const out = await node(DISCOVERY);

    expect(out.profileJson).toMatchObject({
      nationality: 'Pakistan',
      passport_country: 'Pakistan',
      purpose_of_visit: 'tourism',
    });
    expect(out.profileChanges?.map((c) => c.key)).toContain('nationality');
  });

  it('keeps the model’s own nationality when it extracted one', async () => {
    const node = makeProcessAnswerNode(
      makeLlm({}, '{"citizenship": "PK", "purpose_of_visit": "tourism"}'),
    );

    const out = await node(DISCOVERY);

    expect(out.profileJson).toMatchObject({ citizenship: 'PK' });
    expect(out.profileJson).not.toHaveProperty('nationality');
  });

  it('does not take a relative’s citizenship as the applicant’s', async () => {
    const node = makeProcessAnswerNode(
      makeLlm({}, '{"purpose_of_visit": "family"}'),
    );

    const out = await node({
      ...DISCOVERY,
      messages: [
        new HumanMessage('I want to visit my son, a Canadian citizen.'),
      ],
    });

    expect(out.profileJson).not.toHaveProperty('nationality');
  });
});

describe('processAnswer — "lives in my city" is not "lives with me" (prod 2026-10-16)', () => {
  // App 61f16bb5: "my son Mian Talha and his family live in Rawalpindi" was
  // recorded as children_living_with_you: ["Mian Talha"], and the LOE then
  // said he lives with the applicant.
  it('tells the extractor children_living_with_you needs the applicant’s own address', async () => {
    const capture: { system?: string } = {};
    const llm = {
      invoke: (messages: Array<{ content: string }>) => {
        capture.system = messages[0]?.content ?? '';
        return Promise.resolve({ content: '{}' });
      },
    } as unknown as ChatOpenAI;
    await makeProcessAnswerNode(llm)(BASE);
    expect(capture.system).toContain('children_living_with_you');
    expect(capture.system).toMatch(/same city|own family/);
  });
});

describe('processAnswer — prod 2026-10-17, app 61f16bb5 (super visa)', () => {
  const SV: IntakeState = {
    ...BASE,
    requirementsJson: { visaai_id: 'ca-super-visa' },
    profileJson: {
      inviter_name: 'Mian Muhammad Bilawal',
      inviter_address: '1202 Stirling Todd Terrace, Milton, Ontario L9E 2E2',
      place_of_birth: null,
    },
  };

  it('records "born in Rawalpindi" under place_of_birth, the key the form reads', async () => {
    const node = makeProcessAnswerNode(
      makeLlm({}, '{"birthplace_city": "Rawalpindi"}'),
    );
    const out = await node({
      ...SV,
      messages: [new HumanMessage('Pakistan, born in Rawalpindi.')],
      currentQuestion: 'In which country were you born?',
    });
    expect(out.profileJson).toEqual({ place_of_birth: 'Rawalpindi' });
  });

  it('records an occupation synonym under occupation', async () => {
    const node = makeProcessAnswerNode(
      makeLlm({}, '{"current_occupation": "Homemaker"}'),
    );
    const out = await node({
      ...SV,
      messages: [new HumanMessage('I am a homemaker.')],
    });
    expect(out.profileJson).toEqual({ occupation: 'Homemaker' });
  });

  it('tells the extractor the canonical names for birthplace, occupation and the second inviter', async () => {
    const capture: { prompt?: string } = {};
    const llm = {
      invoke: (messages: Array<{ content: string }>) => {
        capture.prompt = messages.map((m) => m.content).join('\n');
        return Promise.resolve({ content: '{}' });
      },
    } as unknown as ChatOpenAI;
    await makeProcessAnswerNode(llm)(SV);
    expect(capture.prompt).toContain('place_of_birth');
    expect(capture.prompt).toContain('occupation');
    expect(capture.prompt).toContain('second_inviter_name');
  });

  it("puts the answer to the second-inviter question in second_inviter_*, never the primary's fields", async () => {
    const node = makeProcessAnswerNode(
      makeLlm(
        {},
        '{"inviter_address": "1228 Turner Drive, Milton ON L9T 5R6", "inviter_phone": "647-819-8953"}',
      ),
    );
    const out = await node({
      ...SV,
      messages: [
        new HumanMessage(
          'Yes, my son Mian Muhammad Sajawal (co-signer), 1228 Turner Drive, Milton ON L9T 5R6, phone 647-819-8953.',
        ),
      ],
      currentQuestion:
        'Is anyone else inviting you to Canada besides your primary inviter, Mian Muhammad Bilawal?',
    });
    expect(out.profileJson).toEqual({
      has_second_inviter: true,
      second_inviter_address: '1228 Turner Drive, Milton ON L9T 5R6',
      second_inviter_phone: '647-819-8953',
      second_inviter_source: 'router',
    });
  });

  it('routes a differently named inviter to second_inviter_* on any question', async () => {
    const node = makeProcessAnswerNode(
      makeLlm(
        {},
        '{"inviter_name": "Mian Muhammad Sajawal", "inviter_address": "1228 Turner Drive"}',
      ),
    );
    const out = await node({ ...SV, currentQuestion: 'Anything else?' });
    expect(out.profileJson).toEqual({
      has_second_inviter: true,
      second_inviter_name: 'Mian Muhammad Sajawal',
      second_inviter_address: '1228 Turner Drive',
      second_inviter_source: 'router',
    });
  });
});
