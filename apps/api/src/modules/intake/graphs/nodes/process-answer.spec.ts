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
